import "server-only";

import {
  BatchGetCommand,
  DeleteCommand,
  PutCommand,
  QueryCommand,
  ScanCommand,
  TransactWriteCommand,
} from "@aws-sdk/lib-dynamodb";
import {
  buildPollRecurrenceCycles,
  createEntityId,
  createPersistentPollQuestion,
  normalizeWorkspaceBranding,
  normalizePollQuestionDraft,
  resolveScheduledPollStatus,
  validatePollQuestionDraft,
  type PollAttempt,
  type PollParticipantType,
  type PollQuestionDraft,
  type PollRecurrenceFrequency,
  type PollResponseMode,
  type PersistentPollQuestion,
  type ScheduledPoll,
  type WorkspaceBranding,
} from "@trapit/testing";

import { getDynamoDbDocumentClient } from "./dynamodb";

type CreateScheduledPollInput = {
  anonymous: boolean;
  branding?: WorkspaceBranding | null;
  createdBy: string | null;
  creatorDisplayName?: string | null;
  creatorIdentifier?: string | null;
  endsAt: string;
  generateQrCode: boolean;
  openPollRequiresRegistration?: boolean;
  participantGroupIds: string[];
  participantType: PollParticipantType;
  questionIds: string[];
  recurrenceCycleCount?: number | null;
  recurrenceFrequency?: PollRecurrenceFrequency | null;
  startsAt: string;
  title: string;
};

type UpdateScheduledPollInput = CreateScheduledPollInput & {
  pollId: string;
};

