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
  normalizeWorkspaceBranding,
  normalizeDraft,
  normalizePollQuestionDraft,
  previewQuestionImport,
  previewPollQuestionImport,
  resolveScheduledTestStatus,
  selectQuestionIdsForScheduledTest,
  scoreObjectiveTest,
  sampleQuestions,
  shuffleWithSeed,
  summarizeTestHistory,
  type BulkImportPreview,
  type GroupJoinRequest,
  type ObjectiveQuestion,
  type PollAttempt,
  type PollBulkImportPreview,
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
  type TestQuestionReport,
  type TestingWorkspaceState,
  type WorkspaceBranding,
  validatePollQuestionDraft,
  validateQuestionDraft,
} from "@trapit/testing";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  createPollQuestionsInBackend,
  createScheduledPollInBackend,
  deletePollQuestionFromBackend,
  getPollByIdFromBackend,
  getPollByShareCodeFromBackend,
  isDynamoDbPollStoreEnabled,
  listAllScheduledPollsFromBackend,
  listPollQuestionsFromBackend,
  listRespondedOpenPollIdsForUserFromBackend,
  listScheduledPollsFromBackend,
  recordPollAttemptInBackend,
  recordRegisteredPollAttemptInBackend,
  updatePollQuestionInBackend,
  updateScheduledPollInBackend,
} from "./poll-store";

const DEFAULT_PRODUCTION_DATA_DIR = path.join(path.sep, "var", "lib", "trapit");
const TEST_REVIEW_EDIT_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

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
  branding?: WorkspaceBranding | null;
  createdAt: string;
  durationMinutes: number;
  hasAttempt: boolean;
  id: string;
  isSelfTest: boolean;
  participantGroupIds: string[];
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
  updatedAt: string;
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

function normalizeBrandingActorKey(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const normalized = normalizeParticipantIdentifier(value);
  return normalized || null;
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

function normalizeWorkspaceBrandingByActor(
  brandingByActor: Record<string, WorkspaceBranding | null | undefined> | null | undefined,
) {
  if (!brandingByActor) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(brandingByActor)
      .map(([actorKey, branding]) => {
        const normalizedActorKey = normalizeBrandingActorKey(actorKey);
        const normalizedBranding = normalizeWorkspaceBranding(branding);

        return normalizedActorKey && normalizedBranding
          ? [normalizedActorKey, normalizedBranding]
          : null;
      })
      .filter((entry): entry is [string, WorkspaceBranding] => entry !== null),
  );
}

function normalizeWorkspaceAppointmentShareCodesByActor(
  shareCodesByActor: Record<string, string | null | undefined> | null | undefined,
) {
  if (!shareCodesByActor) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(shareCodesByActor)
      .map(([actorKey, shareCode]) => {
        const normalizedActorKey = normalizeBrandingActorKey(actorKey);
        const normalizedShareCode = shareCode?.trim() ?? "";

        return normalizedActorKey && normalizedShareCode
          ? [normalizedActorKey, normalizedShareCode]
          : null;
      })
      .filter((entry): entry is [string, string] => entry !== null),
  );
}

function normalizeState(parsed: Partial<TestingWorkspaceState>): TestingWorkspaceState {
  return {
    attempts: parsed.attempts ?? [],
    groupJoinRequests: (parsed.groupJoinRequests ?? []).map((request) => ({
      ...request,
      adminLabel: request.adminLabel?.trim() || request.adminIdentifier?.trim() || "Unknown admin",
      adminGroupName: request.adminGroupName?.trim() ?? "Unnamed group",
      requestType: request.requestType ?? "user-request",
      resolvedAt: request.resolvedAt ?? null,
      status: request.status ?? "pending",
    })),
    pollAttempts: parsed.pollAttempts ?? [],
    participantGroups: (parsed.participantGroups ?? []).map((group) => ({
      ...group,
      inviteJoinMode: group.inviteJoinMode ?? "approval-required",
      ownerIdentifier: group.ownerIdentifier?.trim() || null,
      participantIds: dedupe(group.participantIds ?? []),
      shareCode: group.shareCode?.trim() || null,
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
      sharedWithIdentifiers: dedupe(
        (pool.sharedWithIdentifiers ?? [])
          .map((identifier) => normalizeParticipantIdentifier(identifier))
          .filter(Boolean),
      ),
    })),
    questions: parsed.questions ?? [],
    questionReports: ((parsed as Partial<TestingWorkspaceState> & { questionReports?: Partial<TestQuestionReport>[] }).questionReports ?? []).map((report) => ({
      createdAt: report.createdAt ?? new Date().toISOString(),
      id: report.id ?? createEntityId("question-report"),
      questionId: report.questionId ?? "",
      reason: report.reason?.trim() || "Reported by participant.",
      reporterIdentifier: report.reporterIdentifier ?? "",
      reporterLabel: report.reporterLabel?.trim() || null,
      resolvedAt: report.resolvedAt ?? null,
      status: report.status ?? "open",
      testId: report.testId ?? "",
    })).filter((report) => report.testId && report.questionId && report.reporterIdentifier),
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
        branding: normalizeWorkspaceBranding(poll.branding),
        creatorDisplayName: poll.creatorDisplayName?.trim() || null,
        creatorIdentifier: poll.creatorIdentifier?.trim() || null,
        endsAt,
        participantGroupIds: dedupe(poll.participantGroupIds ?? []),
        title: poll.title?.trim() || `${(poll.questionIds ?? []).length} question poll`,
      };
    }),
    scheduledTests: (parsed.scheduledTests ?? []).map((test) => ({
      ...test,
      branding: normalizeWorkspaceBranding(test.branding),
      inviteJoinMode: test.inviteJoinMode ?? "approval-required",
      participantGroupIds: dedupe(test.participantGroupIds ?? []),
      participantIds: dedupe(test.participantIds ?? []),
      shareCode: test.shareCode?.trim() || null,
      title: test.title?.trim() || "Scheduled test",
    })),
    workspaceAppointmentShareCodesByActor: normalizeWorkspaceAppointmentShareCodesByActor(parsed.workspaceAppointmentShareCodesByActor),
    workspaceBranding: normalizeWorkspaceBranding(parsed.workspaceBranding),
    workspaceBrandingByActor: normalizeWorkspaceBrandingByActor(parsed.workspaceBrandingByActor),
  };
}

export async function getOrCreateWorkspaceAppointmentShareCode(actorKey?: string | null) {
  const state = await readStore();
  const normalizedActorKey = normalizeBrandingActorKey(actorKey);

  if (!normalizedActorKey) {
    return null;
  }

  const existingShareCode = state.workspaceAppointmentShareCodesByActor[normalizedActorKey]
    ?? state.workspaceBrandingByActor[normalizedActorKey]?.appointmentShareCode
    ?? null;
  const shareCode = existingShareCode ?? `TRAPIT-APPT-${createEntityId("access").replace(/-/g, "").toUpperCase()}`;

  state.workspaceAppointmentShareCodesByActor[normalizedActorKey] = shareCode;

  if (state.workspaceBrandingByActor[normalizedActorKey]?.appointmentShareCode !== shareCode) {
    state.workspaceBrandingByActor[normalizedActorKey] = {
      ...state.workspaceBrandingByActor[normalizedActorKey],
      appointmentShareCode: shareCode,
    };
  }

  await writeStore(state);

  return shareCode;
}

export async function getWorkspaceBranding(actorKey?: string | null) {
  const state = await readStore();
  const normalizedActorKey = normalizeBrandingActorKey(actorKey);

  if (!normalizedActorKey) {
    return null;
  }

  return state.workspaceBrandingByActor[normalizedActorKey] ?? null;
}

export async function updateWorkspaceBranding(
  branding: WorkspaceBranding | null,
  actorKey?: string | null,
) {
  const state = await readStore();
  const normalizedBranding = normalizeWorkspaceBranding(branding);
  const normalizedActorKey = normalizeBrandingActorKey(actorKey);
  const existingBranding = normalizedActorKey
    ? state.workspaceBrandingByActor[normalizedActorKey] ?? null
    : state.workspaceBranding;
  const ownerShareCode = normalizedActorKey
    ? state.workspaceAppointmentShareCodesByActor[normalizedActorKey]
      ?? existingBranding?.appointmentShareCode
      ?? `TRAPIT-APPT-${createEntityId("access").replace(/-/g, "").toUpperCase()}`
    : null;
  if (normalizedActorKey && ownerShareCode) {
    state.workspaceAppointmentShareCodesByActor[normalizedActorKey] = ownerShareCode;
  }
  const brandingWithShareCode = normalizedBranding
    ? {
        ...normalizedBranding,
        appointmentShareCode: normalizedBranding.appointmentShareCode ?? ownerShareCode ?? existingBranding?.appointmentShareCode ?? null,
      }
    : null;

  if (!normalizedActorKey) {
    state.workspaceBranding = brandingWithShareCode;
  } else if (brandingWithShareCode) {
    state.workspaceBrandingByActor[normalizedActorKey] = brandingWithShareCode;
  } else {
    delete state.workspaceBrandingByActor[normalizedActorKey];
  }

  await writeStore(state);

  if (!normalizedActorKey) {
    return null;
  }

  return state.workspaceBrandingByActor[normalizedActorKey] ?? null;
}

