import "server-only";

import {
  buildTestLeaderboards,
  compareTestResults,
  createGroupJoinRequest as createStoredGroupJoinRequest,
  createEmptyTestingWorkspaceState,
  createEntityId,
  createParticipantGroup,
  createParticipantProfile,
  createPersistentPollQuestion,
  createPersistentQuestion,
  getIncorrectCount,
  getScheduledTestEndTime,
  normalizeDraft,
  normalizePollQuestionDraft,
  previewQuestionImport,
  resolveScheduledTestStatus,
  selectQuestionIdsForScheduledTest,
  scoreObjectiveTest,
  sampleQuestions,
  summarizeTestHistory,
  type BulkImportPreview,
  type GroupJoinRequest,
  type ObjectiveQuestion,
  type PollAttempt,
  type PersistentPollQuestion,
  type PollParticipantType,
  type PollQuestionDraft,
  type ParticipantGroup,
  type PersistentQuestion,
  type QuestionDraft,
  type QuestionImportSource,
  type QuestionPool,
  type ScheduledPoll,
  type ScheduledTest,
  type TestAttempt,
  type TestingWorkspaceState,
  validatePollQuestionDraft,
} from "@trapit/testing";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  createPollQuestionsInBackend,
  createScheduledPollInBackend,
  getPollByShareCodeFromBackend,
  isDynamoDbPollStoreEnabled,
  listAllScheduledPollsFromBackend,
  listPollQuestionsFromBackend,
  listScheduledPollsFromBackend,
  recordPollAttemptInBackend,
} from "./poll-store";

const DEFAULT_PRODUCTION_DATA_DIR = path.join(path.sep, "var", "lib", "trapit");

function resolveStorePath() {
  const configuredFilePath = process.env.TRAPIT_DATA_FILE?.trim();

  if (configuredFilePath) {
    return configuredFilePath;
  }

  const configuredDataDir = process.env.TRAPIT_DATA_DIR?.trim();

  if (configuredDataDir) {
    return path.join(configuredDataDir, "testing-workspace.json");
  }

  return process.env.NODE_ENV === "production"
    ? path.join(DEFAULT_PRODUCTION_DATA_DIR, "testing-workspace.json")
    : path.join(process.cwd(), "data", "testing-workspace.json");
}

const STORE_PATH = resolveStorePath();

function isMissingPollStoreResourceError(error: unknown) {
  if (!(error instanceof Error)) {
    return false;
  }

  return error.name === "ResourceNotFoundException"
    || /requested resource not found/i.test(error.message)
    || /table.*not found/i.test(error.message);
}

async function withPollStoreFallback<T>(
  backendAction: () => Promise<T>,
  fileAction: () => Promise<T>,
) {
  try {
    return await backendAction();
  } catch (error) {
    if (!isMissingPollStoreResourceError(error)) {
      throw error;
    }

    console.warn("DynamoDB poll store resource missing; falling back to file storage.", error);
    return fileAction();
  }
}

export type AvailableUserTest = {
  durationMinutes: number;
  hasAttempt: boolean;
  id: string;
  poolId: string;
  topPerformer?: {
    correctCount: number;
    elapsedMs: number;
    participantName: string;
  };
  questionCount: number;
  questions: ObjectiveQuestion[];
  startsAt: string;
  status: ScheduledTest["status"];
  title: string;
};

async function ensureStoreDirectory() {
  await mkdir(path.dirname(STORE_PATH), { recursive: true });
}

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

function normalizeState(parsed: Partial<TestingWorkspaceState>): TestingWorkspaceState {
  return {
    attempts: parsed.attempts ?? [],
    groupJoinRequests: (parsed.groupJoinRequests ?? []).map((request) => ({
      ...request,
      adminGroupName: request.adminGroupName?.trim() ?? "Unnamed group",
      resolvedAt: request.resolvedAt ?? null,
      status: request.status ?? "pending",
    })),
    pollAttempts: parsed.pollAttempts ?? [],
    participantGroups: (parsed.participantGroups ?? []).map((group) => ({
      ...group,
      ownerIdentifier: group.ownerIdentifier?.trim() || null,
      participantIds: dedupe(group.participantIds ?? []),
    })),
    participants: parsed.participants ?? [],
    pollQuestions: (parsed.pollQuestions ?? []).map((question) => ({
      ...question,
      options: question.options ?? [],
      topic: question.topic?.trim() ?? "",
    })),
    pools: (parsed.pools ?? []).map((pool) => ({
      ...pool,
      createdBy: pool.createdBy ?? null,
      questionIds: dedupe(pool.questionIds ?? []),
    })),
    questions: parsed.questions ?? [],
    scheduledPolls: (parsed.scheduledPolls ?? []).map((poll) => {
      const startsAt = poll.startsAt;
      const legacyDurationValue = (poll as ScheduledPoll & { durationMinutes?: number }).durationMinutes;
      const legacyDurationMinutes = typeof legacyDurationValue === "number" ? legacyDurationValue : null;
      const endsAt = poll.endsAt
        ?? (legacyDurationMinutes !== null
          ? new Date(
              new Date(startsAt).getTime() + legacyDurationMinutes * 60 * 1000,
            ).toISOString()
          : startsAt);

      return {
        ...poll,
        endsAt,
        participantGroupIds: dedupe(poll.participantGroupIds ?? []),
        title: poll.title?.trim() || `${(poll.questionIds ?? []).length} question poll`,
      };
    }),
    scheduledTests: parsed.scheduledTests ?? [],
  };
}

function isOwnedByActor(ownerId: string | null | undefined, actorId: string | null) {
  if (!actorId) {
    return true;
  }

  return Boolean(ownerId && ownerId === actorId);
}

function isGroupOwnedBy(group: ParticipantGroup, ownerIdentifier: string | null) {
  if (!group.ownerIdentifier || !ownerIdentifier) {
    return false;
  }

  return identifiersMatch(group.ownerIdentifier, ownerIdentifier);
}

function ensureParticipantProfile(
  state: TestingWorkspaceState,
  input: { identifier: string; label?: string },
) {
  const normalizedIdentifier = normalizeParticipantIdentifier(input.identifier);
  const existingParticipant = state.participants.find((participant) =>
    identifiersMatch(participant.identifier, normalizedIdentifier),
  );

  if (existingParticipant) {
    return existingParticipant;
  }

  const participant = createParticipantProfile({
    identifier: input.identifier,
    label: input.label,
  });

  state.participants = [participant, ...state.participants];
  return participant;
}

function getCompletedScheduledTest(state: TestingWorkspaceState, testId: string) {
  const scheduledTest = hydrateScheduledTests(state).find((test) => test.id === testId);

  if (!scheduledTest) {
    throw new Error("The selected test could not be found.");
  }

  if (scheduledTest.status !== "completed") {
    throw new Error("Questions can be reviewed after results are announced.");
  }

  return scheduledTest;
}

