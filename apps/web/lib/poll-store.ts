import "server-only";

import {
  BatchGetCommand,
  PutCommand,
  QueryCommand,
  ScanCommand,
} from "@aws-sdk/lib-dynamodb";
import {
  createEntityId,
  createPersistentPollQuestion,
  normalizePollQuestionDraft,
  resolveScheduledPollStatus,
  validatePollQuestionDraft,
  type PollAttempt,
  type PollParticipantType,
  type PollQuestionDraft,
  type PersistentPollQuestion,
  type ScheduledPoll,
} from "@trapit/testing";

import { getDynamoDbDocumentClient } from "./dynamodb";

type CreateScheduledPollInput = {
  anonymous: boolean;
  createdBy: string | null;
  creatorDisplayName?: string | null;
  creatorIdentifier?: string | null;
  endsAt: string;
  generateQrCode: boolean;
  participantGroupIds: string[];
  participantType: PollParticipantType;
  questionIds: string[];
  startsAt: string;
  title: string;
};

type UpdateScheduledPollInput = CreateScheduledPollInput & {
  pollId: string;
};

type PollViewer = {
  isRegistered?: boolean;
  responseUserId?: string | null;
  sub?: string | null;
};

type PollSummaryEntry = {
  optionSelectionCounts: number[];
  options: string[];
  prompt: string;
  questionId: string;
  topic: string;
  totalResponses: number;
};

const POLL_STORE_MODE = process.env.TRAPIT_POLL_STORE_MODE?.trim().toLowerCase() ?? "file";