type PollViewer = {
  identifier?: string | null;
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

function resolvePollResponseMode(input: Pick<CreateScheduledPollInput, "anonymous" | "openPollRequiresRegistration" | "participantType">): PollResponseMode {
  if (input.participantType === "registered") {
    return input.anonymous ? "groups-anonymous" : "groups-named";
  }

  return input.openPollRequiresRegistration
    ? "open-registered-anonymous"
    : "open-unregistered-anonymous";
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

function hydrateScheduledPolls(polls: ScheduledPoll[], attempts?: PollAttempt[]) {
  return polls.map((poll) => ({
    ...poll,
    branding: normalizeWorkspaceBranding(poll.branding),
    creatorDisplayName: poll.creatorDisplayName ?? null,
    creatorIdentifier: poll.creatorIdentifier ?? null,
    recurrenceCycleCount: poll.recurrenceCycleCount ?? null,
    recurrenceCycleIndex: poll.recurrenceCycleIndex ?? null,
    recurrenceFrequency: poll.recurrenceFrequency ?? null,
    responseMode: poll.responseMode ?? resolvePollResponseMode(poll),
    seriesId: poll.seriesId ?? null,
    status: resolveScheduledPollStatus(poll),
    ...(attempts ? { totalResponses: attempts.filter((attempt) => attempt.pollId === poll.id).length } : {}),
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

export async function listRespondedOpenPollIdsForUserFromBackend(identifier: string) {
  const normalizedIdentifier = normalizeParticipantIdentifier(identifier);
  const attempts = await scanAllItems<PollAttempt>(getPollTables().attempts);

  return Array.from(
    new Set(
      attempts
        .filter((attempt) => identifiersMatch(attempt.userId, normalizedIdentifier))
        .map((attempt) => attempt.pollId),
    ),
  );
}

async function findPollByShareCode(shareCode: string) {
  const normalizedShareCode = shareCode.trim().toUpperCase();
  const polls = hydrateScheduledPolls(await scanAllItems<ScheduledPoll>(getPollTables().scheduledPolls));

  return polls.find((poll) => poll.shareCode?.trim().toUpperCase() === normalizedShareCode) ?? null;
}

async function findPollById(pollId: string) {
  const normalizedPollId = pollId.trim();
  const polls = hydrateScheduledPolls(await scanAllItems<ScheduledPoll>(getPollTables().scheduledPolls));

  return polls.find((poll) => poll.id === normalizedPollId) ?? null;
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
  const isCreator = Boolean(
    (viewer?.sub && poll.createdBy && viewer.sub === poll.createdBy)
    || (viewer?.identifier && poll.creatorIdentifier && identifiersMatch(poll.creatorIdentifier, viewer.identifier)),
  );
  const isRecurringResultPublished = !poll.seriesId || poll.status === "completed";
  const canViewResults = isRecurringResultPublished
    && (isCreator || Boolean(viewer?.isRegistered && hasSubmitted));
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

export async function updatePollQuestionInBackend(
  questionId: string,
  draft: PollQuestionDraft,
  actorId: string | null = null,
) {
  const question = (await listPollQuestionsFromBackend(null)).find((entry) => entry.id === questionId);

  if (!question) {
    throw new Error("Poll question not found.");
  }

  if (actorId && question.createdBy !== actorId) {
    throw new Error("You can only manage poll questions you created.");
  }

  const normalizedDraft = normalizePollQuestionDraft(draft);
  const validationError = validatePollQuestionDraft(normalizedDraft);

  if (validationError) {
    throw new Error(validationError);
  }

  await getDocumentClient().send(new PutCommand({
    Item: {
      ...question,
      ...normalizedDraft,
      updatedAt: new Date().toISOString(),
    },
    TableName: getPollTables().questions,
  }));

  return listPollQuestionsFromBackend(actorId);
}

export async function deletePollQuestionFromBackend(questionId: string, actorId: string | null = null) {
  const question = (await listPollQuestionsFromBackend(null)).find((entry) => entry.id === questionId);

  if (!question) {
    throw new Error("Poll question not found.");
  }

  if (actorId && question.createdBy !== actorId) {
    throw new Error("You can only manage poll questions you created.");
  }

  await getDocumentClient().send(new DeleteCommand({
    Key: { id: questionId },
    TableName: getPollTables().questions,
  }));

  const scheduledPollsTable = getPollTables().scheduledPolls;
  const scheduledPolls = await scanAllItems<ScheduledPoll>(scheduledPollsTable);
  const affectedPolls = scheduledPolls.filter((poll) => poll.questionIds.includes(questionId));

  await Promise.all(
    affectedPolls.map((poll) =>
      getDocumentClient().send(new PutCommand({
        Item: {
          ...poll,
          questionIds: poll.questionIds.filter((savedId) => savedId !== questionId),
          updatedAt: new Date().toISOString(),
        },
        TableName: scheduledPollsTable,
      })),
    ),
  );

  return listPollQuestionsFromBackend(actorId);
}

export async function listScheduledPollsFromBackend(actorId: string | null = null) {
  const [storedPolls, attempts] = await Promise.all([
    scanAllItems<ScheduledPoll>(getPollTables().scheduledPolls),
    scanAllItems<PollAttempt>(getPollTables().attempts),
  ]);
  const polls = sortScheduledPolls(
    hydrateScheduledPolls(storedPolls, attempts),
  );

  if (!actorId) {
    return polls;
  }

  return polls.filter((poll) => poll.createdBy === actorId);
}

export async function listAllScheduledPollsFromBackend() {
  const [storedPolls, attempts] = await Promise.all([
    scanAllItems<ScheduledPoll>(getPollTables().scheduledPolls),
    scanAllItems<PollAttempt>(getPollTables().attempts),
  ]);

  return sortScheduledPolls(
    hydrateScheduledPolls(storedPolls, attempts),
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

  const participantGroupIds = dedupe(input.participantGroupIds);

  if (!participantGroupIds.length) {
    throw new Error("Select at least one group for this poll.");
  }

  const startsAtMs = new Date(input.startsAt).getTime();
  const endsAtMs = new Date(input.endsAt).getTime();
  const recurrenceFrequency = input.recurrenceFrequency ?? null;
  const recurrenceCycleCount = input.recurrenceCycleCount ?? null;

  if (Number.isNaN(startsAtMs)) {
    throw new Error("Choose a valid poll start date and time.");
  }

  if (Number.isNaN(endsAtMs)) {
    throw new Error("Choose a valid poll end date and time.");
  }

  if (!recurrenceFrequency && endsAtMs <= startsAtMs) {
    throw new Error("Poll end time must be after the start time.");
  }

  if (recurrenceFrequency && (!Number.isInteger(recurrenceCycleCount) || (recurrenceCycleCount ?? 0) < 1 || (recurrenceCycleCount ?? 0) > 50)) {
    throw new Error("Recurring polls require between 1 and 50 cycles.");
  }

  if (recurrenceFrequency && input.participantType === "open" && !input.openPollRequiresRegistration) {
    throw new Error("Recurring polls require participant registration.");
  }

  const title = input.title.trim();

  if (!title) {
    throw new Error("Poll topic is required.");
  }

  const anonymous = input.generateQrCode && input.participantType === "open" ? true : input.anonymous;
  const timestamp = new Date().toISOString();
  const seriesId = recurrenceFrequency ? createEntityId("poll-series") : null;
  const cycles = recurrenceFrequency
    ? buildPollRecurrenceCycles({
        cycleCount: recurrenceCycleCount ?? 1,
        frequency: recurrenceFrequency,
        startsAt: input.startsAt,
      })
    : [{ cycleIndex: 0, endsAt: input.endsAt, startsAt: input.startsAt }];
  const scheduledPolls = cycles.map<ScheduledPoll>((cycle) => ({
    anonymous,
    branding: normalizeWorkspaceBranding(input.branding),
    createdAt: timestamp,
    createdBy: input.createdBy,
    creatorDisplayName: input.creatorDisplayName?.trim() || null,
    creatorIdentifier: input.creatorIdentifier?.trim() || null,
    endsAt: cycle.endsAt,
    id: createEntityId("poll"),
    openPollRequiresRegistration: input.participantType === "open" ? Boolean(input.openPollRequiresRegistration) : false,
    participantGroupIds,
    participantType: input.participantType,
    questionIds,
    recurrenceCycleCount: recurrenceFrequency ? recurrenceCycleCount : null,
    recurrenceCycleIndex: recurrenceFrequency ? cycle.cycleIndex : null,
    recurrenceFrequency,
    responseMode: resolvePollResponseMode(input),
    seriesId,
    shareCode: input.generateQrCode
      ? `TRAPIT-POLL-${createEntityId("access").replace(/-/g, "").toUpperCase()}`
      : null,
    startsAt: cycle.startsAt,
    status: resolveScheduledPollStatus(cycle),
    title,
    updatedAt: timestamp,
  }));

  await getDocumentClient().send(new TransactWriteCommand({
    TransactItems: scheduledPolls.map((scheduledPoll) => ({
      Put: {
        Item: scheduledPoll,
        TableName: getPollTables().scheduledPolls,
      },
    })),
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

  const participantGroupIds = dedupe(input.participantGroupIds);

  if (!participantGroupIds.length) {
    throw new Error("Select at least one group for this poll.");
  }

  const startsAtMs = new Date(input.startsAt).getTime();
  const endsAtMs = new Date(input.endsAt).getTime();
  const recurrenceFrequency = input.recurrenceFrequency ?? null;
  const recurrenceCycleCount = input.recurrenceCycleCount ?? null;

  if (Number.isNaN(startsAtMs)) {
    throw new Error("Choose a valid poll start date and time.");
  }

  if (Number.isNaN(endsAtMs)) {
    throw new Error("Choose a valid poll end date and time.");
  }

  if (!recurrenceFrequency && endsAtMs <= startsAtMs) {
    throw new Error("Poll end time must be after the start time.");
  }

  if (recurrenceFrequency && (!Number.isInteger(recurrenceCycleCount) || (recurrenceCycleCount ?? 0) < 1 || (recurrenceCycleCount ?? 0) > 50)) {
    throw new Error("Recurring polls require between 1 and 50 cycles.");
  }

  if (recurrenceFrequency && input.participantType === "open" && !input.openPollRequiresRegistration) {
    throw new Error("Recurring polls require participant registration.");
  }

  const title = input.title.trim();

  if (!title) {
    throw new Error("Poll topic is required.");
  }

  const anonymous = input.generateQrCode && input.participantType === "open" ? true : input.anonymous;
  const timestamp = new Date().toISOString();

  if (existingPoll.seriesId) {
    if (!recurrenceFrequency) {
      throw new Error("Choose a recurrence frequency when editing a recurring poll.");
    }

    const nowMs = Date.now();
    const seriesPolls = polls.filter((poll) => poll.seriesId === existingPoll.seriesId);
    const preservedCycles = seriesPolls.filter((poll) => new Date(poll.startsAt).getTime() <= nowMs);
    const futureCycles = seriesPolls.filter((poll) => new Date(poll.startsAt).getTime() > nowMs);
    const generatedCycles = buildPollRecurrenceCycles({
      cycleCount: recurrenceCycleCount ?? 1,
      frequency: recurrenceFrequency,
      startsAt: input.startsAt,
    }).filter((cycle) => new Date(cycle.startsAt).getTime() > nowMs);
    const latestPreservedEndMs = preservedCycles.reduce(
      (latest, poll) => Math.max(latest, new Date(poll.endsAt).getTime()),
      Number.NEGATIVE_INFINITY,
    );

    if (generatedCycles.some((cycle) => new Date(cycle.startsAt).getTime() < latestPreservedEndMs)) {
      throw new Error("Future cycles must start after the active cycle ends.");
    }

    const replacementPolls = generatedCycles.map<ScheduledPoll>((cycle) => ({
      ...existingPoll,
      anonymous,
      branding: normalizeWorkspaceBranding(input.branding) ?? existingPoll.branding ?? null,
      creatorDisplayName: input.creatorDisplayName?.trim() || existingPoll.creatorDisplayName || null,
      creatorIdentifier: input.creatorIdentifier?.trim() || existingPoll.creatorIdentifier || null,
      endsAt: cycle.endsAt,
      id: createEntityId("poll"),
      openPollRequiresRegistration: input.participantType === "open" ? Boolean(input.openPollRequiresRegistration) : false,
      participantGroupIds,
      participantType: input.participantType,
      questionIds,
      recurrenceCycleCount,
      recurrenceCycleIndex: cycle.cycleIndex,
      recurrenceFrequency,
      responseMode: resolvePollResponseMode(input),
      shareCode: input.generateQrCode
        ? `TRAPIT-POLL-${createEntityId("access").replace(/-/g, "").toUpperCase()}`
        : null,
      startsAt: cycle.startsAt,
      status: resolveScheduledPollStatus(cycle),
      title,
      updatedAt: timestamp,
    }));
    const transactItems = [
      ...futureCycles.map((poll) => ({
        Delete: {
          Key: { id: poll.id },
          TableName: getPollTables().scheduledPolls,
        },
      })),
      ...replacementPolls.map((poll) => ({
        Put: {
          Item: poll,
          TableName: getPollTables().scheduledPolls,
        },
      })),
    ];

    if (transactItems.length) {
      await getDocumentClient().send(new TransactWriteCommand({ TransactItems: transactItems }));
    }

    return listScheduledPollsFromBackend(input.createdBy);
  }

  const nextPoll: ScheduledPoll = {
    ...existingPoll,
    anonymous,
    branding: normalizeWorkspaceBranding(input.branding) ?? existingPoll.branding ?? null,
    creatorDisplayName: input.creatorDisplayName?.trim() || existingPoll.creatorDisplayName || null,
    creatorIdentifier: input.creatorIdentifier?.trim() || existingPoll.creatorIdentifier || null,
    endsAt: input.endsAt,
    openPollRequiresRegistration: input.participantType === "open" ? Boolean(input.openPollRequiresRegistration) : false,
    participantGroupIds,
    participantType: input.participantType,
    questionIds,
    recurrenceCycleCount: null,
    recurrenceCycleIndex: null,
    recurrenceFrequency: null,
    responseMode: resolvePollResponseMode(input),
    shareCode: input.generateQrCode
      ? existingPoll.shareCode ?? `TRAPIT-POLL-${createEntityId("access").replace(/-/g, "").toUpperCase()}`
      : null,
    startsAt: input.startsAt,
    status: resolveScheduledPollStatus({ endsAt: input.endsAt, startsAt: input.startsAt }),
    title,
    updatedAt: timestamp,
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

export async function getPollByIdFromBackend(pollId: string, viewer?: PollViewer) {
  const poll = await findPollById(pollId);

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

  const participantName = input.participantName?.trim() || undefined;

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

export async function recordRegisteredPollAttemptInBackend(input: {
  answers: Record<string, number | undefined>;
  completedAt: string;
  participantName?: string;
  pollId: string;
  startedAt: string;
  userId: string;
}) {
  const normalizedUserId = normalizeParticipantIdentifier(input.userId);
  const poll = await findPollById(input.pollId);

  if (!poll) {
    throw new Error("The selected poll could not be found.");
  }

  if (poll.participantType !== "registered") {
    throw new Error("This poll is available through the public poll page.");
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

  const participantName = input.participantName?.trim() || undefined;

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

export async function listCompletedPollSeriesResultsFromBackend(seriesId: string) {
  const [polls, attempts, questions] = await Promise.all([
    scanAllItems<ScheduledPoll>(getPollTables().scheduledPolls),
    scanAllItems<PollAttempt>(getPollTables().attempts),
    scanAllItems<PersistentPollQuestion>(getPollTables().questions),
  ]);
  const questionMap = new Map(questions.map((question) => [question.id, question]));

  return hydrateScheduledPolls(polls)
    .filter((poll) => poll.seriesId === seriesId && poll.status === "completed")
    .sort((left, right) => (left.recurrenceCycleIndex ?? 0) - (right.recurrenceCycleIndex ?? 0))
    .map((poll) => {
      const pollAttempts = attempts.filter((attempt) => attempt.pollId === poll.id);
      const summary = poll.questionIds
        .map((questionId) => questionMap.get(questionId))
        .filter((question): question is PersistentPollQuestion => Boolean(question))
        .map((question) => ({
          optionSelectionCounts: question.options.map((_, optionIndex) =>
            pollAttempts.filter((attempt) => attempt.answers[question.id] === optionIndex).length),
          options: question.options,
          prompt: question.prompt,
          questionId: question.id,
          topic: question.topic,
          totalResponses: pollAttempts.length,
        }));

      return {
        endsAt: poll.endsAt,
        label: `Instance ${(poll.recurrenceCycleIndex ?? 0) + 1}`,
        pollId: poll.id,
        startsAt: poll.startsAt,
        summary,
        totalResponses: pollAttempts.length,
      };
    });
}