function syncQuestionPoolMemberships(
  state: TestingWorkspaceState,
  questionId: string,
  nextPoolIds: string[],
) {
  const normalizedPoolIds = dedupe(nextPoolIds).filter((poolId) =>
    state.pools.some((pool) => pool.id === poolId),
  );
  const timestamp = new Date().toISOString();

  state.questions = state.questions.map((question) =>
    question.id === questionId
      ? {
          ...question,
          poolIds: normalizedPoolIds,
          updatedAt: timestamp,
        }
      : question,
  );
  state.pools = state.pools.map((pool) => {
    const shouldInclude = normalizedPoolIds.includes(pool.id);
    const questionIds = shouldInclude
      ? dedupe([...pool.questionIds, questionId])
      : pool.questionIds.filter((savedId) => savedId !== questionId);

    return {
      ...pool,
      questionIds,
      updatedAt: timestamp,
    };
  });
}

function getQuestionMap(state: TestingWorkspaceState) {
  return new Map(state.questions.map((question) => [question.id, question]));
}

function canActorAccessPool(
  pool: QuestionPool,
  actorId: string | null,
  questionMap: Map<string, PersistentQuestion>,
) {
  if (!actorId) {
    return true;
  }

  if (isOwnedByActor(pool.createdBy, actorId)) {
    return true;
  }

  return pool.questionIds.some((questionId) => questionMap.get(questionId)?.createdBy === actorId);
}

function filterQuestionsForActor(questions: PersistentQuestion[], actorId: string | null) {
  if (!actorId) {
    return questions;
  }

  return questions.filter((question) => question.createdBy === actorId);
}

function filterPoolsForActor(
  pools: QuestionPool[],
  questionMap: Map<string, PersistentQuestion>,
  actorId: string | null,
) {
  if (!actorId) {
    return pools;
  }

  return pools.filter((pool) => canActorAccessPool(pool, actorId, questionMap));
}

function filterScheduledTestsForActor(tests: ScheduledTest[], actorId: string | null) {
  if (!actorId) {
    return tests;
  }

  return tests.filter((test) => test.createdBy === actorId);
}

function filterPollQuestionsForActor(questions: PersistentPollQuestion[], actorId: string | null) {
  if (!actorId) {
    return questions;
  }

  return questions.filter((question) => question.createdBy === actorId);
}

function filterScheduledPollsForActor(polls: ScheduledPoll[], actorId: string | null) {
  if (!actorId) {
    return polls;
  }

  return polls.filter((poll) => poll.createdBy === actorId);
}

function ensureActorOwnsQuestion(
  state: TestingWorkspaceState,
  questionId: string,
  actorId: string | null,
) {
  const question = state.questions.find((entry) => entry.id === questionId);

  if (!question) {
    throw new Error("Question not found.");
  }

  if (actorId && question.createdBy !== actorId) {
    throw new Error("You can only manage questions you created.");
  }

  return question;
}

function ensureActorOwnsPool(
  state: TestingWorkspaceState,
  poolId: string,
  actorId: string | null,
) {
  const pool = state.pools.find((entry) => entry.id === poolId);

  if (!pool) {
    throw new Error("Select a valid question pool.");
  }

  if (!canActorAccessPool(pool, actorId, getQuestionMap(state))) {
    throw new Error("You can only use question pools you created.");
  }

  return pool;
}

function ensureActorOwnsScheduledTest(
  state: TestingWorkspaceState,
  testId: string,
  actorId: string | null,
) {
  const scheduledTest = hydrateScheduledTests(state).find((test) => test.id === testId);

  if (!scheduledTest) {
    throw new Error("The selected test could not be found.");
  }

  if (actorId && scheduledTest.createdBy !== actorId) {
    throw new Error("You can only review tests you scheduled.");
  }

  return scheduledTest;
}

function ensureActorOwnsPollQuestion(
  state: TestingWorkspaceState,
  questionId: string,
  actorId: string | null,
) {
  const question = state.pollQuestions.find((entry) => entry.id === questionId);

  if (!question) {
    throw new Error("Poll question not found.");
  }

  if (actorId && question.createdBy !== actorId) {
    throw new Error("You can only manage poll questions you created.");
  }

  return question;
}

function resolveScheduledPollStatus(
  poll: Pick<ScheduledPoll, "endsAt" | "startsAt">,
): ScheduledPoll["status"] {
  const startsAtMs = new Date(poll.startsAt).getTime();
  const endsAtMs = new Date(poll.endsAt).getTime();

  if (startsAtMs > Date.now()) {
    return "scheduled";
  }

  if (Date.now() >= endsAtMs) {
    return "completed";
  }

  return "live";
}

function hydrateScheduledPolls(state: TestingWorkspaceState) {
  return state.scheduledPolls.map((poll) => ({
    ...poll,
    status: resolveScheduledPollStatus(poll),
  }));
}

function getParticipantMap(state: TestingWorkspaceState) {
  return new Map(state.participants.map((participant) => [participant.id, participant]));
}

function getGroupMap(state: TestingWorkspaceState) {
  return new Map(state.participantGroups.map((group) => [group.id, group]));
}

function resolveParticipantIdentifiers(
  state: TestingWorkspaceState,
  participantIds: string[],
  participantGroupIds: string[],
) {
  const participantMap = getParticipantMap(state);
  const groupMap = getGroupMap(state);
  const directIdentifiers = participantIds
    .map((participantId) => participantMap.get(participantId)?.identifier ?? "")
    .filter(Boolean);
  const groupIdentifiers = participantGroupIds.flatMap((groupId) => {
    const group = groupMap.get(groupId);

    if (!group) {
      return [];
    }

    return group.participantIds
      .map((participantId) => participantMap.get(participantId)?.identifier ?? "")
      .filter(Boolean);
  });

  return dedupe(
    [...directIdentifiers, ...groupIdentifiers].map(normalizeParticipantIdentifier),
  );
}

function hydrateScheduledTests(state: TestingWorkspaceState) {
  return state.scheduledTests.map((scheduledTest) => ({
    ...scheduledTest,
    status: resolveScheduledTestStatus(scheduledTest, state.attempts, scheduledTest.id),
  }));
}

async function readStore(): Promise<TestingWorkspaceState> {
  await ensureStoreDirectory();

  try {
    const content = await readFile(STORE_PATH, "utf8");
    const parsed = JSON.parse(content) as Partial<TestingWorkspaceState>;

    return normalizeState(parsed);
  } catch {
    const emptyState = createEmptyTestingWorkspaceState();
    await writeStore(emptyState);
    return emptyState;
  }
}

async function writeStore(state: TestingWorkspaceState) {
  await ensureStoreDirectory();
  await writeFile(STORE_PATH, JSON.stringify(state, null, 2), "utf8");
}