function dedupe(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function normalizeParticipantIdentifier(value: string) {
  return value.trim().toLowerCase();
}

function getParticipantIdentifierCandidates(value: string) {
  const normalized = normalizeParticipantIdentifier(value);
  const compact = normalized.replace(/[\s()-]/g, "");
  const digitsOnly = compact.replace(/\D/g, "");
  const candidates = new Set<string>([normalized, compact]);

  if (digitsOnly) {
    candidates.add(digitsOnly);

    if (digitsOnly.length > 10) {
      candidates.add(digitsOnly.slice(-10));
    }
  }

  return candidates;
}

function identifiersMatch(left: string, right: string) {
  const leftCandidates = getParticipantIdentifierCandidates(left);

  return Array.from(getParticipantIdentifierCandidates(right)).some((candidate) =>
    leftCandidates.has(candidate),
  );
}

function getPollTables() {
  return {
    attempts: process.env.TRAPIT_POLL_ATTEMPTS_TABLE?.trim() ?? "",
    questions: process.env.TRAPIT_POLL_QUESTIONS_TABLE?.trim() ?? "",
    scheduledPolls: process.env.TRAPIT_SCHEDULED_POLLS_TABLE?.trim() ?? "",
  };
}

export function isDynamoDbPollStoreEnabled() {
  const tables = getPollTables();

  return POLL_STORE_MODE === "dynamodb"
    && Boolean(tables.attempts && tables.questions && tables.scheduledPolls);
}

function getDocumentClient() {
  return getDynamoDbDocumentClient();
}

async function scanAllItems<T>(tableName: string): Promise<T[]> {
  const client = getDocumentClient();
  const items: T[] = [];
  let exclusiveStartKey: Record<string, unknown> | undefined;

  do {
    const response = await client.send(new ScanCommand({
      ExclusiveStartKey: exclusiveStartKey,
      TableName: tableName,
    }));

    items.push(...((response.Items as T[] | undefined) ?? []));
    exclusiveStartKey = response.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (exclusiveStartKey);

  return items;
}

function hydrateScheduledPolls(polls: ScheduledPoll[]) {
  return polls.map((poll) => ({
    ...poll,
    creatorDisplayName: poll.creatorDisplayName ?? null,
    creatorIdentifier: poll.creatorIdentifier ?? null,
    status: resolveScheduledPollStatus(poll),
  }));
}

function sortPollQuestions(questions: PersistentPollQuestion[]) {
  return [...questions].sort(
    (left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime(),
  );
}

function sortScheduledPolls(polls: ScheduledPoll[]) {
  const pollStatusPriority: Record<ScheduledPoll["status"], number> = {
    live: 0,
    scheduled: 1,
    completed: 2,
  };

  return [...polls].sort((left, right) => {
    const priorityDifference = pollStatusPriority[left.status] - pollStatusPriority[right.status];

    if (priorityDifference !== 0) {
      return priorityDifference;
    }

    return new Date(right.startsAt).getTime() - new Date(left.startsAt).getTime();
  });
}

async function getPollQuestionsByIds(questionIds: string[]) {
  const uniqueIds = dedupe(questionIds);

  if (!uniqueIds.length) {
    return [] as PersistentPollQuestion[];
  }

  const client = getDocumentClient();
  const { questions: tableName } = getPollTables();
  const loadedQuestions: PersistentPollQuestion[] = [];

  for (let index = 0; index < uniqueIds.length; index += 100) {
    const chunk = uniqueIds.slice(index, index + 100);
    const response = await client.send(new BatchGetCommand({
      RequestItems: {
        [tableName]: {
          Keys: chunk.map((id) => ({ id })),
        },
      },
    }));

    loadedQuestions.push(...((response.Responses?.[tableName] as PersistentPollQuestion[] | undefined) ?? []));
  }

  return uniqueIds
    .map((questionId) => loadedQuestions.find((question) => question.id === questionId))
    .filter((question): question is PersistentPollQuestion => Boolean(question));
}

async function getPollAttemptsByPollId(pollId: string) {
  const client = getDocumentClient();
  const { attempts: tableName } = getPollTables();
  const attempts: PollAttempt[] = [];
  let exclusiveStartKey: Record<string, unknown> | undefined;

  do {
    const response = await client.send(new QueryCommand({
      ExclusiveStartKey: exclusiveStartKey,
      ExpressionAttributeValues: {
        ":pollId": pollId,
      },
      KeyConditionExpression: "pollId = :pollId",
      TableName: tableName,
    }));

    attempts.push(...((response.Items as PollAttempt[] | undefined) ?? []));
    exclusiveStartKey = response.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (exclusiveStartKey);

  return attempts;
}

async function findPollByShareCode(shareCode: string) {
  const normalizedShareCode = shareCode.trim().toUpperCase();
  const polls = hydrateScheduledPolls(await scanAllItems<ScheduledPoll>(getPollTables().scheduledPolls));

  return polls.find((poll) => poll.shareCode?.trim().toUpperCase() === normalizedShareCode) ?? null;
}

function buildPollSummary(
  poll: ScheduledPoll,
  questions: PersistentPollQuestion[],
  attempts: PollAttempt[],
  viewer?: PollViewer,
) {
  const viewerResponseUserId = viewer?.responseUserId ?? null;
  const hasSubmitted = viewerResponseUserId
    ? attempts.some((attempt) => identifiersMatch(attempt.userId, viewerResponseUserId))
    : false;
  const isCreator = Boolean(viewer?.sub && poll.createdBy && viewer.sub === poll.createdBy);
  const canViewResults = isCreator || Boolean(viewer?.isRegistered && hasSubmitted);
  const summary: PollSummaryEntry[] = questions.map((question) => ({
    optionSelectionCounts: question.options.map(
      (_, optionIndex) => attempts.filter((attempt) => attempt.answers[question.id] === optionIndex).length,
    ),
    options: question.options,
    prompt: question.prompt,
    questionId: question.id,
    topic: question.topic,
    totalResponses: attempts.length,
  }));

  return {
    canViewResults,
    hasSubmitted,
    poll,
    questions,
    summary: canViewResults ? summary : [],
    totalResponses: canViewResults ? attempts.length : null,
  };
}

export async function listPollQuestionsFromBackend(actorId: string | null = null) {
  const questions = sortPollQuestions(await scanAllItems<PersistentPollQuestion>(getPollTables().questions));

  if (!actorId) {
    return questions;
  }

  return questions.filter((question) => question.createdBy === actorId);
}

export async function createPollQuestionsInBackend(
  drafts: PollQuestionDraft[],
  actorId: string | null,
) {
  const normalizedDrafts = drafts.map((draft) => normalizePollQuestionDraft(draft));

  for (const draft of normalizedDrafts) {
    const validationError = validatePollQuestionDraft(draft);

    if (validationError) {
      throw new Error(validationError);
    }
  }

  const client = getDocumentClient();
  const { questions: tableName } = getPollTables();
  const nextQuestions = normalizedDrafts.map((draft) =>
    createPersistentPollQuestion(draft, { createdBy: actorId }),
  );

  await Promise.all(
    nextQuestions.map((question) =>
      client.send(new PutCommand({
        Item: question,
        TableName: tableName,
      })),
    ),
  );

  return listPollQuestionsFromBackend(actorId);
}

export async function listScheduledPollsFromBackend(actorId: string | null = null) {
  const polls = sortScheduledPolls(
    hydrateScheduledPolls(await scanAllItems<ScheduledPoll>(getPollTables().scheduledPolls)),
  );

  if (!actorId) {
    return polls;
  }

  return polls.filter((poll) => poll.createdBy === actorId);
}

export async function listAllScheduledPollsFromBackend() {
  return sortScheduledPolls(
    hydrateScheduledPolls(await scanAllItems<ScheduledPoll>(getPollTables().scheduledPolls)),
  );
}

export async function createScheduledPollInBackend(input: CreateScheduledPollInput) {
  const questionIds = dedupe(input.questionIds);

  if (!questionIds.length) {
    throw new Error("Select at least one poll question.");
  }

  const questions = await getPollQuestionsByIds(questionIds);

  if (questions.length !== questionIds.length) {
    throw new Error("Poll question not found.");
  }

  for (const question of questions) {
    if (input.createdBy && question.createdBy !== input.createdBy) {
      throw new Error("You can only manage poll questions you created.");
    }
  }

  if (input.participantType === "registered" && !dedupe(input.participantGroupIds).length) {
    throw new Error("Select at least one group for registered-only polls.");
  }

  const startsAtMs = new Date(input.startsAt).getTime();
  const endsAtMs = new Date(input.endsAt).getTime();

  if (Number.isNaN(startsAtMs)) {
    throw new Error("Choose a valid poll start date and time.");
  }

  if (Number.isNaN(endsAtMs)) {
    throw new Error("Choose a valid poll end date and time.");
  }

  if (endsAtMs <= startsAtMs) {
    throw new Error("Poll end time must be after the start time.");
  }

  const title = input.title.trim();

  if (!title) {
    throw new Error("Poll topic is required.");
  }

  const anonymous = input.participantType === "open" ? true : input.anonymous;
  const timestamp = new Date().toISOString();
  const scheduledPoll: ScheduledPoll = {
    anonymous,
    createdAt: timestamp,
    createdBy: input.createdBy,
    creatorDisplayName: input.creatorDisplayName?.trim() || null,
    creatorIdentifier: input.creatorIdentifier?.trim() || null,
    endsAt: input.endsAt,
    id: createEntityId("poll"),
    participantGroupIds: dedupe(input.participantGroupIds),
    participantType: input.participantType,
    questionIds,
    shareCode: input.participantType === "open"
      ? `TRAPIT-POLL-${createEntityId("access").replace(/-/g, "").toUpperCase()}`
      : null,
    startsAt: input.startsAt,
    status: resolveScheduledPollStatus({ endsAt: input.endsAt, startsAt: input.startsAt }),
    title,
    updatedAt: timestamp,
  };

  await getDocumentClient().send(new PutCommand({
    Item: scheduledPoll,
    TableName: getPollTables().scheduledPolls,
  }));

  return listScheduledPollsFromBackend(input.createdBy);
}

export async function updateScheduledPollInBackend(input: UpdateScheduledPollInput) {
  const polls = hydrateScheduledPolls(await scanAllItems<ScheduledPoll>(getPollTables().scheduledPolls));
  const existingPoll = polls.find((poll) => poll.id === input.pollId);

  if (!existingPoll) {
    throw new Error("The selected poll could not be found.");
  }

  if (input.createdBy && existingPoll.createdBy !== input.createdBy) {
    throw new Error("You can only manage polls you scheduled.");
  }

  if (existingPoll.status !== "scheduled") {
    throw new Error("Only polls that have not started can be edited.");
  }

  const questionIds = dedupe(input.questionIds);

  if (!questionIds.length) {
    throw new Error("Select at least one poll question.");
  }

  const questions = await getPollQuestionsByIds(questionIds);

  if (questions.length !== questionIds.length) {
    throw new Error("Poll question not found.");
  }

  for (const question of questions) {
    if (input.createdBy && question.createdBy !== input.createdBy) {
      throw new Error("You can only manage poll questions you created.");
    }
  }

  if (input.participantType === "registered" && !dedupe(input.participantGroupIds).length) {
    throw new Error("Select at least one group for registered-only polls.");
  }

  const startsAtMs = new Date(input.startsAt).getTime();
  const endsAtMs = new Date(input.endsAt).getTime();

  if (Number.isNaN(startsAtMs)) {
    throw new Error("Choose a valid poll start date and time.");
  }

  if (Number.isNaN(endsAtMs)) {
    throw new Error("Choose a valid poll end date and time.");
  }

  if (endsAtMs <= startsAtMs) {
    throw new Error("Poll end time must be after the start time.");
  }

  const title = input.title.trim();

  if (!title) {
    throw new Error("Poll topic is required.");
  }

  const anonymous = input.participantType === "open" ? true : input.anonymous;
  const nextPoll: ScheduledPoll = {
    ...existingPoll,
    anonymous,
    creatorDisplayName: input.creatorDisplayName?.trim() || existingPoll.creatorDisplayName || null,
    creatorIdentifier: input.creatorIdentifier?.trim() || existingPoll.creatorIdentifier || null,
    endsAt: input.endsAt,
    participantGroupIds: dedupe(input.participantGroupIds),
    participantType: input.participantType,
    questionIds,
    shareCode: input.participantType === "open"
      ? existingPoll.shareCode ?? `TRAPIT-POLL-${createEntityId("access").replace(/-/g, "").toUpperCase()}`
      : null,
    startsAt: input.startsAt,
    status: resolveScheduledPollStatus({ endsAt: input.endsAt, startsAt: input.startsAt }),
    title,
    updatedAt: new Date().toISOString(),
  };

  await getDocumentClient().send(new PutCommand({
    Item: nextPoll,
    TableName: getPollTables().scheduledPolls,
  }));

  return listScheduledPollsFromBackend(input.createdBy);
}

export async function getPollByShareCodeFromBackend(shareCode: string, viewer?: PollViewer) {
  const poll = await findPollByShareCode(shareCode);

  if (!poll) {
    throw new Error("The selected poll could not be found.");
  }

  const [questions, attempts] = await Promise.all([
    getPollQuestionsByIds(poll.questionIds),
    getPollAttemptsByPollId(poll.id),
  ]);

  return buildPollSummary(poll, questions, attempts, viewer);
}

export async function recordPollAttemptInBackend(input: {
  answers: Record<string, number | undefined>;
  completedAt: string;
  participantName?: string;
  shareCode: string;
  startedAt: string;
  userId: string;
}) {
  const normalizedUserId = normalizeParticipantIdentifier(input.userId);
  const poll = await findPollByShareCode(input.shareCode);

  if (!poll) {
    throw new Error("The selected poll could not be found.");
  }

  if (poll.participantType !== "open") {
    throw new Error("This poll is not available through a public QR code.");
  }

  if (poll.status === "scheduled") {
    throw new Error("This poll is not live yet.");
  }

  if (poll.status === "completed") {
    throw new Error("This poll is no longer available.");
  }

  const questions = await getPollQuestionsByIds(poll.questionIds);
  const completedAtMs = new Date(input.completedAt).getTime();
  const startsAtMs = new Date(poll.startsAt).getTime();
  const endsAtMs = new Date(poll.endsAt).getTime();

  if (completedAtMs < startsAtMs) {
    throw new Error("This poll is not live yet.");
  }

  if (completedAtMs > endsAtMs) {
    throw new Error("This poll is no longer available.");
  }

  const participantName = input.participantName?.trim();

  if (!participantName) {
    throw new Error("Participant name is required before starting the poll.");
  }

  for (const question of questions) {
    const answer = input.answers[question.id];

    if (typeof answer !== "number" || answer < 0 || answer >= question.options.length) {
      throw new Error("Answer every poll question before submitting.");
    }
  }

  const attempt: PollAttempt = {
    answers: input.answers,
    completedAt: input.completedAt,
    id: createEntityId("poll-attempt"),
    participantName,
    pollId: poll.id,
    startedAt: input.startedAt,
    userId: normalizedUserId,
  };

  try {
    await getDocumentClient().send(new PutCommand({
      ConditionExpression: "attribute_not_exists(pollId) AND attribute_not_exists(userId)",
      Item: attempt,
      TableName: getPollTables().attempts,
    }));
  } catch (error) {
    if (error instanceof Error && error.name === "ConditionalCheckFailedException") {
      throw new Error("This poll has already been submitted.");
    }

    throw error;
  }

  return attempt;
}