export async function getWorkspaceBrandingByAppointmentShareCode(shareCode: string) {
  const state = await readStore();
  const normalizedShareCode = shareCode.trim().toLowerCase();

  if (!normalizedShareCode) {
    return null;
  }

  const entry = Object.entries(state.workspaceBrandingByActor).find(([, branding]) =>
    branding.appointmentShareCode?.trim().toLowerCase() === normalizedShareCode,
  );

  const mappedEntry = Object.entries(state.workspaceAppointmentShareCodesByActor).find(([, shareCode]) =>
    shareCode.trim().toLowerCase() === normalizedShareCode,
  );

  if (!entry && !mappedEntry) {
    return null;
  }

  const ownerIdentifier = mappedEntry?.[0] ?? entry?.[0] ?? "";
  const branding = state.workspaceBrandingByActor[ownerIdentifier] ?? entry?.[1] ?? null;

  if (!branding) {
    return null;
  }

  return {
    branding,
    ownerIdentifier,
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

function createAdminInviteRequests(
  state: TestingWorkspaceState,
  input: {
    adminIdentifier: string;
    adminLabel: string | null | undefined;
    group: ParticipantGroup;
    participantIds: string[];
  },
) {
  const participantMap = getParticipantMap(state);
  const requests = input.participantIds.flatMap((participantId) => {
    const participant = participantMap.get(participantId);

    if (!participant) {
      return [];
    }

    const normalizedParticipantIdentifier = normalizeParticipantIdentifier(participant.identifier);
    const isExistingMember = input.group.participantIds.some((groupParticipantId) => {
      const groupParticipant = participantMap.get(groupParticipantId);

      return groupParticipant
        ? identifiersMatch(groupParticipant.identifier, normalizedParticipantIdentifier)
        : false;
    });

    if (isExistingMember) {
      return [];
    }

    const hasPendingInvite = state.groupJoinRequests.some(
      (request) =>
        request.adminGroupId === input.group.id
        && request.requestType === "admin-invite"
        && identifiersMatch(request.requesterId, normalizedParticipantIdentifier)
        && request.status === "pending",
    );

    if (hasPendingInvite) {
      return [];
    }

    return [createStoredGroupJoinRequest({
      adminGroupId: input.group.id,
      adminIdentifier: input.adminIdentifier,
      adminGroupName: input.group.name,
      adminLabel: input.adminLabel?.trim() || input.adminIdentifier,
      requestType: "admin-invite",
      requesterId: normalizedParticipantIdentifier,
      requesterLabel: participant.label?.trim() || participant.identifier,
    })];
  });

  return requests;
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

function getCompletedTestReviewWindow(scheduledTest: ScheduledTest) {
  const completedAt = getScheduledTestEndTime(scheduledTest);
  const closesAt = new Date(new Date(completedAt).getTime() + TEST_REVIEW_EDIT_WINDOW_MS).toISOString();

  return {
    closesAt,
    completedAt,
    isOpen: Date.now() <= new Date(closesAt).getTime(),
  };
}

function assertCompletedTestReviewWindowOpen(scheduledTest: ScheduledTest) {
  if (!getCompletedTestReviewWindow(scheduledTest).isOpen) {
    throw new Error("Question reporting and edits are only available for 14 days after the test is completed.");
  }
}

function getQuestionReportsForTest(state: TestingWorkspaceState, testId: string) {
  return state.questionReports.filter((report) => report.testId === testId);
}

function rescoreAttemptsForScheduledTest(state: TestingWorkspaceState, scheduledTest: ScheduledTest) {
  const questionMap = getQuestionMap(state);
  const questions = scheduledTest.questionIds
    .map((questionId) => questionMap.get(questionId))
    .filter((question): question is PersistentQuestion => Boolean(question));
  const attemptsForTest = state.attempts
    .filter((attempt) => attempt.testId === scheduledTest.id)
    .map((attempt) => {
      const startedAtMs = new Date(attempt.startedAt).getTime();
      const completedAtMs = new Date(attempt.completedAt).getTime();

      return {
        ...attempt,
        result: scoreObjectiveTest(questions, attempt.answers, startedAtMs, completedAtMs),
      };
    })
    .sort((left, right) => {
      const resultComparison = compareTestResults(left.result, right.result);

      if (resultComparison !== 0) {
        return resultComparison;
      }

      return new Date(left.completedAt).getTime() - new Date(right.completedAt).getTime();
    });

  const ranks: number[] = [];
  const rankedAttempts = attemptsForTest.map((attempt, index) => {
    const previousAttempt = attemptsForTest[index - 1];
    const rank = index === 0
      ? 1
      : previousAttempt && compareTestResults(attempt.result, previousAttempt.result) === 0
        ? ranks[index - 1] ?? index
        : index + 1;

    ranks[index] = rank;

    return {
      ...attempt,
      result: {
        ...attempt.result,
        assignedParticipantCount: scheduledTest.resolvedParticipantIdentifiers.length,
        incorrectCount: getIncorrectCount(attempt.result),
        rank,
        rankedParticipantCount: attemptsForTest.length,
      },
    };
  });
  const rankedAttemptMap = new Map(rankedAttempts.map((attempt) => [attempt.id, attempt]));

  state.attempts = state.attempts.map((attempt) => rankedAttemptMap.get(attempt.id) ?? attempt);
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
  actorIdentifier: string | null,
  questionMap: Map<string, PersistentQuestion>,
) {
  if (!actorId && !actorIdentifier) {
    return true;
  }

  if (isOwnedByActor(pool.createdBy, actorId)) {
    return true;
  }

  if (
    actorIdentifier
    && pool.sharedWithIdentifiers.some((identifier) => identifiersMatch(identifier, actorIdentifier))
  ) {
    return true;
  }

  return pool.questionIds.some((questionId) => questionMap.get(questionId)?.createdBy === actorId);
}

function filterQuestionsForActor(
  questions: PersistentQuestion[],
  actorId: string | null,
  pools: QuestionPool[] = [],
  actorIdentifier: string | null = null,
) {
  if (!actorId && !actorIdentifier) {
    return questions;
  }

  const questionMap = new Map(questions.map((question) => [question.id, question]));
  const accessiblePoolIds = new Set(
    filterPoolsForActor(pools, questionMap, actorId, actorIdentifier).map((pool) => pool.id),
  );

  return questions.filter(
    (question) => question.createdBy === actorId || question.poolIds.some((poolId) => accessiblePoolIds.has(poolId)),
  );
}

function filterPoolsForActor(
  pools: QuestionPool[],
  questionMap: Map<string, PersistentQuestion>,
  actorId: string | null,
  actorIdentifier: string | null = null,
) {
  if (!actorId && !actorIdentifier) {
    return pools;
  }

  return pools.filter((pool) => canActorAccessPool(pool, actorId, actorIdentifier, questionMap));
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
  actorIdentifier: string | null = null,
) {
  const pool = state.pools.find((entry) => entry.id === poolId);

  if (!pool) {
    throw new Error("Select a valid question pool.");
  }

  if (!canActorAccessPool(pool, actorId, actorIdentifier, getQuestionMap(state))) {
    throw new Error("You can only use question pools available to you.");
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

function ensureActorOwnsScheduledPoll(
  state: TestingWorkspaceState,
  pollId: string,
  actorId: string | null,
) {
  const scheduledPoll = hydrateScheduledPolls(state).find((poll) => poll.id === pollId);

  if (!scheduledPoll) {
    throw new Error("The selected poll could not be found.");
  }

  if (actorId && scheduledPoll.createdBy !== actorId) {
    throw new Error("You can only manage polls you scheduled.");
  }

  return scheduledPoll;
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
    .map((participantId) => participantMap.get(participantId)?.identifier ?? participantId)
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
    resolvedParticipantIdentifiers: resolveParticipantIdentifiers(
      state,
      dedupe(scheduledTest.participantIds),
      dedupe(scheduledTest.participantGroupIds),
    ),
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

export async function listQuestions(
  actorId: string | null = null,
  actorIdentifier: string | null = null,
) {
  const state = await readStore();
  return filterQuestionsForActor(state.questions, actorId, state.pools, actorIdentifier);
}

export async function createQuestion(
  draft: QuestionDraft,
  actorId: string | null,
  source: QuestionImportSource = "manual",
  poolIds: string[] = [],
  actorIdentifier: string | null = null,
) {
  const state = await readStore();
  const normalizedPoolIds = dedupe(poolIds);

  for (const poolId of normalizedPoolIds) {
    ensureActorOwnsPool(state, poolId, actorId, actorIdentifier);
  }

  const question = createPersistentQuestion(draft, {
    createdBy: actorId,
    poolIds: normalizedPoolIds,
    source,
  });

  state.questions = [question, ...state.questions];
  syncQuestionPoolMemberships(state, question.id, question.poolIds);
  await writeStore(state);

  return filterQuestionsForActor(state.questions, actorId, state.pools, actorIdentifier);
}

export async function importQuestions(
  drafts: QuestionDraft[],
  actorId: string | null,
  poolIds: string[] = [],
  actorIdentifier: string | null = null,
) {
  const state = await readStore();
  const normalizedPoolIds = dedupe(poolIds);

  for (const poolId of normalizedPoolIds) {
    ensureActorOwnsPool(state, poolId, actorId, actorIdentifier);
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

  return filterQuestionsForActor(state.questions, actorId, state.pools, actorIdentifier);
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
  actorIdentifier: string | null = null,
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
      ensureActorOwnsPool(state, poolId, actorId, actorIdentifier);
    }

    syncQuestionPoolMemberships(state, questionId, updates.poolIds);
  }

  await writeStore(state);
  return filterQuestionsForActor(state.questions, actorId, state.pools, actorIdentifier);
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

export async function previewPollImport(text: string): Promise<PollBulkImportPreview> {
  return previewPollQuestionImport(text);
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

export async function deletePollQuestion(questionId: string, actorId: string | null = null) {
  if (isDynamoDbPollStoreEnabled()) {
    return withPollStoreFallback(
      () => deletePollQuestionFromBackend(questionId, actorId),
      async () => {
        const state = await readStore();
        ensureActorOwnsPollQuestion(state, questionId, actorId);

        state.pollQuestions = state.pollQuestions.filter((question) => question.id !== questionId);
        state.scheduledPolls = state.scheduledPolls.map((poll) => ({
          ...poll,
          questionIds: poll.questionIds.filter((savedId) => savedId !== questionId),
          updatedAt: new Date().toISOString(),
        }));
        await writeStore(state);

        return filterPollQuestionsForActor(state.pollQuestions, actorId);
      },
    );
  }

  const state = await readStore();
  ensureActorOwnsPollQuestion(state, questionId, actorId);

  state.pollQuestions = state.pollQuestions.filter((question) => question.id !== questionId);
  state.scheduledPolls = state.scheduledPolls.map((poll) => ({
    ...poll,
    questionIds: poll.questionIds.filter((savedId) => savedId !== questionId),
    updatedAt: new Date().toISOString(),
  }));
  await writeStore(state);

  return filterPollQuestionsForActor(state.pollQuestions, actorId);
}

export async function updatePollQuestion(
  questionId: string,
  draft: PollQuestionDraft,
  actorId: string | null = null,
) {
  if (isDynamoDbPollStoreEnabled()) {
    return withPollStoreFallback(
      () => updatePollQuestionInBackend(questionId, draft, actorId),
      async () => {
        const state = await readStore();
        ensureActorOwnsPollQuestion(state, questionId, actorId);
        const normalizedDraft = normalizePollQuestionDraft(draft);
        const validationError = validatePollQuestionDraft(normalizedDraft);

        if (validationError) {
          throw new Error(validationError);
        }

        state.pollQuestions = state.pollQuestions.map((question) =>
          question.id === questionId
            ? {
                ...question,
                ...normalizedDraft,
                updatedAt: new Date().toISOString(),
              }
            : question,
        );
        await writeStore(state);

        return filterPollQuestionsForActor(state.pollQuestions, actorId);
      },
    );
  }

  const state = await readStore();
  ensureActorOwnsPollQuestion(state, questionId, actorId);
  const normalizedDraft = normalizePollQuestionDraft(draft);
  const validationError = validatePollQuestionDraft(normalizedDraft);

  if (validationError) {
    throw new Error(validationError);
  }

  state.pollQuestions = state.pollQuestions.map((question) =>
    question.id === questionId
      ? {
          ...question,
          ...normalizedDraft,
          updatedAt: new Date().toISOString(),
        }
      : question,
  );
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
  branding?: WorkspaceBranding | null;
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

        const participantGroupIds = dedupe(input.participantGroupIds);

        if (!participantGroupIds.length) {
          throw new Error("Select at least one group for this poll.");
        }

        if (input.generateQrCode && input.participantType === "registered" && participantGroupIds.length !== 1) {
          throw new Error("Group-member poll links require exactly one selected group.");
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

        const anonymous = input.generateQrCode && input.participantType === "open" ? true : input.anonymous;
        const timestamp = new Date().toISOString();
        const shareCode = input.generateQrCode
          ? `TRAPIT-POLL-${createEntityId("access").replace(/-/g, "").toUpperCase()}`
          : null;
        const scheduledPoll: ScheduledPoll = {
          anonymous,
          branding: normalizeWorkspaceBranding(input.branding),
          createdAt: timestamp,
          createdBy: input.createdBy,
          creatorDisplayName: input.creatorDisplayName?.trim() || null,
          creatorIdentifier: input.creatorIdentifier?.trim() || null,
          endsAt: input.endsAt,
          id: createEntityId("poll"),
          participantGroupIds,
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

  const participantGroupIds = dedupe(input.participantGroupIds);

  if (!participantGroupIds.length) {
    throw new Error("Select at least one group for this poll.");
  }

  if (input.generateQrCode && input.participantType === "registered" && participantGroupIds.length !== 1) {
    throw new Error("Group-member poll links require exactly one selected group.");
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

  const anonymous = input.generateQrCode && input.participantType === "open" ? true : input.anonymous;
  const timestamp = new Date().toISOString();
  const shareCode = input.generateQrCode
    ? `TRAPIT-POLL-${createEntityId("access").replace(/-/g, "").toUpperCase()}`
    : null;
  const scheduledPoll: ScheduledPoll = {
    anonymous,
    branding: normalizeWorkspaceBranding(input.branding),
    createdAt: timestamp,
    createdBy: input.createdBy,
    creatorDisplayName: input.creatorDisplayName?.trim() || null,
    creatorIdentifier: input.creatorIdentifier?.trim() || null,
    endsAt: input.endsAt,
    id: createEntityId("poll"),
    participantGroupIds,
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

export async function updateScheduledPoll(input: {
  anonymous: boolean;
  branding?: WorkspaceBranding | null;
  createdBy: string | null;
  creatorDisplayName?: string | null;
  creatorIdentifier?: string | null;
  endsAt: string;
  generateQrCode: boolean;
  participantGroupIds: string[];
  participantType: PollParticipantType;
  pollId: string;
  questionIds: string[];
  startsAt: string;
  title: string;
}) {
  if (isDynamoDbPollStoreEnabled()) {
    return withPollStoreFallback(
      () => updateScheduledPollInBackend(input),
      async () => {
        const state = await readStore();
        const existingPoll = ensureActorOwnsScheduledPoll(state, input.pollId, input.createdBy);

        if (existingPoll.status !== "scheduled") {
          throw new Error("Only polls that have not started can be edited.");
        }

        const questionIds = dedupe(input.questionIds);

        if (!questionIds.length) {
          throw new Error("Select at least one poll question.");
        }

        for (const questionId of questionIds) {
          ensureActorOwnsPollQuestion(state, questionId, input.createdBy);
        }

        const participantGroupIds = dedupe(input.participantGroupIds);

        if (!participantGroupIds.length) {
          throw new Error("Select at least one group for this poll.");
        }

        if (input.generateQrCode && input.participantType === "registered" && participantGroupIds.length !== 1) {
          throw new Error("Group-member poll links require exactly one selected group.");
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

        const timestamp = new Date().toISOString();
        const anonymous = input.generateQrCode && input.participantType === "open" ? true : input.anonymous;

        state.scheduledPolls = state.scheduledPolls.map((poll) =>
          poll.id === input.pollId
            ? {
                ...poll,
                anonymous,
                branding: normalizeWorkspaceBranding(input.branding) ?? poll.branding ?? null,
                creatorDisplayName: input.creatorDisplayName?.trim() || poll.creatorDisplayName || null,
                creatorIdentifier: input.creatorIdentifier?.trim() || poll.creatorIdentifier || null,
                endsAt: input.endsAt,
                participantGroupIds,
                participantType: input.participantType,
                questionIds,
                shareCode: input.generateQrCode
                  ? poll.shareCode ?? `TRAPIT-POLL-${createEntityId("access").replace(/-/g, "").toUpperCase()}`
                  : null,
                startsAt: input.startsAt,
                title: input.title.trim(),
                updatedAt: timestamp,
              }
            : poll,
        );

        await writeStore(state);

        return filterScheduledPollsForActor(hydrateScheduledPolls(state), input.createdBy);
      },
    );
  }

  const state = await readStore();
  const existingPoll = ensureActorOwnsScheduledPoll(state, input.pollId, input.createdBy);

  if (existingPoll.status !== "scheduled") {
    throw new Error("Only polls that have not started can be edited.");
  }

  const questionIds = dedupe(input.questionIds);

  if (!questionIds.length) {
    throw new Error("Select at least one poll question.");
  }

  for (const questionId of questionIds) {
    ensureActorOwnsPollQuestion(state, questionId, input.createdBy);
  }

  const participantGroupIds = dedupe(input.participantGroupIds);

  if (!participantGroupIds.length) {
    throw new Error("Select at least one group for this poll.");
  }

  if (input.generateQrCode && input.participantType === "registered" && participantGroupIds.length !== 1) {
    throw new Error("Group-member poll links require exactly one selected group.");
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

  const timestamp = new Date().toISOString();
  const anonymous = input.generateQrCode && input.participantType === "open" ? true : input.anonymous;

  state.scheduledPolls = state.scheduledPolls.map((poll) =>
    poll.id === input.pollId
      ? {
          ...poll,
          anonymous,
          branding: normalizeWorkspaceBranding(input.branding) ?? poll.branding ?? null,
          creatorDisplayName: input.creatorDisplayName?.trim() || poll.creatorDisplayName || null,
          creatorIdentifier: input.creatorIdentifier?.trim() || poll.creatorIdentifier || null,
          endsAt: input.endsAt,
          participantGroupIds,
          participantType: input.participantType,
          questionIds,
          shareCode: input.generateQrCode
            ? poll.shareCode ?? `TRAPIT-POLL-${createEntityId("access").replace(/-/g, "").toUpperCase()}`
            : null,
          startsAt: input.startsAt,
          title: input.title.trim(),
          updatedAt: timestamp,
        }
      : poll,
  );

  await writeStore(state);

  return filterScheduledPollsForActor(hydrateScheduledPolls(state), input.createdBy);
}

export async function listPools() {
  const state = await readStore();
  return filterPoolsForActor(state.pools, getQuestionMap(state), null);
}

export async function listPoolsForActor(
  actorId: string | null = null,
  actorIdentifier: string | null = null,
) {
  const state = await readStore();
  return filterPoolsForActor(state.pools, getQuestionMap(state), actorId, actorIdentifier);
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
    sharedWithIdentifiers: [],
    updatedAt: timestamp,
  };

  state.pools = [pool, ...state.pools];
  await writeStore(state);

  return filterPoolsForActor(state.pools, getQuestionMap(state), input.createdBy ?? null);
}

export async function updatePoolSharing(input: {
  actorId: string | null;
  actorIdentifier: string | null;
  poolId: string;
  sharedWithIdentifiers: string[];
}) {
  const state = await readStore();
  const pool = state.pools.find((entry) => entry.id === input.poolId);

  if (!pool) {
    throw new Error("Select a valid question pool.");
  }

  if (input.actorId && pool.createdBy !== input.actorId) {
    throw new Error("Only the pool owner can share this question pool.");
  }

  const normalizedSharedWithIdentifiers = dedupe(
    input.sharedWithIdentifiers
      .map((identifier) => normalizeParticipantIdentifier(identifier))
      .filter(
        (identifier) => !input.actorIdentifier || !identifiersMatch(identifier, input.actorIdentifier),
      ),
  );
  const timestamp = new Date().toISOString();

  state.pools = state.pools.map((entry) =>
    entry.id === input.poolId
      ? {
          ...entry,
          sharedWithIdentifiers: normalizedSharedWithIdentifiers,
          updatedAt: timestamp,
        }
      : entry,
  );
  await writeStore(state);

  return filterPoolsForActor(state.pools, getQuestionMap(state), input.actorId, input.actorIdentifier);
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
  const state = await readStore();
  const participantGroups = options?.includeUnowned
    ? await assignUnownedGroupsToOwner(ownerIdentifier)
    : state.participantGroups;
  const participantMap = getParticipantMap({
    ...state,
    participantGroups,
  });

  return participantGroups.filter((group) => {
    if (isGroupOwnedBy(group, ownerIdentifier)) {
      return true;
    }

    const isMember = group.participantIds.some((participantId) => {
      const participant = participantMap.get(participantId);

      return participant ? identifiersMatch(participant.identifier, ownerIdentifier) : false;
    });

    if (isMember) {
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
  generateInviteLink?: boolean;
  inviteJoinMode?: "approval-required" | "automatic";
  name: string;
  ownerLabel?: string | null;
  ownerIdentifier: string | null;
  participantIds: string[];
}) {
  const state = await readStore();
  const shouldCreateInvites = Boolean(input.ownerIdentifier);
  const group = createParticipantGroup({
    description: input.description,
    inviteJoinMode: input.inviteJoinMode,
    name: input.name,
    ownerIdentifier: input.ownerIdentifier,
    participantIds: shouldCreateInvites ? [] : input.participantIds,
    shareCode: input.generateInviteLink
      ? `TRAPIT-GROUP-${createEntityId("access").replace(/-/g, "").toUpperCase()}`
      : null,
  });

  if (shouldCreateInvites && input.ownerIdentifier) {
    const inviteRequests = createAdminInviteRequests(state, {
      adminIdentifier: input.ownerIdentifier,
      adminLabel: input.ownerLabel,
      group,
      participantIds: input.participantIds,
    });

    state.groupJoinRequests = [...inviteRequests, ...state.groupJoinRequests];
  }

  state.participantGroups = [group, ...state.participantGroups];
  await writeStore(state);

  return state.participantGroups;
}

export async function updateGroup(input: {
  generateInviteLink?: boolean;
  groupId: string;
  inviteJoinMode?: "approval-required" | "automatic";
  name: string;
  ownerLabel?: string | null;
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
  const shouldCreateInvites = Boolean(existingGroup.ownerIdentifier ?? input.ownerIdentifier);
  const nextParticipantIds = shouldCreateInvites
    ? existingGroup.participantIds.filter((participantId) => input.participantIds.includes(participantId))
    : dedupe(input.participantIds);

  if (shouldCreateInvites && (existingGroup.ownerIdentifier ?? input.ownerIdentifier)) {
    const inviteRequests = createAdminInviteRequests(state, {
      adminIdentifier: existingGroup.ownerIdentifier ?? input.ownerIdentifier ?? "",
      adminLabel: input.ownerLabel,
      group: {
        ...existingGroup,
        name: input.name.trim(),
        participantIds: nextParticipantIds,
      },
      participantIds: input.participantIds.filter((participantId) => !existingGroup.participantIds.includes(participantId)),
    });

    state.groupJoinRequests = [...inviteRequests, ...state.groupJoinRequests];
  }

  state.participantGroups = state.participantGroups.map((group) =>
    group.id === input.groupId
      ? {
          ...group,
          inviteJoinMode: input.inviteJoinMode ?? group.inviteJoinMode,
          name: input.name.trim(),
          ownerIdentifier: group.ownerIdentifier ?? input.ownerIdentifier,
          participantIds: nextParticipantIds,
          shareCode: input.generateInviteLink
            ? group.shareCode ?? `TRAPIT-GROUP-${createEntityId("access").replace(/-/g, "").toUpperCase()}`
            : null,
          updatedAt: timestamp,
        }
      : group,
  );

  await writeStore(state);

  return state.participantGroups;
}

export async function leaveParticipantGroup(input: {
  groupId: string;
  userIdentifier: string;
}) {
  const state = await readStore();
  const group = state.participantGroups.find((entry) => entry.id === input.groupId);

  if (!group) {
    throw new Error("Group not found.");
  }

  if (isGroupOwnedBy(group, input.userIdentifier)) {
    throw new Error("Group owners cannot leave their own group.");
  }

  const participantMap = getParticipantMap(state);
  const participantIdsToRemove = group.participantIds.filter((participantId) => {
    const participant = participantMap.get(participantId);

    return participant ? identifiersMatch(participant.identifier, input.userIdentifier) : false;
  });

  if (!participantIdsToRemove.length) {
    throw new Error("You are not a member of this group.");
  }

  const timestamp = new Date().toISOString();
  state.participantGroups = state.participantGroups.map((entry) =>
    entry.id === group.id
      ? {
          ...entry,
          participantIds: entry.participantIds.filter((participantId) => !participantIdsToRemove.includes(participantId)),
          updatedAt: timestamp,
        }
      : entry,
  );

  await writeStore(state);

  return listParticipantGroupsForOwner(input.userIdentifier, { includeUnowned: true });
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
  adminLabel?: string | null;
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
    adminLabel: input.adminLabel?.trim() || group.ownerIdentifier,
    requesterId: normalizedRequesterId,
    requesterLabel: input.requesterLabel.trim() || normalizedRequesterId,
  });

  state.groupJoinRequests = [request, ...state.groupJoinRequests];
  await writeStore(state);

  return request;
}

export async function requestParticipantGroupAccess(input: {
  groupId: string;
  requesterId: string;
  requesterLabel: string;
}) {
  const state = await readStore();
  const group = state.participantGroups.find((entry) => entry.id === input.groupId);

  if (!group) {
    throw new Error("Group not found.");
  }

  const normalizedRequesterId = normalizeParticipantIdentifier(input.requesterId);
  const participantMap = getParticipantMap(state);
  const isExistingMember = group.participantIds.some((participantId) => {
    const participant = participantMap.get(participantId);

    return participant ? identifiersMatch(participant.identifier, normalizedRequesterId) : false;
  });

  if (isExistingMember) {
    throw new Error("You are already part of this group.");
  }

  if (group.inviteJoinMode === "automatic") {
    await addParticipantToGroup(state, {
      groupId: group.id,
      participantIdentifier: normalizedRequesterId,
      participantLabel: input.requesterLabel,
    });
    await writeStore(state);

    return {
      mode: "automatic" as const,
    };
  }

  await createGroupJoinRequest({
    adminGroupId: group.id,
    requesterId: normalizedRequesterId,
    requesterLabel: input.requesterLabel,
  });

  return {
    mode: "approval-required" as const,
  };
}

export async function getParticipantGroupInviteByShareCode(
  shareCode: string,
  viewerIdentifier?: string | null,
) {
  const state = await readStore();
  const normalizedShareCode = shareCode.trim().toUpperCase();
  const group = state.participantGroups.find(
    (entry) => entry.shareCode?.trim().toUpperCase() === normalizedShareCode,
  );

  if (!group) {
    throw new Error("This group invite link is invalid or no longer available.");
  }

  const normalizedViewerIdentifier = viewerIdentifier?.trim()
    ? normalizeParticipantIdentifier(viewerIdentifier)
    : null;
  const participantMap = getParticipantMap(state);
  const isGroupMember = normalizedViewerIdentifier
    ? group.participantIds.some((participantId) => {
        const participant = participantMap.get(participantId);

        return participant
          ? identifiersMatch(participant.identifier, normalizedViewerIdentifier)
          : false;
      })
    : false;
  const latestRequest = normalizedViewerIdentifier
    ? state.groupJoinRequests.find(
        (request) =>
          request.adminGroupId === group.id
          && identifiersMatch(request.requesterId, normalizedViewerIdentifier),
      ) ?? null
    : null;

  return {
    access: {
      canRequestAccess: Boolean(normalizedViewerIdentifier) && !isGroupMember && latestRequest?.status !== "pending",
      isGroupMember,
      requestStatus: isGroupMember ? "accepted" : latestRequest?.status ?? null,
    },
    group: {
      description: group.description,
      id: group.id,
      inviteJoinMode: group.inviteJoinMode,
      name: group.name,
      ownerIdentifier: group.ownerIdentifier,
      shareCode: group.shareCode,
    },
  };
}

export async function requestParticipantGroupAccessByShareCode(input: {
  requesterId: string;
  requesterLabel: string;
  shareCode: string;
}) {
  const state = await readStore();
  const invite = await getParticipantGroupInviteByShareCode(input.shareCode, input.requesterId);

  if (invite.access.isGroupMember) {
    throw new Error("You are already part of this group.");
  }

  if (invite.group.inviteJoinMode === "automatic") {
    await addParticipantToGroup(state, {
      groupId: invite.group.id,
      participantIdentifier: input.requesterId,
      participantLabel: input.requesterLabel,
    });
    await writeStore(state);

    return {
      mode: "automatic" as const,
    };
  }

  await createGroupJoinRequest({
    adminGroupId: invite.group.id,
    requesterId: input.requesterId,
    requesterLabel: input.requesterLabel,
  });

  return {
    mode: "approval-required" as const,
  };
}

export async function requestScheduledPollAccessByShareCode(input: {
  requesterId: string;
  requesterLabel: string;
  shareCode: string;
}) {
  const state = await readStore();
  const normalizedShareCode = input.shareCode.trim().toUpperCase();
  const poll = hydrateScheduledPolls(state).find(
    (entry) => entry.shareCode?.trim().toUpperCase() === normalizedShareCode,
  );

  if (!poll) {
    throw new Error("This poll link is invalid or no longer available.");
  }

  if (poll.participantType !== "registered") {
    throw new Error("This poll link is already open for all.");
  }

  const group = getPublicPollInviteGroup(state, poll);

  if (!group) {
    throw new Error("This poll link is not linked to exactly one group.");
  }

  const normalizedRequesterId = normalizeParticipantIdentifier(input.requesterId);
  const participantMap = getParticipantMap(state);
  const isExistingMember = group.participantIds.some((participantId) => {
    const participant = participantMap.get(participantId);

    return participant ? identifiersMatch(participant.identifier, normalizedRequesterId) : false;
  });

  if (isExistingMember) {
    throw new Error("You are already part of this group.");
  }

  if (group.inviteJoinMode === "automatic") {
    await addParticipantToGroup(state, {
      groupId: group.id,
      participantIdentifier: input.requesterId,
      participantLabel: input.requesterLabel,
    });
    await writeStore(state);

    return {
      mode: "automatic" as const,
    };
  }

  await createGroupJoinRequest({
    adminGroupId: group.id,
    requesterId: input.requesterId,
    requesterLabel: input.requesterLabel,
  });

  return {
    mode: "approval-required" as const,
  };
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

  if (request.requestType !== "user-request") {
    throw new Error("Admin-issued invitations must be reviewed by the invited user.");
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

export async function resolveGroupInvitationForUser(input: {
  decision: "accept" | "reject";
  requestId: string;
  userIdentifier: string;
}) {
  const state = await readStore();
  const normalizedUserIdentifier = normalizeParticipantIdentifier(input.userIdentifier);
  const request = state.groupJoinRequests.find((entry) => entry.id === input.requestId);

  if (!request) {
    throw new Error("Request not found.");
  }

  if (request.requestType !== "admin-invite") {
    throw new Error("Only admin-issued invitations can be reviewed here.");
  }

  if (!identifiersMatch(request.requesterId, normalizedUserIdentifier)) {
    throw new Error("You can only manage your own group invitations.");
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
  actorIdentifier?: string | null;
  branding?: WorkspaceBranding | null;
  createdBy: string | null;
  durationMinutes: number;
  generateInviteLink?: boolean;
  participantGroupIds: string[];
  participantIds: string[];
  poolId: string;
  questionCount: number;
  startsAt: string;
  title?: string | null;
  titleSuffix?: string | null;
}) {
  const state = await readStore();
  const pool = ensureActorOwnsPool(state, input.poolId, input.createdBy, input.actorIdentifier ?? null);

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

  const participantGroupIds = dedupe(input.participantGroupIds);
  const inviteGroup = participantGroupIds.length === 1
    ? state.participantGroups.find((group) => group.id === participantGroupIds[0]) ?? null
    : null;

  if (input.generateInviteLink && participantGroupIds.length !== 1) {
    throw new Error("Invite links can be generated only when exactly one group is selected.");
  }

  if (input.generateInviteLink && !inviteGroup) {
    throw new Error("The selected group could not be found.");
  }

  const timestamp = new Date().toISOString();
  const baseTitle = input.title?.trim() || `${pool.name} test`;
  const title = input.titleSuffix?.trim() ? `${baseTitle} ${input.titleSuffix.trim()}` : baseTitle;
  const scheduledTest: ScheduledTest = {
    branding: normalizeWorkspaceBranding(input.branding),
    createdAt: timestamp,
    createdBy: input.createdBy,
    durationMinutes: input.durationMinutes,
    id: createEntityId("test"),
    inviteJoinMode: inviteGroup?.inviteJoinMode ?? "approval-required",
    participantGroupIds,
    participantIds: dedupe(input.participantIds),
    poolId: input.poolId,
    questionCount: input.questionCount,
    questionIds: selectQuestionIdsForScheduledTest(
      poolQuestionIds,
      input.questionCount,
      [input.poolId, input.startsAt, resolvedParticipantIdentifiers.join(",")].join(":"),
    ),
    resolvedParticipantIdentifiers,
    shareCode: input.generateInviteLink
      ? `TRAPIT-TEST-${createEntityId("access").replace(/-/g, "").toUpperCase()}`
      : null,
    startsAt: input.startsAt,
    status: new Date(input.startsAt).getTime() > Date.now() ? "scheduled" : "live",
    title,
    updatedAt: timestamp,
  };

  state.scheduledTests = [scheduledTest, ...state.scheduledTests];
  await writeStore(state);

  return filterScheduledTestsForActor(hydrateScheduledTests(state), input.createdBy);
}

export async function updateScheduledTest(input: {
  actorIdentifier?: string | null;
  branding?: WorkspaceBranding | null;
  createdBy: string | null;
  durationMinutes: number;
  generateInviteLink?: boolean;
  participantGroupIds: string[];
  participantIds: string[];
  poolId: string;
  questionCount: number;
  startsAt: string;
  testId: string;
  title?: string | null;
}) {
  const state = await readStore();
  const existingTest = ensureActorOwnsScheduledTest(state, input.testId, input.createdBy);

  if (existingTest.status !== "scheduled") {
    throw new Error("Only tests that have not started can be edited.");
  }

  const pool = ensureActorOwnsPool(state, input.poolId, input.createdBy, input.actorIdentifier ?? null);
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

  const participantGroupIds = dedupe(input.participantGroupIds);
  const inviteGroup = participantGroupIds.length === 1
    ? state.participantGroups.find((group) => group.id === participantGroupIds[0]) ?? null
    : null;

  if (input.generateInviteLink && participantGroupIds.length !== 1) {
    throw new Error("Invite links can be generated only when exactly one group is selected.");
  }

  if (input.generateInviteLink && !inviteGroup) {
    throw new Error("The selected group could not be found.");
  }

  const timestamp = new Date().toISOString();
  const title = input.title?.trim() || `${pool.name} test`;

  state.scheduledTests = state.scheduledTests.map((scheduledTest) =>
    scheduledTest.id === input.testId
      ? {
          ...scheduledTest,
          branding: normalizeWorkspaceBranding(input.branding) ?? scheduledTest.branding ?? null,
          durationMinutes: input.durationMinutes,
          inviteJoinMode: inviteGroup?.inviteJoinMode ?? scheduledTest.inviteJoinMode ?? "approval-required",
          participantGroupIds,
          participantIds: dedupe(input.participantIds),
          poolId: input.poolId,
          questionCount: input.questionCount,
          questionIds: selectQuestionIdsForScheduledTest(
            poolQuestionIds,
            input.questionCount,
            [input.poolId, input.startsAt, resolvedParticipantIdentifiers.join(","), scheduledTest.id].join(":"),
          ),
          resolvedParticipantIdentifiers,
          shareCode: input.generateInviteLink
            ? scheduledTest.shareCode ?? `TRAPIT-TEST-${createEntityId("access").replace(/-/g, "").toUpperCase()}`
            : null,
          startsAt: input.startsAt,
          status: new Date(input.startsAt).getTime() > Date.now() ? "scheduled" : "live",
          title,
          updatedAt: timestamp,
        }
      : scheduledTest,
  );

  await writeStore(state);

  return filterScheduledTestsForActor(hydrateScheduledTests(state), input.createdBy);
}

export async function listHistory(actorId: string | null = null) {
  const state = await readStore();
  const scheduledTests = filterScheduledTestsForActor(hydrateScheduledTests(state), actorId).filter(
    (scheduledTest) => scheduledTest.status === "completed",
  );
  const scheduledTestIds = new Set(scheduledTests.map((scheduledTest) => scheduledTest.id));
  const attempts = state.attempts.filter((attempt) => scheduledTestIds.has(attempt.testId));

  return summarizeTestHistory(attempts, scheduledTests);
}

export async function listLeaderboards(actorId: string | null = null) {
  const state = await readStore();
  const scheduledTests = filterScheduledTestsForActor(hydrateScheduledTests(state), actorId).filter(
    (scheduledTest) => scheduledTest.status === "completed",
  );
  const scheduledTestIds = new Set(scheduledTests.map((scheduledTest) => scheduledTest.id));
  const attempts = state.attempts.filter((attempt) => scheduledTestIds.has(attempt.testId));

  return buildTestLeaderboards(attempts, scheduledTests);
}

export async function listStateSummary(input?: {
  actorIdentifier?: string | null;
  actorSub?: string | null;
}) {
  const state = await readStore();
  const actorSub = input?.actorSub ?? null;
  const actorIdentifier = input?.actorIdentifier ?? null;
  const questionMap = getQuestionMap(state);
  const visibleQuestions = filterQuestionsForActor(state.questions, actorSub, state.pools, actorIdentifier);
  const visiblePools = filterPoolsForActor(state.pools, questionMap, actorSub, actorIdentifier);
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
  const completedScheduledTests = scheduledTests.filter((scheduledTest) => scheduledTest.status === "completed");
  const completedScheduledTestIds = new Set(completedScheduledTests.map((scheduledTest) => scheduledTest.id));
  const submittedAttempts = state.attempts.filter((attempt) =>
    identifiersMatch(attempt.userId, normalizedIdentifier)
      && completedScheduledTestIds.has(attempt.testId),
  );
  const submittedHistory = summarizeTestHistory(submittedAttempts, completedScheduledTests);
  const missedHistory = completedScheduledTests
    .filter(
      (scheduledTest) =>
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
  const completedScheduledTests = scheduledTests.filter((scheduledTest) => scheduledTest.status === "completed");
  const completedScheduledTestIds = new Set(completedScheduledTests.map((scheduledTest) => scheduledTest.id));
  const leaderboardByTestId = new Map(
    buildTestLeaderboards(
      state.attempts.filter((attempt) => completedScheduledTestIds.has(attempt.testId)),
      completedScheduledTests,
    ).map((leaderboard) => [
      leaderboard.testId,
      leaderboard,
    ]),
  );
  const questionMap = getQuestionMap(state);

  return scheduledTests
    .map((scheduledTest) => ({
    branding: scheduledTest.branding ?? null,
    createdAt: scheduledTest.createdAt,
    durationMinutes: scheduledTest.durationMinutes,
    hasAttempt: state.attempts.some(
      (attempt) =>
        attempt.testId === scheduledTest.id && identifiersMatch(attempt.userId, normalizedIdentifier),
    ),
    id: scheduledTest.id,
    isSelfTest: scheduledTest.participantGroupIds.length === 0
      && scheduledTest.resolvedParticipantIdentifiers.length === 1
      && identifiersMatch(scheduledTest.resolvedParticipantIdentifiers[0], normalizedIdentifier),
    participantGroupIds: [...scheduledTest.participantGroupIds],
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
    updatedAt: scheduledTest.updatedAt,
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
  const respondedPollIds = new Set(
    isDynamoDbPollStoreEnabled()
      ? await withPollStoreFallback(
        () => listRespondedOpenPollIdsForUserFromBackend(normalizedIdentifier),
        async () => state.pollAttempts
          .filter((attempt) => identifiersMatch(attempt.userId, normalizedIdentifier))
          .map((attempt) => attempt.pollId),
      )
      : state.pollAttempts
        .filter((attempt) => identifiersMatch(attempt.userId, normalizedIdentifier))
        .map((attempt) => attempt.pollId),
  );

  const scheduledPolls = isDynamoDbPollStoreEnabled()
    ? await withPollStoreFallback(
      () => listAllScheduledPollsFromBackend(),
      async () => hydrateScheduledPolls(state),
    )
    : hydrateScheduledPolls(state);

  return scheduledPolls
    .filter((poll) => {
      if (poll.participantGroupIds.some((groupId) => participantGroupIds.has(groupId))) {
        return poll.participantGroupIds.some((groupId) => participantGroupIds.has(groupId));
      }

      return poll.participantType === "open" && respondedPollIds.has(poll.id);
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

function getParticipantGroupIdsForIdentifier(state: TestingWorkspaceState, normalizedIdentifier: string) {
  const participantProfileIds = state.participants
    .filter((participant) => identifiersMatch(participant.identifier, normalizedIdentifier))
    .map((participant) => participant.id);

  return new Set(
    state.participantGroups
      .filter((group) =>
        group.participantIds.some((participantId) => participantProfileIds.includes(participantId)),
      )
      .map((group) => group.id),
  );
}

function canAccessGroupSharedPoll(
  state: TestingWorkspaceState,
  poll: ScheduledPoll,
  normalizedIdentifier: string,
) {
  if (poll.creatorIdentifier && identifiersMatch(poll.creatorIdentifier, normalizedIdentifier)) {
    return true;
  }

  const participantGroupIds = getParticipantGroupIdsForIdentifier(state, normalizedIdentifier);

  return poll.participantGroupIds.some((groupId) => participantGroupIds.has(groupId));
}

function getPublicPollInviteGroup(state: TestingWorkspaceState, poll: ScheduledPoll) {
  if (poll.participantType !== "registered" || poll.participantGroupIds.length !== 1) {
    return null;
  }

  return state.participantGroups.find((group) => group.id === poll.participantGroupIds[0]) ?? null;
}

function getPublicPollAccess(
  state: TestingWorkspaceState,
  poll: ScheduledPoll,
  viewer?: {
    identifier?: string | null;
    sub?: string | null;
  },
) {
  const isCreator = Boolean(
    (viewer?.sub && poll.createdBy && viewer.sub === poll.createdBy)
    || (viewer?.identifier && poll.creatorIdentifier && identifiersMatch(poll.creatorIdentifier, viewer.identifier)),
  );

  if (poll.participantType === "open") {
    return {
      canRequestAccess: false,
      canRespond: true,
      group: null,
      isGroupMember: false,
      requestStatus: null,
    };
  }

  const group = getPublicPollInviteGroup(state, poll);

  if (!group) {
    return {
      canRequestAccess: false,
      canRespond: isCreator,
      group: null,
      isGroupMember: false,
      requestStatus: null,
    };
  }

  const normalizedViewerIdentifier = viewer?.identifier?.trim()
    ? normalizeParticipantIdentifier(viewer.identifier)
    : null;
  const participantMap = getParticipantMap(state);
  const isGroupMember = normalizedViewerIdentifier
    ? group.participantIds.some((participantId) => {
        const participant = participantMap.get(participantId);

        return participant
          ? identifiersMatch(participant.identifier, normalizedViewerIdentifier)
          : false;
      })
    : false;
  const latestRequest = normalizedViewerIdentifier
    ? state.groupJoinRequests.find(
        (request) =>
          request.adminGroupId === group.id
          && identifiersMatch(request.requesterId, normalizedViewerIdentifier),
      ) ?? null
    : null;

  return {
    canRequestAccess: Boolean(normalizedViewerIdentifier) && !isCreator && !isGroupMember && latestRequest?.status !== "pending",
    canRespond: isCreator || isGroupMember,
    group: {
      description: group.description,
      id: group.id,
      inviteJoinMode: group.inviteJoinMode,
      name: group.name,
      ownerIdentifier: group.ownerIdentifier,
      shareCode: group.shareCode,
    },
    isGroupMember,
    requestStatus: isCreator ? "accepted" : isGroupMember ? "accepted" : latestRequest?.status ?? null,
  };
}

function buildParticipantPollSummary(input: {
  attempts: PollAttempt[];
  identifier: string;
  poll: ScheduledPoll;
  questions: PersistentPollQuestion[];
}) {
  const normalizedIdentifier = normalizeParticipantIdentifier(input.identifier);
  const hasSubmitted = input.attempts.some((attempt) => identifiersMatch(attempt.userId, normalizedIdentifier));
  const isCreator = Boolean(
    input.poll.creatorIdentifier && identifiersMatch(input.poll.creatorIdentifier, normalizedIdentifier),
  );
  const canViewResults = isCreator || hasSubmitted;
  const summary = input.questions.map((question) => ({
    optionSelectionCounts: question.options.map(
      (_, optionIndex) =>
        input.attempts.filter((attempt) => attempt.answers[question.id] === optionIndex).length,
    ),
    options: question.options,
    prompt: question.prompt,
    questionId: question.id,
    topic: question.topic,
    totalResponses: input.attempts.length,
  }));

  return {
    canViewResults,
    hasSubmitted,
    poll: input.poll,
    questions: input.questions,
    summary: canViewResults ? summary : [],
    totalResponses: canViewResults ? input.attempts.length : null,
  };
}

export async function getParticipantPollById(pollId: string, identifier: string) {
  const state = await readStore();
  const normalizedIdentifier = normalizeParticipantIdentifier(identifier);

  if (isDynamoDbPollStoreEnabled()) {
    const scheduledPolls = await withPollStoreFallback(
      () => listAllScheduledPollsFromBackend(),
      async () => hydrateScheduledPolls(state),
    );
    const poll = scheduledPolls.find((entry) => entry.id === pollId);

    if (!poll) {
      throw new Error("The selected poll could not be found.");
    }

    if (!canAccessGroupSharedPoll(state, poll, normalizedIdentifier)) {
      throw new Error("You do not have access to this poll.");
    }

    return withPollStoreFallback(
      () => getPollByIdFromBackend(pollId, {
        identifier: normalizedIdentifier,
        isRegistered: true,
        responseUserId: normalizedIdentifier,
      }),
      async () => {
        const questionMap = new Map(state.pollQuestions.map((question) => [question.id, question]));
        const questions = poll.questionIds
          .map((questionId) => questionMap.get(questionId))
          .filter((question): question is PersistentPollQuestion => Boolean(question));
        const attempts = state.pollAttempts.filter((attempt) => attempt.pollId === poll.id);

        return buildParticipantPollSummary({
          attempts,
          identifier: normalizedIdentifier,
          poll,
          questions,
        });
      },
    );
  }

  const poll = hydrateScheduledPolls(state).find((entry) => entry.id === pollId);

  if (!poll) {
    throw new Error("The selected poll could not be found.");
  }

  if (!canAccessGroupSharedPoll(state, poll, normalizedIdentifier)) {
    throw new Error("You do not have access to this poll.");
  }

  const questionMap = new Map(state.pollQuestions.map((question) => [question.id, question]));
  const questions = poll.questionIds
    .map((questionId) => questionMap.get(questionId))
    .filter((question): question is PersistentPollQuestion => Boolean(question));
  const attempts = state.pollAttempts.filter((attempt) => attempt.pollId === poll.id);

  return buildParticipantPollSummary({
    attempts,
    identifier: normalizedIdentifier,
    poll,
    questions,
  });
}

function applyPublicPollAccessToPayload(
  state: TestingWorkspaceState,
  payload: {
    canViewResults: boolean;
    hasSubmitted: boolean;
    poll: ScheduledPoll;
    questions: PersistentPollQuestion[];
    summary: Array<{
      optionSelectionCounts: number[];
      options: string[];
      prompt: string;
      questionId: string;
      topic: string;
      totalResponses: number;
    }>;
    totalResponses: number | null;
  },
  viewer?: {
    identifier?: string | null;
    isRegistered?: boolean;
    responseUserId?: string | null;
    sub?: string | null;
  },
) {
  const access = getPublicPollAccess(state, payload.poll, viewer);
  const canViewQuestions = access.canRespond || payload.hasSubmitted || payload.canViewResults || payload.poll.participantType === "open";

  return {
    ...payload,
    access,
    questions: canViewQuestions ? payload.questions : [],
  };
}

function ensureCanSubmitPublicPoll(
  state: TestingWorkspaceState,
  poll: ScheduledPoll,
  input: {
    isRegistered?: boolean;
    userId: string;
  },
) {
  if (poll.participantType === "open") {
    return;
  }

  if (!input.isRegistered) {
    throw new Error("Sign in and join the assigned group before responding to this poll.");
  }

  const normalizedUserId = normalizeParticipantIdentifier(input.userId);

  if (!canAccessGroupSharedPoll(state, poll, normalizedUserId)) {
    throw new Error("Join the assigned group before responding to this poll.");
  }
}

export async function getPollByShareCode(
  shareCode: string,
  viewer?: {
    identifier?: string | null;
    isRegistered?: boolean;
    responseUserId?: string | null;
    sub?: string | null;
  },
) {
  const state = await readStore();
  const payload = isDynamoDbPollStoreEnabled()
    ? await withPollStoreFallback(
      () => getPollByShareCodeFromBackend(shareCode, viewer),
      async () => {
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
        const viewerResponseUserId = viewer?.responseUserId ?? null;
        const hasSubmitted = viewerResponseUserId
          ? attempts.some((attempt) => identifiersMatch(attempt.userId, viewerResponseUserId))
          : false;
        const isCreator = Boolean(viewer?.sub && poll.createdBy && viewer.sub === poll.createdBy);
        const canViewResults = isCreator || Boolean(viewer?.isRegistered && hasSubmitted);
        const summary = questions.map((question) => ({
          optionSelectionCounts: question.options.map(
            (_, optionIndex) =>
              attempts.filter((attempt) => attempt.answers[question.id] === optionIndex).length,
          ),
          options: question.options,
          prompt: question.prompt,
          questionId: question.id,
          topic: question.topic,
          totalResponses: attempts.length,
        }));

        return {
          canViewResults,
          poll,
          questions,
          hasSubmitted,
          summary: canViewResults ? summary : [],
          totalResponses: attempts.length,
        };
      },
    )
    : await (async () => {
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
      const viewerResponseUserId = viewer?.responseUserId ?? null;
      const hasSubmitted = viewerResponseUserId
        ? attempts.some((attempt) => identifiersMatch(attempt.userId, viewerResponseUserId))
        : false;
      const isCreator = Boolean(viewer?.sub && poll.createdBy && viewer.sub === poll.createdBy);
      const canViewResults = isCreator || Boolean(viewer?.isRegistered && hasSubmitted);
      const summary = questions.map((question) => ({
        optionSelectionCounts: question.options.map(
          (_, optionIndex) =>
            attempts.filter((attempt) => attempt.answers[question.id] === optionIndex).length,
        ),
        options: question.options,
        prompt: question.prompt,
        questionId: question.id,
        topic: question.topic,
        totalResponses: attempts.length,
      }));

      return {
        canViewResults,
        poll,
        questions,
        hasSubmitted,
        summary: canViewResults ? summary : [],
        totalResponses: attempts.length,
      };
    })();

  return applyPublicPollAccessToPayload(state, payload, viewer);
}

export async function recordPollAttempt(input: {
  answers: Record<string, number | undefined>;
  completedAt: string;
  isRegistered?: boolean;
  participantName?: string;
  shareCode: string;
  startedAt: string;
  userId: string;
}) {
  if (isDynamoDbPollStoreEnabled()) {
    const state = await readStore();
    const normalizedShareCode = input.shareCode.trim().toUpperCase();
    const scheduledPolls = await withPollStoreFallback(
      () => listAllScheduledPollsFromBackend(),
      async () => hydrateScheduledPolls(state),
    );
    const poll = scheduledPolls.find((entry) => entry.shareCode?.trim().toUpperCase() === normalizedShareCode);

    if (!poll) {
      throw new Error("The selected poll could not be found.");
    }

    ensureCanSubmitPublicPoll(state, poll, input);

    return withPollStoreFallback(
      () => recordPollAttemptInBackend(input),
      async () => {
        const normalizedUserId = normalizeParticipantIdentifier(input.userId);
        const poll = hydrateScheduledPolls(state).find(
          (entry) => entry.shareCode?.trim().toUpperCase() === normalizedShareCode,
        );

        if (!poll) {
          throw new Error("The selected poll could not be found.");
        }

        ensureCanSubmitPublicPoll(state, poll, input);

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

        const participantName = input.participantName?.trim() || undefined;

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

  ensureCanSubmitPublicPoll(state, poll, input);

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

  state.pollAttempts = [attempt, ...state.pollAttempts];
  await writeStore(state);

  return attempt;
}

export async function recordParticipantPollAttempt(input: {
  answers: Record<string, number | undefined>;
  completedAt: string;
  participantName?: string;
  pollId: string;
  startedAt: string;
  userId: string;
}) {
  const state = await readStore();
  const normalizedUserId = normalizeParticipantIdentifier(input.userId);

  if (isDynamoDbPollStoreEnabled()) {
    const scheduledPolls = await withPollStoreFallback(
      () => listAllScheduledPollsFromBackend(),
      async () => hydrateScheduledPolls(state),
    );
    const poll = scheduledPolls.find((entry) => entry.id === input.pollId);

    if (!poll) {
      throw new Error("The selected poll could not be found.");
    }

    if (!canAccessGroupSharedPoll(state, poll, normalizedUserId)) {
      throw new Error("You do not have access to this poll.");
    }

    return withPollStoreFallback(
      () => recordRegisteredPollAttemptInBackend(input),
      async () => {
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

        if (poll.status === "scheduled") {
          throw new Error("This poll is not live yet.");
        }

        if (poll.status === "completed") {
          throw new Error("This poll is no longer available.");
        }

        if (completedAtMs < startsAtMs) {
          throw new Error("This poll is not live yet.");
        }

        if (completedAtMs > endsAtMs) {
          throw new Error("This poll is no longer available.");
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
          participantName: input.participantName?.trim() || undefined,
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

  const poll = hydrateScheduledPolls(state).find((entry) => entry.id === input.pollId);

  if (!poll) {
    throw new Error("The selected poll could not be found.");
  }

  if (!canAccessGroupSharedPoll(state, poll, normalizedUserId)) {
    throw new Error("You do not have access to this poll.");
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
    answers: input.answers,
    completedAt: input.completedAt,
    id: createEntityId("poll-attempt"),
    participantName: input.participantName?.trim() || undefined,
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
  const orderedQuestions = shuffleWithSeed(
    scheduledTest.questionIds
      .map((questionId) => questionMap.get(questionId))
      .filter((question): question is PersistentQuestion => Boolean(question)),
    `${scheduledTest.id}:${normalizedIdentifier}:question-order`,
  );

  return {
    review: orderedQuestions.map((question) => ({
        correctOptionIndex: question.correctOptionIndex,
        options: question.options,
        prompt: question.prompt,
        questionId: question.id,
        reportCount: getQuestionReportsForTest(state, testId).filter((report) => report.questionId === question.id).length,
        reportedByCurrentUser: getQuestionReportsForTest(state, testId).some(
          (report) => report.questionId === question.id && identifiersMatch(report.reporterIdentifier, normalizedIdentifier),
        ),
        selectedOptionIndex: attempt?.answers[question.id],
      })),
    canReport: Boolean(attempt) && getCompletedTestReviewWindow(scheduledTest).isOpen,
    reviewWindowClosesAt: getCompletedTestReviewWindow(scheduledTest).closesAt,
    submittedAt: attempt?.completedAt ?? null,
    testId: scheduledTest.id,
    testTitle: scheduledTest.title,
  };
}

export async function reportTestQuestion(input: {
  questionId: string;
  reason: string;
  reporterIdentifier: string;
  reporterLabel: string | null;
  testId: string;
}) {
  const state = await readStore();
  const normalizedReporterIdentifier = normalizeParticipantIdentifier(input.reporterIdentifier);
  const scheduledTest = getCompletedScheduledTest(state, input.testId);
  assertCompletedTestReviewWindowOpen(scheduledTest);

  if (!scheduledTest.questionIds.includes(input.questionId)) {
    throw new Error("Question not found in this test.");
  }

  const attempt = state.attempts.find(
    (entry) => entry.testId === input.testId && identifiersMatch(entry.userId, normalizedReporterIdentifier),
  );

  if (!attempt) {
    throw new Error("Only participants who submitted this test can report a question.");
  }

  const existingReport = state.questionReports.find(
    (report) => report.testId === input.testId
      && report.questionId === input.questionId
      && identifiersMatch(report.reporterIdentifier, normalizedReporterIdentifier),
  );
  const timestamp = new Date().toISOString();
  const reason = input.reason.trim() || "Reported by participant.";

  if (existingReport) {
    state.questionReports = state.questionReports.map((report) =>
      report.id === existingReport.id
        ? {
            ...report,
            createdAt: timestamp,
            reason,
            reporterLabel: input.reporterLabel?.trim() || report.reporterLabel,
            resolvedAt: null,
            status: "open",
          }
        : report,
    );
  } else {
    state.questionReports = [
      {
        createdAt: timestamp,
        id: createEntityId("question-report"),
        questionId: input.questionId,
        reason,
        reporterIdentifier: normalizedReporterIdentifier,
        reporterLabel: input.reporterLabel?.trim() || null,
        resolvedAt: null,
        status: "open",
        testId: input.testId,
      },
      ...state.questionReports,
    ];
  }

  await writeStore(state);

  return getUserTestReview(input.testId, normalizedReporterIdentifier);
}

export async function getScheduledTestInviteByShareCode(
  shareCode: string,
  viewerIdentifier?: string | null,
) {
  const state = await readStore();
  const normalizedShareCode = shareCode.trim().toUpperCase();
  const scheduledTest = hydrateScheduledTests(state).find(
    (entry) => entry.shareCode?.trim().toUpperCase() === normalizedShareCode,
  );

  if (!scheduledTest) {
    throw new Error("This test invite link is invalid or no longer available.");
  }

  if (scheduledTest.participantGroupIds.length !== 1) {
    throw new Error("This test invite is not linked to exactly one group.");
  }

  const group = state.participantGroups.find((entry) => entry.id === scheduledTest.participantGroupIds[0]);

  if (!group) {
    throw new Error("The group for this test invite could not be found.");
  }

  const normalizedViewerIdentifier = viewerIdentifier?.trim()
    ? normalizeParticipantIdentifier(viewerIdentifier)
    : null;
  const participantMap = getParticipantMap(state);
  const isGroupMember = normalizedViewerIdentifier
    ? group.participantIds.some((participantId) => {
        const participant = participantMap.get(participantId);

        return participant
          ? identifiersMatch(participant.identifier, normalizedViewerIdentifier)
          : false;
      })
    : false;
  const latestRequest = normalizedViewerIdentifier
    ? state.groupJoinRequests.find(
        (request) =>
          request.adminGroupId === group.id
          && identifiersMatch(request.requesterId, normalizedViewerIdentifier),
      ) ?? null
    : null;

  return {
    access: {
      canRequestAccess: Boolean(normalizedViewerIdentifier) && !isGroupMember && latestRequest?.status !== "pending",
      isGroupMember,
      requestStatus: isGroupMember ? "accepted" : latestRequest?.status ?? null,
    },
    group: {
      description: group.description,
      id: group.id,
      inviteJoinMode: group.inviteJoinMode,
      name: group.name,
      ownerIdentifier: group.ownerIdentifier,
    },
    test: {
      durationMinutes: scheduledTest.durationMinutes,
      id: scheduledTest.id,
      inviteJoinMode: group.inviteJoinMode,
      questionCount: scheduledTest.questionCount,
      shareCode: scheduledTest.shareCode,
      startsAt: scheduledTest.startsAt,
      status: scheduledTest.status,
      title: scheduledTest.title,
    },
  };
}

async function addParticipantToGroup(state: TestingWorkspaceState, input: {
  groupId: string;
  participantIdentifier: string;
  participantLabel: string;
}) {
  const group = state.participantGroups.find((entry) => entry.id === input.groupId);

  if (!group) {
    throw new Error("The selected group could not be found.");
  }

  const normalizedParticipantIdentifier = normalizeParticipantIdentifier(input.participantIdentifier);
  const participantMap = getParticipantMap(state);
  const isExistingMember = group.participantIds.some((participantId) => {
    const participant = participantMap.get(participantId);

    return participant ? identifiersMatch(participant.identifier, normalizedParticipantIdentifier) : false;
  });

  if (isExistingMember) {
    return { group, joined: false };
  }

  const participant = ensureParticipantProfile(state, {
    identifier: normalizedParticipantIdentifier,
    label: input.participantLabel,
  });
  const timestamp = new Date().toISOString();

  state.participantGroups = state.participantGroups.map((entry) =>
    entry.id === group.id
      ? {
          ...entry,
          participantIds: dedupe([...entry.participantIds, participant.id]),
          updatedAt: timestamp,
        }
      : entry,
  );

  state.groupJoinRequests = state.groupJoinRequests.map((entry) =>
    entry.adminGroupId === group.id && identifiersMatch(entry.requesterId, normalizedParticipantIdentifier) && entry.status === "pending"
      ? {
          ...entry,
          resolvedAt: timestamp,
          status: "accepted",
        }
      : entry,
  );

  return { group, joined: true };
}

export async function requestScheduledTestAccessByShareCode(input: {
  requesterId: string;
  requesterLabel: string;
  shareCode: string;
}) {
  const state = await readStore();
  const invite = await getScheduledTestInviteByShareCode(input.shareCode, input.requesterId);

  if (invite.access.isGroupMember) {
    throw new Error("You are already part of this group.");
  }

  if (invite.group.inviteJoinMode === "automatic") {
    await addParticipantToGroup(state, {
      groupId: invite.group.id,
      participantIdentifier: input.requesterId,
      participantLabel: input.requesterLabel,
    });
    await writeStore(state);

    return {
      mode: "automatic" as const,
    };
  }

  await createGroupJoinRequest({
    adminGroupId: invite.group.id,
    requesterId: input.requesterId,
    requesterLabel: input.requesterLabel,
  });

  return {
    mode: "approval-required" as const,
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
  const reports = getQuestionReportsForTest(state, testId);
  const reviewWindow = getCompletedTestReviewWindow(scheduledTest);

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
          reports: reports.filter((report) => report.questionId === question.id),
          totalResponses: optionSelectionCounts.reduce((total, count) => total + count, 0),
        };
      }),
    canEditQuestions: reviewWindow.isOpen,
    reviewWindowClosesAt: reviewWindow.closesAt,
    submittedCount: attempts.length,
    testId: scheduledTest.id,
    testTitle: scheduledTest.title,
  };
}

export async function updateCompletedTestQuestion(input: {
  actorId: string | null;
  correctOptionIndex: number;
  options: string[];
  prompt: string;
  questionId: string;
  testId: string;
}) {
  const state = await readStore();
  const scheduledTest = ensureActorOwnsScheduledTest(state, input.testId, input.actorId);

  if (scheduledTest.status !== "completed") {
    throw new Error("Questions can be edited after results are announced.");
  }

  assertCompletedTestReviewWindowOpen(scheduledTest);

  if (!scheduledTest.questionIds.includes(input.questionId)) {
    throw new Error("Question not found in this test.");
  }

  const normalizedDraft = normalizeDraft({
    correctOptionIndex: input.correctOptionIndex,
    options: input.options,
    prompt: input.prompt,
  });
  const validationError = validateQuestionDraft(normalizedDraft);

  if (validationError) {
    throw new Error(validationError);
  }

  const timestamp = new Date().toISOString();
  let didUpdateQuestion = false;

  state.questions = state.questions.map((question) => {
    if (question.id !== input.questionId) {
      return question;
    }

    didUpdateQuestion = true;

    return {
      ...question,
      correctOptionIndex: normalizedDraft.correctOptionIndex,
      options: normalizedDraft.options,
      prompt: normalizedDraft.prompt,
      updatedAt: timestamp,
    };
  });

  if (!didUpdateQuestion) {
    throw new Error("Question not found.");
  }

  state.questionReports = state.questionReports.map((report) =>
    report.testId === input.testId && report.questionId === input.questionId && report.status === "open"
      ? {
          ...report,
          resolvedAt: timestamp,
          status: "resolved",
        }
      : report,
  );
  rescoreAttemptsForScheduledTest(state, scheduledTest);
  await writeStore(state);

  return getAdminTestReview(input.testId, input.actorId);
}

export async function getWorkspaceData() {
  const state = await readStore();
  const scheduledTests = hydrateScheduledTests(state);
  const completedScheduledTests = scheduledTests.filter((scheduledTest) => scheduledTest.status === "completed");
  const completedScheduledTestIds = new Set(completedScheduledTests.map((scheduledTest) => scheduledTest.id));
  const completedAttempts = state.attempts.filter((attempt) => completedScheduledTestIds.has(attempt.testId));

  return {
    groupJoinRequests: state.groupJoinRequests,
    leaderboards: buildTestLeaderboards(completedAttempts, completedScheduledTests),
    history: summarizeTestHistory(completedAttempts, completedScheduledTests),
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