async function assignUnownedGroupsToOwner(ownerIdentifier: string) {
  const state = await readStore();
  const normalizedOwnerIdentifier = ownerIdentifier.trim();

  if (!normalizedOwnerIdentifier) {
    return state.participantGroups;
  }

  let didChange = false;
  const participantGroups = state.participantGroups.map((group) => {
    if (group.ownerIdentifier) {
      return group;
    }

    didChange = true;

    return {
      ...group,
      ownerIdentifier: normalizedOwnerIdentifier,
      updatedAt: new Date().toISOString(),
    };
  });

  if (didChange) {
    state.participantGroups = participantGroups;
    await writeStore(state);
  }

  return participantGroups;
}

export async function listQuestions(actorId: string | null = null) {
  const state = await readStore();
  return filterQuestionsForActor(state.questions, actorId);
}

export async function createQuestion(
  draft: QuestionDraft,
  actorId: string | null,
  source: QuestionImportSource = "manual",
  poolIds: string[] = [],
) {
  const state = await readStore();
  const normalizedPoolIds = dedupe(poolIds);

  for (const poolId of normalizedPoolIds) {
    ensureActorOwnsPool(state, poolId, actorId);
  }

  const question = createPersistentQuestion(draft, {
    createdBy: actorId,
    poolIds: normalizedPoolIds,
    source,
  });

  state.questions = [question, ...state.questions];
  syncQuestionPoolMemberships(state, question.id, question.poolIds);
  await writeStore(state);

  return filterQuestionsForActor(state.questions, actorId);
}

export async function importQuestions(
  drafts: QuestionDraft[],
  actorId: string | null,
  poolIds: string[] = [],
) {
  const state = await readStore();
  const normalizedPoolIds = dedupe(poolIds);

  for (const poolId of normalizedPoolIds) {
    ensureActorOwnsPool(state, poolId, actorId);
  }

  const importedQuestions = drafts.map((draft) =>
    createPersistentQuestion(draft, {
      createdBy: actorId,
      poolIds: normalizedPoolIds,
      source: "ocr-import",
    }),
  );

  state.questions = [...importedQuestions.reverse(), ...state.questions];

  for (const question of importedQuestions) {
    syncQuestionPoolMemberships(state, question.id, question.poolIds);
  }

  await writeStore(state);

  return filterQuestionsForActor(state.questions, actorId);
}

export async function updateQuestionPools(questionId: string, poolIds: string[]) {
  const state = await readStore();
  syncQuestionPoolMemberships(state, questionId, poolIds);
  await writeStore(state);
  return state.questions;
}

export async function updateQuestion(
  questionId: string,
  updates: {
    draft?: QuestionDraft;
    poolIds?: string[];
  },
  actorId: string | null = null,
) {
  const state = await readStore();
  ensureActorOwnsQuestion(state, questionId, actorId);

  if (updates.draft) {
    const normalizedDraft = normalizeDraft(updates.draft);
    const timestamp = new Date().toISOString();

    state.questions = state.questions.map((question) =>
      question.id === questionId
        ? {
            ...question,
            correctOptionIndex: normalizedDraft.correctOptionIndex,
            options: normalizedDraft.options,
            prompt: normalizedDraft.prompt,
            updatedAt: timestamp,
          }
        : question,
    );
  }

  if (updates.poolIds) {
    for (const poolId of dedupe(updates.poolIds)) {
      ensureActorOwnsPool(state, poolId, actorId);
    }

    syncQuestionPoolMemberships(state, questionId, updates.poolIds);
  }

  await writeStore(state);
  return filterQuestionsForActor(state.questions, actorId);
}

export async function deleteQuestion(questionId: string, actorId: string | null = null) {
  const state = await readStore();
  ensureActorOwnsQuestion(state, questionId, actorId);

  state.questions = state.questions.filter((question) => question.id !== questionId);
  state.pools = state.pools.map((pool) => ({
    ...pool,
    questionIds: pool.questionIds.filter((savedId) => savedId !== questionId),
    updatedAt: new Date().toISOString(),
  }));
  await writeStore(state);

  return filterQuestionsForActor(state.questions, actorId);
}

export async function deleteQuestions(questionIds: string[], actorId: string | null = null) {
  const normalizedQuestionIds = dedupe(questionIds);

  if (!normalizedQuestionIds.length) {
    throw new Error("Select at least one question to remove.");
  }

  const state = await readStore();

  for (const questionId of normalizedQuestionIds) {
    ensureActorOwnsQuestion(state, questionId, actorId);
  }

  state.questions = state.questions.filter(
    (question) => !normalizedQuestionIds.includes(question.id),
  );
  state.pools = state.pools.map((pool) => ({
    ...pool,
    questionIds: pool.questionIds.filter(
      (savedId) => !normalizedQuestionIds.includes(savedId),
    ),
    updatedAt: new Date().toISOString(),
  }));
  await writeStore(state);

  return filterQuestionsForActor(state.questions, actorId);
}

export async function clearQuestions(actorId: string | null = null) {
  if (actorId) {
    throw new Error("Clear all questions is not available for scoped admin workspaces.");
  }

  const state = await readStore();
  state.questions = [];
  state.pools = state.pools.map((pool) => ({
    ...pool,
    questionIds: [],
    updatedAt: new Date().toISOString(),
  }));
  state.scheduledTests = [];
  state.attempts = [];
  await writeStore(state);

  return state.questions;
}

export async function previewImport(text: string): Promise<BulkImportPreview> {
  return previewQuestionImport(text);
}

export async function listPollQuestions(actorId: string | null = null) {
  if (isDynamoDbPollStoreEnabled()) {
    return withPollStoreFallback(
      () => listPollQuestionsFromBackend(actorId),
      async () => {
        const state = await readStore();
        return filterPollQuestionsForActor(state.pollQuestions, actorId);
      },
    );
  }

  const state = await readStore();
  return filterPollQuestionsForActor(state.pollQuestions, actorId);
}

export async function createPollQuestions(
  drafts: PollQuestionDraft[],
  actorId: string | null,
) {
  if (isDynamoDbPollStoreEnabled()) {
    return withPollStoreFallback(
      () => createPollQuestionsInBackend(drafts, actorId),
      async () => {
        const state = await readStore();
        const normalizedDrafts = drafts.map((draft) => normalizePollQuestionDraft(draft));

        for (const draft of normalizedDrafts) {
          const validationError = validatePollQuestionDraft(draft);

          if (validationError) {
            throw new Error(validationError);
          }
        }

        const pollQuestions = normalizedDrafts.map((draft) =>
          createPersistentPollQuestion(draft, { createdBy: actorId }),
        );

        state.pollQuestions = [...pollQuestions.reverse(), ...state.pollQuestions];
        await writeStore(state);

        return filterPollQuestionsForActor(state.pollQuestions, actorId);
      },
    );
  }

  const state = await readStore();
  const normalizedDrafts = drafts.map((draft) => normalizePollQuestionDraft(draft));

  for (const draft of normalizedDrafts) {
    const validationError = validatePollQuestionDraft(draft);

    if (validationError) {
      throw new Error(validationError);
    }
  }

  const pollQuestions = normalizedDrafts.map((draft) =>
    createPersistentPollQuestion(draft, { createdBy: actorId }),
  );

  state.pollQuestions = [...pollQuestions.reverse(), ...state.pollQuestions];
  await writeStore(state);

  return filterPollQuestionsForActor(state.pollQuestions, actorId);
}

