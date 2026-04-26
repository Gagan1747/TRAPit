import "server-only";

import {
  buildTestLeaderboards,
  compareTestResults,
  createEmptyTestingWorkspaceState,
  createEntityId,
  createParticipantGroup,
  createParticipantProfile,
  createPersistentQuestion,
  getIncorrectCount,
  getScheduledTestEndTime,
  normalizeDraft,
  previewQuestionImport,
  resolveScheduledTestStatus,
  scoreObjectiveTest,
  sampleQuestions,
  summarizeTestHistory,
  type BulkImportPreview,
  type ObjectiveQuestion,
  type PersistentQuestion,
  type QuestionDraft,
  type QuestionImportSource,
  type QuestionPool,
  type ScheduledTest,
  type TestAttempt,
  type TestingWorkspaceState,
} from "@trapit/testing";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const STORE_PATH = path.join(process.cwd(), "data", "testing-workspace.json");

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
    participantGroups: parsed.participantGroups ?? [],
    participants: parsed.participants ?? [],
    pools: parsed.pools ?? [],
    questions: parsed.questions ?? [],
    scheduledTests: parsed.scheduledTests ?? [],
  };
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

export async function listQuestions() {
  const state = await readStore();
  return state.questions;
}

export async function createQuestion(
  draft: QuestionDraft,
  actorId: string | null,
  source: QuestionImportSource = "manual",
  poolIds: string[] = [],
) {
  const state = await readStore();
  const question = createPersistentQuestion(draft, {
    createdBy: actorId,
    poolIds: dedupe(poolIds),
    source,
  });

  state.questions = [question, ...state.questions];
  syncQuestionPoolMemberships(state, question.id, question.poolIds);
  await writeStore(state);

  return state.questions;
}

export async function importQuestions(
  drafts: QuestionDraft[],
  actorId: string | null,
  poolIds: string[] = [],
) {
  const state = await readStore();
  const importedQuestions = drafts.map((draft) =>
    createPersistentQuestion(draft, {
      createdBy: actorId,
      poolIds: dedupe(poolIds),
      source: "ocr-import",
    }),
  );

  state.questions = [...importedQuestions.reverse(), ...state.questions];

  for (const question of importedQuestions) {
    syncQuestionPoolMemberships(state, question.id, question.poolIds);
  }

  await writeStore(state);

  return state.questions;
}

export async function loadSampleQuestions(
  actorId: string | null,
  replaceExisting = true,
  poolIds: string[] = [],
) {
  const state = await readStore();
  const normalizedPoolIds = dedupe(poolIds);
  const seededQuestions = sampleQuestions.map((question) => {
    const timestamp = new Date().toISOString();

    return {
      ...question,
      createdAt: timestamp,
      createdBy: actorId,
      poolIds: normalizedPoolIds,
      source: "sample" as const,
      updatedAt: timestamp,
    } satisfies PersistentQuestion;
  });

  state.questions = replaceExisting ? seededQuestions : [...seededQuestions, ...state.questions];

  if (replaceExisting) {
    state.pools = state.pools.map((pool) => ({
      ...pool,
      questionIds: [],
      updatedAt: new Date().toISOString(),
    }));
  }

  for (const question of seededQuestions) {
    syncQuestionPoolMemberships(state, question.id, question.poolIds);
  }

  await writeStore(state);

  return state.questions;
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
) {
  const state = await readStore();
  const existingQuestion = state.questions.find((question) => question.id === questionId);

  if (!existingQuestion) {
    throw new Error("Question not found.");
  }

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
    syncQuestionPoolMemberships(state, questionId, updates.poolIds);
  }

  await writeStore(state);
  return state.questions;
}

export async function deleteQuestion(questionId: string) {
  const state = await readStore();

  state.questions = state.questions.filter((question) => question.id !== questionId);
  state.pools = state.pools.map((pool) => ({
    ...pool,
    questionIds: pool.questionIds.filter((savedId) => savedId !== questionId),
    updatedAt: new Date().toISOString(),
  }));
  await writeStore(state);

  return state.questions;
}

export async function clearQuestions() {
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

export async function listPools() {
  const state = await readStore();
  return state.pools;
}

export async function createPool(input: { description?: string; name: string }) {
  const state = await readStore();
  const timestamp = new Date().toISOString();
  const pool: QuestionPool = {
    createdAt: timestamp,
    description: input.description?.trim() ?? "",
    id: createEntityId("pool"),
    name: input.name.trim(),
    questionIds: [],
    updatedAt: timestamp,
  };

  state.pools = [pool, ...state.pools];
  await writeStore(state);

  return state.pools;
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

export async function createGroup(input: {
  description?: string;
  name: string;
  participantIds: string[];
}) {
  const state = await readStore();
  const group = createParticipantGroup({
    description: input.description,
    name: input.name,
    participantIds: input.participantIds,
  });

  state.participantGroups = [group, ...state.participantGroups];
  await writeStore(state);

  return state.participantGroups;
}

export async function updateGroup(input: {
  groupId: string;
  name: string;
  participantIds: string[];
}) {
  const state = await readStore();
  const existingGroup = state.participantGroups.find((group) => group.id === input.groupId);

  if (!existingGroup) {
    throw new Error("Group not found.");
  }

  const timestamp = new Date().toISOString();

  state.participantGroups = state.participantGroups.map((group) =>
    group.id === input.groupId
      ? {
          ...group,
          name: input.name.trim(),
          participantIds: dedupe(input.participantIds),
          updatedAt: timestamp,
        }
      : group,
  );

  await writeStore(state);

  return state.participantGroups;
}

export async function listScheduledTests() {
  const state = await readStore();
  return hydrateScheduledTests(state);
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
  const pool = state.pools.find((savedPool) => savedPool.id === input.poolId);

  if (!pool) {
    throw new Error("Select a valid question pool.");
  }

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
    questionIds: poolQuestionIds.slice(0, input.questionCount),
    resolvedParticipantIdentifiers,
    startsAt: input.startsAt,
    status: new Date(input.startsAt).getTime() > Date.now() ? "scheduled" : "live",
    title: `${pool.name} test`,
    updatedAt: timestamp,
  };

  state.scheduledTests = [scheduledTest, ...state.scheduledTests];
  await writeStore(state);

  return hydrateScheduledTests(state);
}

export async function listHistory() {
  const state = await readStore();
  const scheduledTests = hydrateScheduledTests(state);

  return summarizeTestHistory(state.attempts, scheduledTests);
}

export async function listLeaderboards() {
  const state = await readStore();
  const scheduledTests = hydrateScheduledTests(state);

  return buildTestLeaderboards(state.attempts, scheduledTests).filter(
    (leaderboard) =>
      scheduledTests.some(
        (scheduledTest) =>
          scheduledTest.id === leaderboard.testId && scheduledTest.status === "completed",
      ),
  );
}

export async function listStateSummary() {
  const state = await readStore();

  return {
    attempts: state.attempts.length,
    groups: state.participantGroups.length,
    participants: state.participants.length,
    pools: state.pools.length,
    questions: state.questions.length,
    scheduledTests: state.scheduledTests.length,
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

export async function getWorkspaceData() {
  const state = await readStore();
  const scheduledTests = hydrateScheduledTests(state);

  return {
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