import "server-only";

import {
  buildTestLeaderboards,
  compareTestResults,
  createGroupJoinRequest as createStoredGroupJoinRequest,
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
  type GroupJoinRequest,
  type ObjectiveQuestion,
  type ParticipantGroup,
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
    participantGroups: (parsed.participantGroups ?? []).map((group) => ({
      ...group,
      ownerIdentifier: group.ownerIdentifier?.trim() || null,
      participantIds: dedupe(group.participantIds ?? []),
    })),
    participants: parsed.participants ?? [],
    pools: parsed.pools ?? [],
    questions: parsed.questions ?? [],
    scheduledTests: parsed.scheduledTests ?? [],
  };
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

export async function deleteQuestions(questionIds: string[]) {
  const normalizedQuestionIds = dedupe(questionIds);

  if (!normalizedQuestionIds.length) {
    return listQuestions();
  }

  const state = await readStore();

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

export async function getAdminTestReview(testId: string) {
  const state = await readStore();
  const scheduledTest = getCompletedScheduledTest(state, testId);
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