export async function listScheduledPolls(actorId: string | null = null) {
  if (isDynamoDbPollStoreEnabled()) {
    return withPollStoreFallback(
      () => listScheduledPollsFromBackend(actorId),
      async () => {
        const state = await readStore();
        return filterScheduledPollsForActor(hydrateScheduledPolls(state), actorId);
      },
    );
  }

  const state = await readStore();
  return filterScheduledPollsForActor(hydrateScheduledPolls(state), actorId);
}

export async function createScheduledPoll(input: {
  anonymous: boolean;
  createdBy: string | null;
  endsAt: string;
  generateQrCode: boolean;
  participantGroupIds: string[];
  participantType: PollParticipantType;
  questionIds: string[];
  startsAt: string;
  title: string;
}) {
  if (isDynamoDbPollStoreEnabled()) {
    return withPollStoreFallback(
      () => createScheduledPollInBackend(input),
      async () => {
        const state = await readStore();
        const questionIds = dedupe(input.questionIds);

        if (!questionIds.length) {
          throw new Error("Select at least one poll question.");
        }

        for (const questionId of questionIds) {
          ensureActorOwnsPollQuestion(state, questionId, input.createdBy);
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

        const timestamp = new Date().toISOString();
        const shareCode = input.participantType === "open"
          ? `TRAPIT-POLL-${createEntityId("access").replace(/-/g, "").toUpperCase()}`
          : null;
        const scheduledPoll: ScheduledPoll = {
          anonymous: input.anonymous,
          createdAt: timestamp,
          createdBy: input.createdBy,
          endsAt: input.endsAt,
          id: createEntityId("poll"),
          participantGroupIds: dedupe(input.participantGroupIds),
          participantType: input.participantType,
          questionIds,
          shareCode,
          startsAt: input.startsAt,
          status: resolveScheduledPollStatus({ endsAt: input.endsAt, startsAt: input.startsAt }),
          title,
          updatedAt: timestamp,
        };

        state.scheduledPolls = [scheduledPoll, ...state.scheduledPolls];
        await writeStore(state);

        return filterScheduledPollsForActor(hydrateScheduledPolls(state), input.createdBy);
      },
    );
  }

  const state = await readStore();
  const questionIds = dedupe(input.questionIds);

  if (!questionIds.length) {
    throw new Error("Select at least one poll question.");
  }

  for (const questionId of questionIds) {
    ensureActorOwnsPollQuestion(state, questionId, input.createdBy);
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

  const timestamp = new Date().toISOString();
  const shareCode = input.participantType === "open"
    ? `TRAPIT-POLL-${createEntityId("access").replace(/-/g, "").toUpperCase()}`
    : null;
  const scheduledPoll: ScheduledPoll = {
    anonymous: input.anonymous,
    createdAt: timestamp,
    createdBy: input.createdBy,
    endsAt: input.endsAt,
    id: createEntityId("poll"),
    participantGroupIds: dedupe(input.participantGroupIds),
    participantType: input.participantType,
    questionIds,
    shareCode,
    startsAt: input.startsAt,
    status: resolveScheduledPollStatus({ endsAt: input.endsAt, startsAt: input.startsAt }),
    title,
    updatedAt: timestamp,
  };

  state.scheduledPolls = [scheduledPoll, ...state.scheduledPolls];
  await writeStore(state);

  return filterScheduledPollsForActor(hydrateScheduledPolls(state), input.createdBy);
}

export async function listPools() {
  const state = await readStore();
  return filterPoolsForActor(state.pools, getQuestionMap(state), null);
}

export async function listPoolsForActor(actorId: string | null = null) {
  const state = await readStore();
  return filterPoolsForActor(state.pools, getQuestionMap(state), actorId);
}

export async function createPool(input: {
  createdBy?: string | null;
  description?: string;
  name: string;
}) {
  const state = await readStore();
  const timestamp = new Date().toISOString();
  const pool: QuestionPool = {
    createdAt: timestamp,
    createdBy: input.createdBy ?? null,
    description: input.description?.trim() ?? "",
    id: createEntityId("pool"),
    name: input.name.trim(),
    questionIds: [],
    updatedAt: timestamp,
  };

  state.pools = [pool, ...state.pools];
  await writeStore(state);

  return filterPoolsForActor(state.pools, getQuestionMap(state), input.createdBy ?? null);
}

export async function listParticipants() {
  const state = await readStore();
  return state.participants;
}

export async function createParticipant(input: {
  identifier: string;
  label?: string;
}) {
  const state = await readStore();
  const normalizedIdentifier = normalizeParticipantIdentifier(input.identifier);

  if (
    state.participants.some(
      (participant) => identifiersMatch(participant.identifier, normalizedIdentifier),
    )
  ) {
    return state.participants;
  }

  const participant = createParticipantProfile(input);
  state.participants = [participant, ...state.participants];
  await writeStore(state);

  return state.participants;
}

export async function syncParticipants(
  inputs: Array<{
    identifier: string;
    label?: string;
  }>,
) {
  const state = await readStore();
  const nextParticipants = [...state.participants];
  let didChange = false;

  for (const input of inputs) {
    const normalizedIdentifier = normalizeParticipantIdentifier(input.identifier);

    if (!normalizedIdentifier) {
      continue;
    }

    if (
      nextParticipants.some((participant) => identifiersMatch(participant.identifier, normalizedIdentifier))
    ) {
      continue;
    }

    nextParticipants.unshift(
      createParticipantProfile({
        identifier: input.identifier,
        label: input.label,
      }),
    );
    didChange = true;
  }

  if (didChange) {
    state.participants = nextParticipants;
    await writeStore(state);
  }

  return nextParticipants;
}

export async function listParticipantGroups() {
  const state = await readStore();
  return state.participantGroups;
}

export async function listParticipantGroupsForOwner(
  ownerIdentifier: string,
  options?: { includeUnowned?: boolean },
) {
  const participantGroups = options?.includeUnowned
    ? await assignUnownedGroupsToOwner(ownerIdentifier)
    : (await readStore()).participantGroups;

  return participantGroups.filter((group) => {
    if (isGroupOwnedBy(group, ownerIdentifier)) {
      return true;
    }

    return options?.includeUnowned ? !group.ownerIdentifier : false;
  });
}

export async function searchParticipantGroupsByOwner(ownerIdentifier: string) {
  const state = await readStore();

  return state.participantGroups.filter((group) => isGroupOwnedBy(group, ownerIdentifier));
}

export async function createGroup(input: {
  description?: string;
  name: string;
  ownerIdentifier: string | null;
  participantIds: string[];
}) {
  const state = await readStore();
  const group = createParticipantGroup({
    description: input.description,
    name: input.name,
    ownerIdentifier: input.ownerIdentifier,
    participantIds: input.participantIds,
  });

  state.participantGroups = [group, ...state.participantGroups];
  await writeStore(state);

  return state.participantGroups;
}

export async function updateGroup(input: {
  groupId: string;
  name: string;
  ownerIdentifier: string | null;
  participantIds: string[];
}) {
  const state = await readStore();
  const existingGroup = state.participantGroups.find((group) => group.id === input.groupId);

  if (!existingGroup) {
    throw new Error("Group not found.");
  }

  if (
    existingGroup.ownerIdentifier &&
    input.ownerIdentifier &&
    !identifiersMatch(existingGroup.ownerIdentifier, input.ownerIdentifier)
  ) {
    throw new Error("You can only update your own groups.");
  }

  const timestamp = new Date().toISOString();

  state.participantGroups = state.participantGroups.map((group) =>
    group.id === input.groupId
      ? {
          ...group,
          name: input.name.trim(),
          ownerIdentifier: group.ownerIdentifier ?? input.ownerIdentifier,
          participantIds: dedupe(input.participantIds),
          updatedAt: timestamp,
        }
      : group,
  );

  await writeStore(state);

  return state.participantGroups;
}

export async function listGroupJoinRequestsForAdmin(adminIdentifier: string) {
  const state = await readStore();
  const normalizedIdentifier = normalizeParticipantIdentifier(adminIdentifier);

  return state.groupJoinRequests.filter((request) =>
    identifiersMatch(request.adminIdentifier, normalizedIdentifier),
  );
}

export async function listGroupJoinRequestsForUser(requesterId: string) {
  const state = await readStore();
  const normalizedRequesterId = normalizeParticipantIdentifier(requesterId);

  return state.groupJoinRequests.filter((request) =>
    identifiersMatch(request.requesterId, normalizedRequesterId),
  );
}

export async function createGroupJoinRequest(input: {
  adminGroupId: string;
  requesterId: string;
  requesterLabel: string;
}) {
  const state = await readStore();
  const normalizedRequesterId = normalizeParticipantIdentifier(input.requesterId);
  const group = state.participantGroups.find((entry) => entry.id === input.adminGroupId);

  if (!group) {
    throw new Error("Group not found.");
  }

  if (!group.ownerIdentifier) {
    throw new Error("This group is not linked to an admin account yet.");
  }

  const participantMap = getParticipantMap(state);
  const isExistingMember = group.participantIds.some((participantId) => {
    const participant = participantMap.get(participantId);

    return participant ? identifiersMatch(participant.identifier, normalizedRequesterId) : false;
  });

  if (isExistingMember) {
    throw new Error("You are already part of this group.");
  }

  const hasPendingRequest = state.groupJoinRequests.some(
    (request) =>
      request.adminGroupId === group.id &&
      identifiersMatch(request.requesterId, normalizedRequesterId) &&
      request.status === "pending",
  );

  if (hasPendingRequest) {
    throw new Error("A request for this group is already pending.");
  }

  const request = createStoredGroupJoinRequest({
    adminGroupId: group.id,
    adminIdentifier: group.ownerIdentifier,
    adminGroupName: group.name,
    requesterId: normalizedRequesterId,
    requesterLabel: input.requesterLabel.trim() || normalizedRequesterId,
  });

  state.groupJoinRequests = [request, ...state.groupJoinRequests];
  await writeStore(state);

  return request;
}

export async function resolveGroupJoinRequest(input: {
  adminIdentifier: string;
  decision: "accept" | "reject";
  requestId: string;
}) {
  const state = await readStore();
  const normalizedAdminIdentifier = normalizeParticipantIdentifier(input.adminIdentifier);
  const request = state.groupJoinRequests.find((entry) => entry.id === input.requestId);

  if (!request) {
    throw new Error("Request not found.");
  }

  if (!identifiersMatch(request.adminIdentifier, normalizedAdminIdentifier)) {
    throw new Error("You can only manage requests for your own groups.");
  }

  if (request.status !== "pending") {
    throw new Error("This request has already been processed.");
  }

  const timestamp = new Date().toISOString();

  if (input.decision === "accept") {
    const group = state.participantGroups.find((entry) => entry.id === request.adminGroupId);

    if (!group) {
      throw new Error("The selected group could not be found.");
    }

    const participant = ensureParticipantProfile(state, {
      identifier: request.requesterId,
      label: request.requesterLabel,
    });

    state.participantGroups = state.participantGroups.map((entry) =>
      entry.id === group.id
        ? {
            ...entry,
            participantIds: dedupe([...entry.participantIds, participant.id]),
            updatedAt: timestamp,
          }
        : entry,
    );
  }

  state.groupJoinRequests = state.groupJoinRequests.map((entry) =>
    entry.id === request.id
      ? {
          ...entry,
          resolvedAt: timestamp,
          status: input.decision === "accept" ? "accepted" : "rejected",
        }
      : entry,
  );

  await writeStore(state);

  return {
    groupJoinRequests: state.groupJoinRequests,
    participantGroups: state.participantGroups,
    participants: state.participants,
  };
}

export async function listScheduledTests(actorId: string | null = null) {
  const state = await readStore();
  return filterScheduledTestsForActor(hydrateScheduledTests(state), actorId);
}

export async function createScheduledTest(input: {
  createdBy: string | null;
  durationMinutes: number;
  participantGroupIds: string[];
  participantIds: string[];
  poolId: string;
  questionCount: number;
  startsAt: string;
}) {
  const state = await readStore();
  const pool = ensureActorOwnsPool(state, input.poolId, input.createdBy);

  const poolQuestionIds = dedupe(pool.questionIds).filter((questionId) =>
    state.questions.some((question) => question.id === questionId),
  );

  if (input.questionCount > poolQuestionIds.length) {
    throw new Error("Question count cannot exceed the number of questions in the selected pool.");
  }

  const resolvedParticipantIdentifiers = resolveParticipantIdentifiers(
    state,
    dedupe(input.participantIds),
    dedupe(input.participantGroupIds),
  );

  if (!resolvedParticipantIdentifiers.length) {
    throw new Error("Choose at least one participant or group.");
  }

  const timestamp = new Date().toISOString();
  const scheduledTest: ScheduledTest = {
    createdAt: timestamp,
    createdBy: input.createdBy,
    durationMinutes: input.durationMinutes,
    id: createEntityId("test"),
    participantGroupIds: dedupe(input.participantGroupIds),
    participantIds: dedupe(input.participantIds),
    poolId: input.poolId,
    questionCount: input.questionCount,
    questionIds: selectQuestionIdsForScheduledTest(
      poolQuestionIds,
      input.questionCount,
      [input.poolId, input.startsAt, resolvedParticipantIdentifiers.join(",")].join(":"),
    ),
    resolvedParticipantIdentifiers,
    startsAt: input.startsAt,
    status: new Date(input.startsAt).getTime() > Date.now() ? "scheduled" : "live",
    title: `${pool.name} test`,
    updatedAt: timestamp,
  };

  state.scheduledTests = [scheduledTest, ...state.scheduledTests];
  await writeStore(state);

  return filterScheduledTestsForActor(hydrateScheduledTests(state), input.createdBy);
}

export async function listHistory(actorId: string | null = null) {
  const state = await readStore();
  const scheduledTests = filterScheduledTestsForActor(hydrateScheduledTests(state), actorId);
  const scheduledTestIds = new Set(scheduledTests.map((scheduledTest) => scheduledTest.id));
  const attempts = state.attempts.filter((attempt) => scheduledTestIds.has(attempt.testId));

  return summarizeTestHistory(attempts, scheduledTests);
}

export async function listLeaderboards(actorId: string | null = null) {
  const state = await readStore();
  const scheduledTests = filterScheduledTestsForActor(hydrateScheduledTests(state), actorId);
  const scheduledTestIds = new Set(scheduledTests.map((scheduledTest) => scheduledTest.id));
  const attempts = state.attempts.filter((attempt) => scheduledTestIds.has(attempt.testId));

  return buildTestLeaderboards(attempts, scheduledTests).filter(
    (leaderboard) =>
      scheduledTests.some(
        (scheduledTest) =>
          scheduledTest.id === leaderboard.testId && scheduledTest.status === "completed",
      ),
  );
}

export async function listStateSummary(input?: {
  actorIdentifier?: string | null;
  actorSub?: string | null;
}) {
  const state = await readStore();
  const actorSub = input?.actorSub ?? null;
  const actorIdentifier = input?.actorIdentifier ?? null;
  const questionMap = getQuestionMap(state);
  const visibleQuestions = filterQuestionsForActor(state.questions, actorSub);
  const visiblePools = filterPoolsForActor(state.pools, questionMap, actorSub);
  const visibleScheduledTests = filterScheduledTestsForActor(hydrateScheduledTests(state), actorSub);
  const visibleScheduledTestIds = new Set(visibleScheduledTests.map((test) => test.id));
  const visibleAttempts = state.attempts.filter((attempt) => visibleScheduledTestIds.has(attempt.testId));
  const visibleGroups = actorIdentifier
    ? state.participantGroups.filter((group) => isGroupOwnedBy(group, actorIdentifier))
    : state.participantGroups;

  return {
    attempts: visibleAttempts.length,
    groups: visibleGroups.length,
    participants: state.participants.length,
    pools: visiblePools.length,
    questions: visibleQuestions.length,
    scheduledTests: visibleScheduledTests.length,
  };
}

export async function listUserHistory(identifier: string) {
  const state = await readStore();
  const normalizedIdentifier = normalizeParticipantIdentifier(identifier);
  const scheduledTests = hydrateScheduledTests(state);
  const submittedAttempts = state.attempts.filter((attempt) =>
    identifiersMatch(attempt.userId, normalizedIdentifier),
  );
  const submittedHistory = summarizeTestHistory(submittedAttempts, scheduledTests);
  const missedHistory = scheduledTests
    .filter(
      (scheduledTest) =>
        scheduledTest.status === "completed" &&
        scheduledTest.resolvedParticipantIdentifiers.some((participantIdentifier) =>
          identifiersMatch(participantIdentifier, normalizedIdentifier),
        ) &&
        !submittedAttempts.some((attempt) => attempt.testId === scheduledTest.id),
    )
    .map((scheduledTest) => ({
      attemptId: `missed-${scheduledTest.id}-${normalizedIdentifier}`,
      completedAt: getScheduledTestEndTime(scheduledTest),
      correctCount: 0,
      elapsedMs: 0,
      incorrectCount: 0,
      participantId: normalizedIdentifier,
      participantName: undefined,
      status: "missed" as const,
      testId: scheduledTest.id,
      testTitle: scheduledTest.title,
      totalCount: scheduledTest.questionCount,
    }));

  return [...submittedHistory, ...missedHistory].sort(
    (left, right) =>
      new Date(right.completedAt).getTime() - new Date(left.completedAt).getTime(),
  );
}

export async function listAvailableTestsForParticipant(
  identifier: string,
): Promise<AvailableUserTest[]> {
  const state = await readStore();
  const normalizedIdentifier = normalizeParticipantIdentifier(identifier);
  const scheduledTests = hydrateScheduledTests(state).filter((scheduledTest) =>
    scheduledTest.resolvedParticipantIdentifiers.some((participantIdentifier) =>
      identifiersMatch(participantIdentifier, normalizedIdentifier),
    ),
  );
  const leaderboardByTestId = new Map(
    buildTestLeaderboards(state.attempts, scheduledTests).map((leaderboard) => [
      leaderboard.testId,
      leaderboard,
    ]),
  );
  const questionMap = getQuestionMap(state);

  return scheduledTests
    .map((scheduledTest) => ({
    durationMinutes: scheduledTest.durationMinutes,
    hasAttempt: state.attempts.some(
      (attempt) =>
        attempt.testId === scheduledTest.id && identifiersMatch(attempt.userId, normalizedIdentifier),
    ),
    id: scheduledTest.id,
    poolId: scheduledTest.poolId,
    topPerformer: (() => {
      const topEntry = leaderboardByTestId.get(scheduledTest.id)?.entries[0];

      if (!topEntry) {
        return undefined;
      }

      return {
        correctCount: topEntry.correctCount,
        elapsedMs: topEntry.elapsedMs,
        participantName: topEntry.participantName?.trim() || topEntry.participantId,
      };
    })(),
    questionCount: scheduledTest.questionCount,
    questions: scheduledTest.questionIds
      .map((questionId) => questionMap.get(questionId))
      .filter((question): question is PersistentQuestion => Boolean(question)),
    startsAt: scheduledTest.startsAt,
    status: scheduledTest.status,
    title: scheduledTest.title,
  }))
    .sort((left, right) => {
      if (left.status === "completed" && right.status !== "completed") {
        return 1;
      }

      if (left.status !== "completed" && right.status === "completed") {
        return -1;
      }

      return new Date(right.startsAt).getTime() - new Date(left.startsAt).getTime();
    });
}

export async function listAvailablePollsForParticipant(identifier: string): Promise<ScheduledPoll[]> {
  const state = await readStore();
  const normalizedIdentifier = normalizeParticipantIdentifier(identifier);
  const pollStatusPriority: Record<ScheduledPoll["status"], number> = {
    live: 0,
    scheduled: 1,
    completed: 2,
  };
  const participantProfileIds = state.participants
    .filter((participant) => identifiersMatch(participant.identifier, normalizedIdentifier))
    .map((participant) => participant.id);
  const participantGroupIds = new Set(
    state.participantGroups
      .filter((group) =>
        group.participantIds.some((participantId) => participantProfileIds.includes(participantId)),
      )
      .map((group) => group.id),
  );

  const scheduledPolls = isDynamoDbPollStoreEnabled()
    ? await withPollStoreFallback(
      () => listAllScheduledPollsFromBackend(),
      async () => hydrateScheduledPolls(state),
    )
    : hydrateScheduledPolls(state);

  return scheduledPolls
    .filter((poll) => {
      if (poll.participantType === "open") {
        return true;
      }

      return poll.participantGroupIds.some((groupId) => participantGroupIds.has(groupId));
    })
    .sort((leftPoll, rightPoll) => {
      const priorityDifference =
        pollStatusPriority[leftPoll.status] - pollStatusPriority[rightPoll.status];

      if (priorityDifference !== 0) {
        return priorityDifference;
      }

      return new Date(rightPoll.startsAt).getTime() - new Date(leftPoll.startsAt).getTime();
    });
}

export async function getPollByShareCode(shareCode: string, viewerId?: string | null) {
  if (isDynamoDbPollStoreEnabled()) {
    return withPollStoreFallback(
      () => getPollByShareCodeFromBackend(shareCode, viewerId),
      async () => {
        const state = await readStore();
        const normalizedShareCode = shareCode.trim().toUpperCase();
        const poll = hydrateScheduledPolls(state).find(
          (entry) => entry.shareCode?.trim().toUpperCase() === normalizedShareCode,
        );

        if (!poll) {
          throw new Error("The selected poll could not be found.");
        }

        const questionMap = new Map(state.pollQuestions.map((question) => [question.id, question]));
        const questions = poll.questionIds
          .map((questionId) => questionMap.get(questionId))
          .filter((question): question is PersistentPollQuestion => Boolean(question));
        const attempts = state.pollAttempts.filter((attempt) => attempt.pollId === poll.id);
        const hasSubmitted = viewerId
          ? attempts.some((attempt) => identifiersMatch(attempt.userId, viewerId))
          : false;
        const summary = questions.map((question) => {
          const optionSelectionCounts = question.options.map(
            (_, optionIndex) =>
              attempts.filter((attempt) => attempt.answers[question.id] === optionIndex).length,
          );

          return {
            optionSelectionCounts,
            options: question.options,
            prompt: question.prompt,
            questionId: question.id,
            topic: question.topic,
            totalResponses: attempts.length,
          };
        });

        return {
          poll,
          questions,
          hasSubmitted,
          summary,
          totalResponses: attempts.length,
        };
      },
    );
  }

  const state = await readStore();
  const normalizedShareCode = shareCode.trim().toUpperCase();
  const poll = hydrateScheduledPolls(state).find(
    (entry) => entry.shareCode?.trim().toUpperCase() === normalizedShareCode,
  );

  if (!poll) {
    throw new Error("The selected poll could not be found.");
  }

  const questionMap = new Map(state.pollQuestions.map((question) => [question.id, question]));
  const questions = poll.questionIds
    .map((questionId) => questionMap.get(questionId))
    .filter((question): question is PersistentPollQuestion => Boolean(question));
  const attempts = state.pollAttempts.filter((attempt) => attempt.pollId === poll.id);
  const hasSubmitted = viewerId
    ? attempts.some((attempt) => identifiersMatch(attempt.userId, viewerId))
    : false;
  const summary = questions.map((question) => {
    const optionSelectionCounts = question.options.map(
      (_, optionIndex) =>
        attempts.filter((attempt) => attempt.answers[question.id] === optionIndex).length,
    );

    return {
      optionSelectionCounts,
      options: question.options,
      prompt: question.prompt,
      questionId: question.id,
      topic: question.topic,
      totalResponses: attempts.length,
    };
  });

  return {
    poll,
    questions,
    hasSubmitted,
    summary,
    totalResponses: attempts.length,
  };
}

export async function recordPollAttempt(input: {
  answers: Record<string, number | undefined>;
  completedAt: string;
  participantName?: string;
  shareCode: string;
  startedAt: string;
  userId: string;
}) {
  if (isDynamoDbPollStoreEnabled()) {
    return withPollStoreFallback(
      () => recordPollAttemptInBackend(input),
      async () => {
        const state = await readStore();
        const normalizedUserId = normalizeParticipantIdentifier(input.userId);
        const normalizedShareCode = input.shareCode.trim().toUpperCase();
        const poll = hydrateScheduledPolls(state).find(
          (entry) => entry.shareCode?.trim().toUpperCase() === normalizedShareCode,
        );

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

        if (
          state.pollAttempts.some(
            (attempt) => attempt.pollId === poll.id && identifiersMatch(attempt.userId, normalizedUserId),
          )
        ) {
          throw new Error("This poll has already been submitted.");
        }

        const questionMap = new Map(state.pollQuestions.map((question) => [question.id, question]));
        const questions = poll.questionIds
          .map((questionId) => questionMap.get(questionId))
          .filter((question): question is PersistentPollQuestion => Boolean(question));
        const startedAtMs = new Date(input.startedAt).getTime();
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

        if (Number.isNaN(startedAtMs) || Number.isNaN(completedAtMs) || completedAtMs < startedAtMs) {
          throw new Error("The poll session timestamps are invalid.");
        }

        const attempt: PollAttempt = {
          answers: questions.reduce<Record<string, number>>((accumulator, question) => {
            accumulator[question.id] = input.answers[question.id] as number;
            return accumulator;
          }, {}),
          completedAt: input.completedAt,
          id: createEntityId("poll-attempt"),
          participantName,
          pollId: poll.id,
          startedAt: input.startedAt,
          userId: normalizedUserId,
        };

        state.pollAttempts = [attempt, ...state.pollAttempts];
        await writeStore(state);

        return attempt;
      },
    );
  }

  const state = await readStore();
  const normalizedUserId = normalizeParticipantIdentifier(input.userId);
  const normalizedShareCode = input.shareCode.trim().toUpperCase();
  const poll = hydrateScheduledPolls(state).find(
    (entry) => entry.shareCode?.trim().toUpperCase() === normalizedShareCode,
  );

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

  if (
    state.pollAttempts.some(
      (attempt) => attempt.pollId === poll.id && identifiersMatch(attempt.userId, normalizedUserId),
    )
  ) {
    throw new Error("This poll has already been submitted.");
  }

  const questionMap = new Map(state.pollQuestions.map((question) => [question.id, question]));
  const questions = poll.questionIds
    .map((questionId) => questionMap.get(questionId))
    .filter((question): question is PersistentPollQuestion => Boolean(question));
  const startedAtMs = new Date(input.startedAt).getTime();
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

  state.pollAttempts = [attempt, ...state.pollAttempts];
  await writeStore(state);

  return attempt;
}

export async function recordAttempt(input: {
  answers: Record<string, number | undefined>;
  completedAt: string;
  participantName?: string;
  startedAt: string;
  testId: string;
  userId: string;
}) {
  const state = await readStore();
  const normalizedUserId = normalizeParticipantIdentifier(input.userId);
  const scheduledTest = hydrateScheduledTests(state).find((test) => test.id === input.testId);

  if (!scheduledTest) {
    throw new Error("The selected test could not be found.");
  }

  if (
    !scheduledTest.resolvedParticipantIdentifiers.some((participantIdentifier) =>
      identifiersMatch(participantIdentifier, normalizedUserId),
    )
  ) {
    throw new Error("You are not assigned to this test.");
  }

  if (scheduledTest.status === "scheduled") {
    throw new Error("This test is not live yet.");
  }

  if (
    state.attempts.some(
      (attempt) => attempt.testId === input.testId && identifiersMatch(attempt.userId, normalizedUserId),
    )
  ) {
    throw new Error("This test has already been submitted.");
  }

  const questionMap = getQuestionMap(state);
  const questions = scheduledTest.questionIds
    .map((questionId) => questionMap.get(questionId))
    .filter((question): question is PersistentQuestion => Boolean(question));
  const startedAtMs = new Date(input.startedAt).getTime();
  const completedAtMs = new Date(input.completedAt).getTime();
  const startsAtMs = new Date(scheduledTest.startsAt).getTime();
  const endsAtMs = new Date(getScheduledTestEndTime(scheduledTest)).getTime();

  if (completedAtMs < startsAtMs) {
    throw new Error("This test is not live yet.");
  }

  if (completedAtMs > endsAtMs) {
    throw new Error("This test is no longer available.");
  }

  const participantName = input.participantName?.trim();

  if (!participantName) {
    throw new Error("Participant name is required before starting the test.");
  }

  const attempt: TestAttempt = {
    answers: input.answers,
    completedAt: input.completedAt,
    id: createEntityId("attempt"),
    participantName,
    result: scoreObjectiveTest(questions, input.answers, startedAtMs, completedAtMs),
    startedAt: input.startedAt,
    testId: input.testId,
    userId: normalizedUserId,
  };

  state.attempts = [attempt, ...state.attempts];

  const attemptsForTest = state.attempts.filter(
    (savedAttempt) => savedAttempt.testId === input.testId,
  );
  const higherScoreCount = attemptsForTest.filter((savedAttempt) => {
    if (savedAttempt.id === attempt.id) {
      return false;
    }

    return compareTestResults(savedAttempt.result, attempt.result) < 0;
  }).length;

  attempt.result = {
    ...attempt.result,
    assignedParticipantCount: scheduledTest.resolvedParticipantIdentifiers.length,
    incorrectCount: getIncorrectCount(attempt.result),
    rank: higherScoreCount + 1,
    rankedParticipantCount: attemptsForTest.length,
  };

  await writeStore(state);

  return attempt;
}

export async function getUserTestReview(testId: string, identifier: string) {
  const state = await readStore();
  const normalizedIdentifier = normalizeParticipantIdentifier(identifier);
  const scheduledTest = getCompletedScheduledTest(state, testId);

  if (
    !scheduledTest.resolvedParticipantIdentifiers.some((participantIdentifier) =>
      identifiersMatch(participantIdentifier, normalizedIdentifier),
    )
  ) {
    throw new Error("You are not assigned to this test.");
  }

  const attempt = state.attempts.find(
    (entry) => entry.testId === testId && identifiersMatch(entry.userId, normalizedIdentifier),
  );
  const questionMap = getQuestionMap(state);

  return {
    review: scheduledTest.questionIds
      .map((questionId) => questionMap.get(questionId))
      .filter((question): question is PersistentQuestion => Boolean(question))
      .map((question) => ({
        correctOptionIndex: question.correctOptionIndex,
        options: question.options,
        prompt: question.prompt,
        questionId: question.id,
        selectedOptionIndex: attempt?.answers[question.id],
      })),
    submittedAt: attempt?.completedAt ?? null,
    testId: scheduledTest.id,
    testTitle: scheduledTest.title,
  };
}

export async function getAdminTestReview(testId: string, actorId: string | null = null) {
  const state = await readStore();
  const scheduledTest = ensureActorOwnsScheduledTest(state, testId, actorId);

  if (scheduledTest.status !== "completed") {
    throw new Error("Questions can be reviewed after results are announced.");
  }

  const questionMap = getQuestionMap(state);
  const attempts = state.attempts.filter((attempt) => attempt.testId === testId);

  return {
    review: scheduledTest.questionIds
      .map((questionId) => questionMap.get(questionId))
      .filter((question): question is PersistentQuestion => Boolean(question))
      .map((question) => {
        const optionSelectionCounts = question.options.map(() => 0);

        for (const attempt of attempts) {
          const answerIndex = attempt.answers[question.id];

          if (
            typeof answerIndex === "number" &&
            answerIndex >= 0 &&
            answerIndex < optionSelectionCounts.length
          ) {
            optionSelectionCounts[answerIndex] += 1;
          }
        }

        return {
          correctOptionIndex: question.correctOptionIndex,
          optionSelectionCounts,
          options: question.options,
          prompt: question.prompt,
          questionId: question.id,
          totalResponses: optionSelectionCounts.reduce((total, count) => total + count, 0),
        };
      }),
    submittedCount: attempts.length,
    testId: scheduledTest.id,
    testTitle: scheduledTest.title,
  };
}

export async function getWorkspaceData() {
  const state = await readStore();
  const scheduledTests = hydrateScheduledTests(state);

  return {
    groupJoinRequests: state.groupJoinRequests,
    leaderboards: buildTestLeaderboards(state.attempts, scheduledTests).filter((leaderboard) =>
      scheduledTests.some(
        (scheduledTest) =>
          scheduledTest.id === leaderboard.testId && scheduledTest.status === "completed",
      ),
    ),
    history: summarizeTestHistory(state.attempts, scheduledTests),
    participantGroups: state.participantGroups,
    participants: state.participants,
    pools: state.pools,
    questions: state.questions,
    scheduledTests,
    summary: {
      attempts: state.attempts.length,
      groups: state.participantGroups.length,
      participants: state.participants.length,
      pools: state.pools.length,
      questions: state.questions.length,
      scheduledTests: state.scheduledTests.length,
    },
  };
}