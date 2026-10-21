import "server-only";

import { isAppointmentBusinessProfileComplete } from "./appointment-locations";
import { reconcileBrowserNotificationIntents, type BrowserSchedule } from "./notification-store";
import { formatPhoneNumberForDisplay } from "./privacy";

import {
  buildPollRecurrenceCycles,
  buildGameLeaderboard,
  buildTestLeaderboards,
  compareTestResults,
  createGroupJoinRequest as createStoredGroupJoinRequest,
  createEmptyTestingWorkspaceState,
  createEntityId,
  createParticipantGroup,
  createParticipantProfile,
  createPresentedQuestions,
  createPersistentPollQuestion,
  createPersistentQuestion,
  dedupeParticipantIdentifiers,
  GAME_CORRECT_POINTS,
  GAME_INCORRECT_POINTS,
  GAME_LAUNCH_COUNTDOWN_MS,
  GAME_QUESTION_COUNT,
  GAME_QUESTION_DURATION_MS,
  GAME_QUESTION_READY_FALLBACK_MS,
  getGameQuestionDurationMs,
  getGameQuestionDeadline,
  getGameQuestionIndex,
  getGamePresentedQuestionIndex,
  getGameQuestionPoints,
  getRapidGameDeadline,
  getRapidParticipantQuestionIndex,
  reconcileRapidGame,
  getNextGameQuestionStartedAt,
  getGameStatus,
  getIncorrectCount,
  getScheduledTestEndTime,
  getTestMarks,
  getUnansweredCount,
  normalizeWorkspaceBranding,
  migrateApportionDirectory,
  matchApportionIdentity,
  normalizeDraft,
  normalizePollQuestionDraft,
  participantIdentifiersMatch as identifiersMatch,
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
  type GameCreatorRole,
  type GameLeaderboardEntry,
  type ObjectiveQuestion,
  type PollAttempt,
  type PollBulkImportPreview,
  type PersistentPollQuestion,
  type PollParticipantType,
  type PollQuestionDraft,
  type PollRecurrenceFrequency,
  type PollResponseMode,
  type ParticipantGroup,
  type PersistentQuestion,
  type QuestionDraft,
  type QuestionImportSource,
  type QuestionPool,
  type ScheduledPoll,
  type ScheduledGame,
  type ScheduledTest,
  type TestAttempt,
  type TestLeaderboardEntry,
  type TestQuestionReport,
  type TestingWorkspaceState,
  type WorkspaceBranding,
  validatePollQuestionDraft,
  validateQuestionDraft,
} from "@trapit/testing";
import { copyFile, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";

import {
  createPollQuestionsInBackend,
  createScheduledPollInBackend,
  deletePollQuestionFromBackend,
  getPollByIdFromBackend,
  getPollByShareCodeFromBackend,
  isDynamoDbPollStoreEnabled,
  listAllScheduledPollsFromBackend,
  listCompletedPollSeriesResultsFromBackend,
  listPollQuestionsFromBackend,
  listRespondedOpenPollIdsForUserFromBackend,
  listScheduledPollsFromBackend,
  recordPollAttemptInBackend,
  recordRegisteredPollAttemptInBackend,
  updatePollQuestionInBackend,
  updateScheduledPollInBackend,
} from "./poll-store";

const DEFAULT_PRODUCTION_DATA_DIR = ["", "var", "lib", "trapit"].join(path.sep);
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
const workspaceQueueGlobal = globalThis as typeof globalThis & {
  trapitWorkspaceQueues?: Map<string, { writes: Promise<void>; mutations: Promise<void> }>;
};
const workspaceQueues = workspaceQueueGlobal.trapitWorkspaceQueues ??= new Map();
const workspaceQueue = workspaceQueues.get(STORE_PATH) ?? { writes: Promise.resolve(), mutations: Promise.resolve() };
workspaceQueues.set(STORE_PATH, workspaceQueue);

type CriticalDataSummary = {
  attempts: number;
  games: number;
  groups: number;
  participants: number;
  pollAttempts: number;
  pollQuestions: number;
  polls: number;
  pools: number;
  questions: number;
  tests: number;
};

function isMissingStoreFileError(error: unknown) {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && (error as { code?: unknown }).code === "ENOENT";
}

function summarizeCriticalData(state: TestingWorkspaceState): CriticalDataSummary {
  return {
    attempts: state.attempts.length,
    games: state.games.length,
    groups: state.participantGroups.length,
    participants: state.participants.length,
    pollAttempts: state.pollAttempts.length,
    pollQuestions: state.pollQuestions.length,
    polls: state.scheduledPolls.length,
    pools: state.pools.length,
    questions: state.questions.length,
    tests: state.scheduledTests.length,
  };
}

function getCriticalDataTotal(summary: CriticalDataSummary) {
  return Object.values(summary).reduce((total, count) => total + count, 0);
}

function isDangerousDataReduction(currentSummary: CriticalDataSummary, nextSummary: CriticalDataSummary) {
  const currentTotal = getCriticalDataTotal(currentSummary);
  const nextTotal = getCriticalDataTotal(nextSummary);

  if (currentTotal < 10) {
    return false;
  }

  const importantCollections = ["games", "groups", "pools", "tests", "attempts", "questions"] as const;
  const wipedImportantCollectionCount = importantCollections.filter((collection) =>
    currentSummary[collection] > 0 && nextSummary[collection] === 0,
  ).length;

  return nextTotal === 0 || wipedImportantCollectionCount >= 2 || nextTotal < currentTotal * 0.1;
}

function formatCriticalDataSummary(summary: CriticalDataSummary) {
  return Object.entries(summary)
    .map(([key, value]) => `${key}=${value}`)
    .join(", ");
}

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
  assessmentKind?: ScheduledTest["assessmentKind"];
  rulesVersion?: 2;
  creatorDisplayName?: string | null;
  creatorIdentifier?: string | null;
  countdownStartedAt?: string | null;
  startedAt?: string | null;
  isCreator?: boolean;
  hasJoined?: boolean;
  acceptedCount?: number;
  joinedCount?: number;
  sharedCount?: number;
  branding?: WorkspaceBranding | null;
  createdAt: string;
  durationMinutes: number;
  groupNames: string[];
  hasAttempt: boolean;
  id: string;
  isSelfTest: boolean;
  participantGroupIds: string[];
  participantResult?: TestLeaderboardEntry;
  participantResultCount?: number;
  poolId: string;
  poolName: string;
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

type CreateScheduledPollStoreInput = {
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

function resolvePollResponseMode(input: Pick<CreateScheduledPollStoreInput, "anonymous" | "openPollRequiresRegistration" | "participantType">): PollResponseMode {
  if (input.participantType === "registered") {
    return input.anonymous ? "groups-anonymous" : "groups-named";
  }

  return input.openPollRequiresRegistration
    ? "open-registered-anonymous"
    : "open-unregistered-anonymous";
}

function buildScheduledPollRecords(
  input: CreateScheduledPollStoreInput,
  questionIds: string[],
  participantGroupIds: string[],
) {
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

  return cycles.map<ScheduledPoll>((cycle) => ({
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
}

function replaceFuturePollSeriesRecords(
  state: TestingWorkspaceState,
  existingPoll: ScheduledPoll,
  input: CreateScheduledPollStoreInput,
  questionIds: string[],
  participantGroupIds: string[],
) {
  if (!existingPoll.seriesId) {
    return false;
  }

  const nowMs = Date.now();
  const preservedCycles = state.scheduledPolls.filter((poll) =>
    poll.seriesId === existingPoll.seriesId
    && new Date(poll.startsAt).getTime() <= nowMs,
  );
  const generatedCycles = buildScheduledPollRecords(input, questionIds, participantGroupIds)
    .map((poll) => ({
      ...poll,
      createdAt: existingPoll.createdAt,
      seriesId: existingPoll.seriesId,
    }))
    .filter((poll) => new Date(poll.startsAt).getTime() > nowMs);
  const latestPreservedEndMs = preservedCycles.reduce(
    (latest, poll) => Math.max(latest, new Date(poll.endsAt).getTime()),
    Number.NEGATIVE_INFINITY,
  );

  if (generatedCycles.some((poll) => new Date(poll.startsAt).getTime() < latestPreservedEndMs)) {
    throw new Error("Future cycles must start after the active cycle ends.");
  }

  state.scheduledPolls = [
    ...state.scheduledPolls.filter((poll) =>
      poll.seriesId !== existingPoll.seriesId
      || new Date(poll.startsAt).getTime() <= nowMs,
    ),
    ...generatedCycles,
  ];
  return true;
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
  const workspaceBrandingByActor = normalizeWorkspaceBrandingByActor(parsed.workspaceBrandingByActor);
  const apportionDirectory = migrateApportionDirectory(workspaceBrandingByActor, parsed.apportionDirectory);
  for (const [provider, settings] of Object.entries(apportionDirectory.providerSettings)) {
    const key = Object.keys(workspaceBrandingByActor).find((entry) => identifiersMatch(entry, provider));
    const business = Object.values(apportionDirectory.businesses).find((entry) => identifiersMatch(entry.ownerIdentifier, provider));
    if (key && !business?.adminDelegateIdentifier) workspaceBrandingByActor[key] = { ...workspaceBrandingByActor[key], ...settings };
  }
  return {
    apportionDirectory,
    attempts: parsed.attempts ?? [],
    games: (parsed.games ?? []).map((game) => {
      const rulesVersion = game.rulesVersion ?? (game.startedAt || game.completedAt ? 1 : 2);

      return {
        ...game,
        answers: (game.answers ?? []).map((answer) => ({
          ...answer,
          kind: answer.kind ?? "submitted",
          responsePosition: answer.responsePosition ?? null,
        })),
        completedAt: game.completedAt ?? null,
        countdownStartedAt: game.countdownStartedAt ?? null,
        creatorRole: game.creatorRole ?? null,
        participants: (game.participants ?? []).map((participant) => ({
          ...participant,
          acceptedAt: participant.acceptedAt ?? null,
          identifier: normalizeParticipantIdentifier(participant.identifier),
          label: participant.label?.trim() || participant.identifier,
        })),
        questionIds: dedupe(game.questionIds ?? []).slice(0, GAME_QUESTION_COUNT),
        questionPreparedAt: rulesVersion === 3 ? (game.questionPreparedAt ?? []) : undefined,
        questionReadyParticipantIdentifiers: rulesVersion === 3
          ? (game.questionReadyParticipantIdentifiers ?? [])
          : undefined,
        questionStartedAt: rulesVersion === 2 || rulesVersion === 3
          ? (game.questionStartedAt ?? (game.startedAt ? [game.startedAt] : []))
          : undefined,
        rulesVersion,
        startedAt: game.startedAt ?? null,
        title: game.title?.trim() || "Game",
      };
    }),
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
        openPollRequiresRegistration: Boolean(poll.openPollRequiresRegistration),
        participantGroupIds: dedupe(poll.participantGroupIds ?? []),
        recurrenceCycleCount: poll.recurrenceCycleCount ?? null,
        recurrenceCycleIndex: poll.recurrenceCycleIndex ?? null,
        recurrenceFrequency: poll.recurrenceFrequency ?? null,
        responseMode: poll.responseMode ?? resolvePollResponseMode(poll),
        seriesId: poll.seriesId ?? null,
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
    workspaceBrandingByActor,
  };
}

export async function getOrCreateWorkspaceAppointmentShareCode(actorKey?: string | null) {
  return withSerializedTestingMutation((state) => {
    const normalizedActorKey = resolveBrandingActorKey(state, actorKey);

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

    return shareCode;
  });
}

export async function getWorkspaceBranding(actorKey?: string | null) {
  const state = await readStoreSnapshot();
  const normalizedActorKey = resolveBrandingActorKey(state, actorKey);

  if (!normalizedActorKey) {
    return null;
  }

  return state.workspaceBrandingByActor[normalizedActorKey] ?? null;
}

export async function listWorkspaceAppointmentBusinesses(query?: string) {
  const state = await readStoreSnapshot();
  const text = query?.trim().toLowerCase() ?? "";
  const phone = text.replace(/[\s()-]/g, "");
  const fullPhone = /^(?:\+[1-9]\d{7,14}|\d{10})$/.test(phone);

  return Object.entries(state.workspaceBrandingByActor)
    .map(([ownerIdentifier, branding]) => {
      if (!branding) return null;
      const appointmentShareCode = branding.appointmentShareCode?.trim()
        || state.workspaceAppointmentShareCodesByActor[ownerIdentifier]?.trim()
        || "";
      const name = branding.instituteName?.trim() ?? "";
      const address = branding.address?.trim() ?? "";

      if (!appointmentShareCode || !isAppointmentBusinessProfileComplete(branding)) {
        return null;
      }
      const business = Object.values(state.apportionDirectory?.businesses ?? {}).find((entry) => matchApportionIdentity(entry.ownerIdentifier, ownerIdentifier));
      if (text && !name.toLowerCase().includes(text)
        && !business?.services?.some((service) => (service?.name ?? "").toLowerCase().includes(text))
        && !(fullPhone && (matchApportionIdentity(ownerIdentifier, phone) || business?.services?.some((service) => service?.assignedIdentifier && matchApportionIdentity(service.assignedIdentifier, phone))))) return null;

      return {
        address,
        advanceBookingWeeks: branding.advanceBookingWeeks ?? 4,
        appointmentNotesPrompt: branding.appointmentNotesPrompt,
        appointmentShareCode,
        appointmentsPerSlot: branding.appointmentsPerSlot ?? null,
        justAddToList: branding.justAddToList === true,
        locations: branding.appointmentLocations ?? [],
        name: name || "Business",
        ownerIdentifier,
        recurringBookingLimit: null as number | null,
        recurringBookingsEnabled: false as boolean,
        slotDurationMinutes: branding.slotDurationMinutes ?? null,
        workingDays: branding.workingDays,
        workingHours: branding.workingHours,
        workingHoursSecondWindow: branding.workingHoursSecondWindow,
      };
    })
    .filter((entry): entry is {
      address: string;
      advanceBookingWeeks: number;
      appointmentNotesPrompt: string;
      appointmentShareCode: string;
      appointmentsPerSlot: number | null;
      justAddToList: boolean;
      locations: NonNullable<WorkspaceBranding["appointmentLocations"]>;
      name: string;
      ownerIdentifier: string;
      recurringBookingLimit: number | null;
      recurringBookingsEnabled: boolean;
      slotDurationMinutes: number | null;
      workingDays: string;
      workingHours: string;
      workingHoursSecondWindow: string;
    } => Boolean(entry))
    .sort((left, right) => left.name.localeCompare(right.name) || left.ownerIdentifier.localeCompare(right.ownerIdentifier));
}

export async function updateWorkspaceBranding(
  branding: WorkspaceBranding | null,
  actorKey?: string | null,
) {
  return withSerializedTestingMutation(async (state) => {
    const { prepareApportionBrandingMutation } = await import("./apportion-directory");
    const prepared = await prepareApportionBrandingMutation(state, branding, actorKey);
    return mutateWorkspaceBrandingState(state, prepared, actorKey);
  });
}

export function mutateWorkspaceBrandingState(
  state: TestingWorkspaceState,
  branding: WorkspaceBranding | null,
  actorKey?: string | null,
) {
  let normalizedBranding = normalizeWorkspaceBranding(branding);
  const normalizedActorKey = resolveBrandingActorKey(state, actorKey);
  const settingsKey = normalizedActorKey
    ? Object.keys(state.apportionDirectory?.providerSettings ?? {}).find((key) => identifiersMatch(key, normalizedActorKey))
    : undefined;
  const business = normalizedActorKey ? state.apportionDirectory?.businesses[normalizedActorKey] : undefined;
  if (normalizedBranding && settingsKey && !business?.adminDelegateIdentifier) {
    normalizedBranding = { ...normalizedBranding, ...state.apportionDirectory!.providerSettings[settingsKey] };
  }
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
        appointmentShareCode: ownerShareCode ?? normalizedBranding.appointmentShareCode ?? existingBranding?.appointmentShareCode ?? null,
      }
    : null;

  if (!normalizedActorKey) {
    state.workspaceBranding = brandingWithShareCode;
  } else if (brandingWithShareCode) {
    state.workspaceBrandingByActor[normalizedActorKey] = brandingWithShareCode;
  } else {
    delete state.workspaceBrandingByActor[normalizedActorKey];
  }

  if (!normalizedActorKey) {
    return null;
  }

  return state.workspaceBrandingByActor[normalizedActorKey] ?? null;
}

export async function getWorkspaceBrandingByAppointmentShareCode(shareCode: string) {
  const state = await readStoreSnapshot();
  const normalizedShareCode = decodeURIComponent(shareCode).trim().toLowerCase();

  if (!normalizedShareCode) {
    return null;
  }

  const matchesShareCode = (candidate: string | null | undefined, businessName?: string | null) => {
    const clean = candidate?.trim().toLowerCase() ?? "";
    if (!clean) return false;
    if (clean === normalizedShareCode || normalizedShareCode.endsWith(`-${clean}`)) {
      return true;
    }
    const slug = (businessName ?? "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    return Boolean(slug && normalizedShareCode === `${slug}-${clean}`);
  };

  const entry = Object.entries(state.workspaceBrandingByActor).find(([, branding]) =>
    matchesShareCode(branding.appointmentShareCode, branding.instituteName),
  );

  const mappedEntry = Object.entries(state.workspaceAppointmentShareCodesByActor).find(([actorKey, code]) =>
    matchesShareCode(code, state.workspaceBrandingByActor[actorKey]?.instituteName),
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
        result: {
          ...scoreObjectiveTest(questions, attempt.answers, startedAtMs, completedAtMs),
          ...(scheduledTest.rulesVersion === 2 ? { correctMarks: scheduledTest.assessmentKind === "instant" ? 4 : 1 } : {}),
        },
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
    totalResponses: state.pollAttempts.filter((attempt) => attempt.pollId === poll.id).length,
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
    resolvedParticipantIdentifiers: dedupeParticipantIdentifiers([
      ...resolveParticipantIdentifiers(state, dedupe(scheduledTest.participantIds), dedupe(scheduledTest.participantGroupIds)),
      ...(scheduledTest.participantSessions ?? []).map((session) => session.identifier),
    ]),
    status: resolveScheduledTestStatus(scheduledTest, state.attempts, scheduledTest.id),
  }));
}

let cachedTestingStore: { mtimeMs: number; path: string; rawContent?: string; state: TestingWorkspaceState } | null = null;

function readStoreSnapshot(): Promise<TestingWorkspaceState> {
  return readStore(false);
}

async function readStore(clone = true): Promise<TestingWorkspaceState> {
  await mkdir(path.dirname(STORE_PATH), { recursive: true });

  try {
    const fileStat = await stat(STORE_PATH);
    if (
      process.env.NODE_ENV === "production"
      && cachedTestingStore
      && cachedTestingStore.path === STORE_PATH
      && cachedTestingStore.mtimeMs === fileStat.mtimeMs
    ) {
      return clone ? structuredClone(cachedTestingStore.state) : cachedTestingStore.state;
    }

    const content = await readFile(STORE_PATH, "utf8");
    if (cachedTestingStore && cachedTestingStore.path === STORE_PATH && cachedTestingStore.rawContent === content) {
      cachedTestingStore.mtimeMs = fileStat.mtimeMs;
      return clone ? structuredClone(cachedTestingStore.state) : cachedTestingStore.state;
    }

    const parsed = JSON.parse(content) as Partial<TestingWorkspaceState>;
    const normalized = normalizeState(parsed);
    cachedTestingStore = {
      mtimeMs: fileStat.mtimeMs,
      path: STORE_PATH,
      rawContent: process.env.NODE_ENV === "production" ? undefined : content,
      state: normalized,
    };
    return clone ? structuredClone(normalized) : normalized;
  } catch (error) {
    if (!isMissingStoreFileError(error)) {
      throw error;
    }

    const emptyState = createEmptyTestingWorkspaceState();
    await writeStore(emptyState);
    return emptyState;
  }
}

function writeStore(state: TestingWorkspaceState, changedFields?: Set<keyof TestingWorkspaceState>) {
  const operation = workspaceQueue.writes.then(() => persistStore(state, changedFields));
  workspaceQueue.writes = operation.then(() => undefined, () => undefined);
  return operation;
}

async function persistStore(state: TestingWorkspaceState, changedFields?: Set<keyof TestingWorkspaceState>) {
  await mkdir(path.dirname(STORE_PATH), { recursive: true });

    try {
      let currentState: TestingWorkspaceState | null = null;
      if (process.env.NODE_ENV === "production" && cachedTestingStore && cachedTestingStore.path === STORE_PATH) {
        const fileStat = await stat(STORE_PATH).catch(() => null);
        if (fileStat && fileStat.mtimeMs === cachedTestingStore.mtimeMs) {
          currentState = cachedTestingStore.state;
        }
      }
      if (!currentState) {
        const currentContent = await readFile(STORE_PATH, "utf8");
        currentState = normalizeState(JSON.parse(currentContent) as Partial<TestingWorkspaceState>);
      }
      if (changedFields) {
        state = { ...currentState, ...Object.fromEntries([...changedFields].map((field) => [field, state[field]])) };
      } else {
        state.apportionDirectory = currentState.apportionDirectory;
        state.workspaceBranding = currentState.workspaceBranding;
        state.workspaceBrandingByActor = currentState.workspaceBrandingByActor;
        state.workspaceAppointmentShareCodesByActor = currentState.workspaceAppointmentShareCodesByActor;
      }
      const currentSummary = summarizeCriticalData(currentState);
      const nextSummary = summarizeCriticalData(state);

      if (process.env.TRAPIT_ALLOW_DESTRUCTIVE_DATA_WRITE !== "1" && isDangerousDataReduction(currentSummary, nextSummary)) {
        throw new Error(
          `Refusing to overwrite TRAPit data with a destructive reduction. Current: ${formatCriticalDataSummary(currentSummary)}. Next: ${formatCriticalDataSummary(nextSummary)}. Set TRAPIT_ALLOW_DESTRUCTIVE_DATA_WRITE=1 only for an intentional reset.`,
        );
      }
    } catch (error) {
      if (!isMissingStoreFileError(error)) {
        throw error;
      }
    }

  const temporaryStorePath = `${STORE_PATH}.${process.pid}.${Date.now()}.tmp`;
  const serialized = JSON.stringify(state);

  await writeFile(temporaryStorePath, serialized, "utf8");
  for (let attempt = 0; ; attempt += 1) {
    try {
      await rename(temporaryStorePath, STORE_PATH);
      break;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (process.platform !== "win32" || !["EPERM", "EBUSY"].includes(code ?? "") || attempt >= 5) throw error;
      await new Promise((resolve) => setTimeout(resolve, 25 * (attempt + 1)));
    }
  }
  const newStat = await stat(STORE_PATH).catch(() => null);
  cachedTestingStore = {
    mtimeMs: newStat?.mtimeMs ?? Date.now(),
    path: STORE_PATH,
    rawContent: process.env.NODE_ENV === "production" ? undefined : serialized,
    state,
  };
}

export async function readApportionWorkspaceState() {
  return readStoreSnapshot();
}

export async function backupApportionDelegationStore(state: TestingWorkspaceState, version = 1) {
  await mkdir(path.dirname(STORE_PATH), { recursive: true });
  try {
    await copyFile(STORE_PATH, `${STORE_PATH}.delegation-capacity-v${version}.backup`, constants.COPYFILE_EXCL);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      await writeFile(`${STORE_PATH}.delegation-capacity-v${version}.backup`, JSON.stringify(state), { flag: "wx" });
    } else if (code !== "EEXIST") throw error;
  }
}

export function withSerializedTestingMutation<T>(
  mutate: (state: TestingWorkspaceState) => Promise<T> | T,
): Promise<T> {
  const operation = workspaceQueue.mutations.then(async () => {
    const baselineState = await readStoreSnapshot();
    const state = structuredClone(baselineState);
    const result = await mutate(state);
    const changedFields = new Set((Array.from(new Set([...Object.keys(baselineState), ...Object.keys(state)])) as Array<keyof TestingWorkspaceState>)
      .filter((field) => !isDeepStrictEqual(state[field], baselineState[field])));
    if (changedFields.size) await writeStore(state, changedFields);
    return result;
  });

  workspaceQueue.mutations = operation.then(() => undefined, () => undefined);
  return operation;
}

function withSerializedGameMutation<T>(
  mutate: (state: TestingWorkspaceState) => Promise<T> | T,
): Promise<T> {
  const operation = workspaceQueue.mutations.then(async () => {
    const baselineState = await readStoreSnapshot();
    const originalGames = structuredClone(baselineState.games);
    const state = { ...baselineState, games: structuredClone(baselineState.games) };
    const result = await mutate(state);
    if (!isDeepStrictEqual(state.games, originalGames)) {
      await writeStore(state, new Set<keyof TestingWorkspaceState>(["games"]));
    }
    return result;
  });

  workspaceQueue.mutations = operation.then(() => undefined, () => undefined);
  return operation;
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
  const state = await readStoreSnapshot();
  return filterQuestionsForActor(state.questions, actorId, state.pools, actorIdentifier);
}

export async function createQuestion(
  draft: QuestionDraft,
  actorId: string | null,
  source: QuestionImportSource = "manual",
  poolIds: string[] = [],
  actorIdentifier: string | null = null,
  newPoolName: string | null = null,
) {
  const state = await readStore();
  const trimmedPoolName = newPoolName?.trim() ?? "";
  if (trimmedPoolName) assertAssessmentName(trimmedPoolName, "Pool name");

  if (trimmedPoolName && state.pools.some((pool) =>
    pool.createdBy === actorId && pool.name.trim().toLowerCase() === trimmedPoolName.toLowerCase(),
  )) {
    throw new Error("You already have a question pool with this name.");
  }

  const timestamp = new Date().toISOString();
  const newPool: QuestionPool | null = trimmedPoolName ? {
    createdAt: timestamp,
    createdBy: actorId,
    description: "",
    id: createEntityId("pool"),
    name: trimmedPoolName,
    questionIds: [],
    sharedWithIdentifiers: [],
    updatedAt: timestamp,
  } : null;

  if (newPool) state.pools = [newPool, ...state.pools];
  const normalizedPoolIds = dedupe([...poolIds, ...(newPool ? [newPool.id] : [])]);

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

  return {
    newPoolId: newPool?.id ?? null,
    questions: filterQuestionsForActor(state.questions, actorId, state.pools, actorIdentifier),
  };
}

export async function importQuestions(
  drafts: QuestionDraft[],
  actorId: string | null,
  poolIds: string[] = [],
  actorIdentifier: string | null = null,
  newPoolName: string | null = null,
) {
  const state = await readStore();
  const trimmedPoolName = newPoolName?.trim() ?? "";
  if (trimmedPoolName) assertAssessmentName(trimmedPoolName, "Pool name");

  if (trimmedPoolName && state.pools.some((pool) =>
    pool.createdBy === actorId && pool.name.trim().toLowerCase() === trimmedPoolName.toLowerCase(),
  )) {
    throw new Error("You already have a question pool with this name.");
  }

  const timestamp = new Date().toISOString();
  const newPool: QuestionPool | null = trimmedPoolName ? {
    createdAt: timestamp,
    createdBy: actorId,
    description: "",
    id: createEntityId("pool"),
    name: trimmedPoolName,
    questionIds: [],
    sharedWithIdentifiers: [],
    updatedAt: timestamp,
  } : null;

  if (newPool) state.pools = [newPool, ...state.pools];
  const normalizedPoolIds = dedupe([...poolIds, ...(newPool ? [newPool.id] : [])]);

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

  return {
    newPoolId: newPool?.id ?? null,
    questions: filterQuestionsForActor(state.questions, actorId, state.pools, actorIdentifier),
  };
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

export async function createScheduledPoll(input: CreateScheduledPollStoreInput) {
  await recoverBrowserSchedulingNotifications();
  const result = await createScheduledPollWithoutNotifications(input);
  await recoverBrowserSchedulingNotifications();
  return result;
}

async function createScheduledPollWithoutNotifications(input: CreateScheduledPollStoreInput) {
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

        const scheduledPolls = buildScheduledPollRecords(input, questionIds, participantGroupIds);
        state.scheduledPolls = [...scheduledPolls, ...state.scheduledPolls];
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

  const scheduledPolls = buildScheduledPollRecords(input, questionIds, participantGroupIds);
  state.scheduledPolls = [...scheduledPolls, ...state.scheduledPolls];
  await writeStore(state);

  return filterScheduledPollsForActor(hydrateScheduledPolls(state), input.createdBy);
}

export async function updateScheduledPoll(input: CreateScheduledPollStoreInput & { pollId: string }) {
  await recoverBrowserSchedulingNotifications();
  const result = await updateScheduledPollWithoutNotifications(input);
  await recoverBrowserSchedulingNotifications();
  return result;
}

async function updateScheduledPollWithoutNotifications(input: CreateScheduledPollStoreInput & { pollId: string }) {
  if (isDynamoDbPollStoreEnabled()) {
    return withPollStoreFallback(
      () => updateScheduledPollInBackend(input),
      async () => {
        const state = await readStore();
        const existingPoll = ensureActorOwnsScheduledPoll(state, input.pollId, input.createdBy);

        if (!existingPoll.seriesId && existingPoll.status !== "scheduled") {
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

        if (replaceFuturePollSeriesRecords(state, existingPoll, input, questionIds, participantGroupIds)) {
          await writeStore(state);
          return filterScheduledPollsForActor(hydrateScheduledPolls(state), input.createdBy);
        }

        state.scheduledPolls = state.scheduledPolls.map((poll) =>
          poll.id === input.pollId
            ? {
                ...poll,
                anonymous,
                branding: normalizeWorkspaceBranding(input.branding) ?? poll.branding ?? null,
                creatorDisplayName: input.creatorDisplayName?.trim() || poll.creatorDisplayName || null,
                creatorIdentifier: input.creatorIdentifier?.trim() || poll.creatorIdentifier || null,
                endsAt: input.endsAt,
                openPollRequiresRegistration: input.participantType === "open" ? Boolean(input.openPollRequiresRegistration) : false,
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

  if (!existingPoll.seriesId && existingPoll.status !== "scheduled") {
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

  if (replaceFuturePollSeriesRecords(state, existingPoll, input, questionIds, participantGroupIds)) {
    await writeStore(state);
    return filterScheduledPollsForActor(hydrateScheduledPolls(state), input.createdBy);
  }

  state.scheduledPolls = state.scheduledPolls.map((poll) =>
    poll.id === input.pollId
      ? {
          ...poll,
          anonymous,
          branding: normalizeWorkspaceBranding(input.branding) ?? poll.branding ?? null,
          creatorDisplayName: input.creatorDisplayName?.trim() || poll.creatorDisplayName || null,
          creatorIdentifier: input.creatorIdentifier?.trim() || poll.creatorIdentifier || null,
          endsAt: input.endsAt,
          openPollRequiresRegistration: input.participantType === "open" ? Boolean(input.openPollRequiresRegistration) : false,
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
  const state = await readStoreSnapshot();
  return filterPoolsForActor(state.pools, getQuestionMap(state), null);
}

export async function listPoolsForActor(
  actorId: string | null = null,
  actorIdentifier: string | null = null,
) {
  const state = await readStoreSnapshot();
  return filterPoolsForActor(state.pools, getQuestionMap(state), actorId, actorIdentifier);
}

export async function createPool(input: {
  createdBy?: string | null;
  description?: string;
  name: string;
}) {
  assertAssessmentName(input.name, "Pool name");
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

export async function renamePool(input: {
  actorId: string | null;
  actorIdentifier: string | null;
  name: string;
  poolId: string;
}) {
  const state = await readStore();
  const pool = ensureActorOwnsPool(state, input.poolId, input.actorId, input.actorIdentifier);
  const name = input.name.trim();
  if (name !== pool.name) assertAssessmentName(name, "Pool name");

  if (!name) {
    throw new Error("Pool name is required.");
  }

  if (state.pools.some((entry) =>
    entry.id !== pool.id
    && entry.createdBy === input.actorId
    && entry.name.trim().toLowerCase() === name.toLowerCase(),
  )) {
    throw new Error("You already have a question pool with this name.");
  }

  state.pools = state.pools.map((entry) => entry.id === pool.id
    ? { ...entry, name, updatedAt: new Date().toISOString() }
    : entry);
  await writeStore(state);
  return filterPoolsForActor(state.pools, getQuestionMap(state), input.actorId, input.actorIdentifier);
}

export async function deletePool(input: {
  actorId: string | null;
  actorIdentifier: string | null;
  poolId: string;
}) {
  const state = await readStore();
  const pool = ensureActorOwnsPool(state, input.poolId, input.actorId, input.actorIdentifier);

  if (state.scheduledTests.some((test) => test.poolId === pool.id) || state.games.some((game) => game.poolId === pool.id)) {
    throw new Error("This pool cannot be deleted because a test or game uses it.");
  }

  const timestamp = new Date().toISOString();
  state.pools = state.pools.filter((entry) => entry.id !== pool.id);
  state.questions = state.questions.map((question) => question.poolIds.includes(pool.id)
    ? {
        ...question,
        poolIds: question.poolIds.filter((poolId) => poolId !== pool.id),
        updatedAt: timestamp,
      }
    : question);
  await writeStore(state);
  return filterPoolsForActor(state.pools, getQuestionMap(state), input.actorId, input.actorIdentifier);
}

export async function listParticipants() {
  const state = await readStoreSnapshot();
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

    const existingParticipant = nextParticipants.find((participant) =>
      identifiersMatch(participant.identifier, normalizedIdentifier),
    );

    if (existingParticipant) {
      const directoryLabel = input.label?.trim() ?? "";
      const previousLabel = existingParticipant.label.trim();
      const hasDirectoryName = Boolean(directoryLabel)
        && !identifiersMatch(directoryLabel, normalizedIdentifier);

      if (!hasDirectoryName || previousLabel === directoryLabel) {
        continue;
      }

      const timestamp = new Date().toISOString();
      existingParticipant.label = directoryLabel;
      existingParticipant.updatedAt = timestamp;

      for (const game of state.games) {
        for (const gameParticipant of game.participants) {
          if (
            identifiersMatch(gameParticipant.identifier, normalizedIdentifier)
            && (
              !gameParticipant.label.trim()
              || gameParticipant.label === previousLabel
              || identifiersMatch(gameParticipant.label, gameParticipant.identifier)
            )
          ) {
            gameParticipant.label = directoryLabel;
            game.updatedAt = timestamp;
          }
        }
      }

      for (const attempt of state.attempts) {
        if (
          identifiersMatch(attempt.userId, normalizedIdentifier)
          && (
            !attempt.participantName?.trim()
            || identifiersMatch(attempt.participantName, attempt.userId)
          )
        ) {
          attempt.participantName = directoryLabel;
        }
      }

      didChange = true;
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
  const state = await readStoreSnapshot();
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
  assertAssessmentName(input.name, "Group name");
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
  if (input.name.trim() !== existingGroup.name) assertAssessmentName(input.name, "Group name");

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
  const state = await readStoreSnapshot();
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
    games: state.games.map((game) => {
      const hydrated = hydrateGame(game);
      return game.rulesVersion === 4
        ? { ...hydrated, answers: [], presentedQuestions: undefined, leaderboard: hydrated.status === "completed" ? hydrated.leaderboard : [] }
        : hydrated;
    }),
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
  await reconcileExpiredTestSessions();
  const state = await readStore();
  return filterScheduledTestsForActor(hydrateScheduledTests(state), actorId);
}

function assertAssessmentName(value: string, label: string) {
  if (!value.trim() || Array.from(value.trim()).length > 30) {
    throw new Error(`${label} is required and must not exceed 30 characters.`);
  }
}

function assertNewTestConfiguration(state: TestingWorkspaceState, input: {
  actorIdentifier?: string | null;
  assessmentKind: "standard" | "instant";
  participantGroupIds: string[];
  participantIds: string[];
  durationMinutes: number;
  questionCount: number;
  startsAt: string;
  generateInviteLink?: boolean;
}) {
  if (![5, 10, 20, 30, 60].includes(input.durationMinutes)) throw new Error("Choose a supported test duration.");
  if (![20, 40, 60, 100, 200].includes(input.questionCount)) throw new Error("Choose a supported question count.");
  if (!input.participantGroupIds.length) throw new Error("Choose at least one group created by you.");
  if (input.participantIds.length) throw new Error("New tests are shared through selected groups.");
  for (const groupId of dedupe(input.participantGroupIds)) {
    const group = state.participantGroups.find((entry) => entry.id === groupId);
    if (!group || !input.actorIdentifier || !isGroupOwnedBy(group, input.actorIdentifier)) {
      throw new Error("You can only schedule tests for groups created by you.");
    }
  }
  const members = dedupeParticipantIdentifiers(resolveParticipantIdentifiers(state, [], input.participantGroupIds));
  if (members.length < (input.assessmentKind === "instant" ? 4 : 1)) {
    throw new Error(input.assessmentKind === "instant" ? "Selected groups need at least 4 unique members." : "Selected groups need at least one participant.");
  }
  if (input.generateInviteLink) throw new Error("Share new tests using their group links.");
  if (!Number.isFinite(Date.parse(input.startsAt))) throw new Error("Choose a valid test date and time.");
}

export async function createScheduledTest(input: Parameters<typeof createScheduledTestWithoutNotifications>[0]) {
  await recoverBrowserSchedulingNotifications();
  const result = await createScheduledTestWithoutNotifications(input);
  await recoverBrowserSchedulingNotifications();
  return result;
}

async function createScheduledTestWithoutNotifications(input: {
  assessmentKind?: "standard" | "instant";
  actorIdentifier?: string | null;
  branding?: WorkspaceBranding | null;
  createdBy: string | null;
  creatorDisplayName?: string | null;
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
  return withSerializedTestingMutation((state) => {
  assertAssessmentName(input.title ?? "", "Test name");
  const kind = input.assessmentKind ?? "standard";
  assertNewTestConfiguration(state, { ...input, assessmentKind: kind });
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
  const title = baseTitle;
  const scheduledTest: ScheduledTest = {
    assessmentKind: kind,
    rulesVersion: 2,
    countdownStartedAt: null,
    startedAt: null,
    participantSessions: [],
    branding: normalizeWorkspaceBranding(input.branding),
    createdAt: timestamp,
    createdBy: input.createdBy,
    creatorDisplayName: input.creatorDisplayName?.trim() || null,
    creatorIdentifier: input.actorIdentifier?.trim() || null,
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
    shareCode: null,
    startsAt: input.startsAt,
    status: kind === "instant" || new Date(input.startsAt).getTime() - 60_000 > Date.now() ? "scheduled" : "live",
    title,
    updatedAt: timestamp,
  };

  state.scheduledTests = [scheduledTest, ...state.scheduledTests];

  return filterScheduledTestsForActor(hydrateScheduledTests(state), input.createdBy);
  });
}

export async function updateScheduledTest(input: Parameters<typeof updateScheduledTestWithoutNotifications>[0]) {
  await recoverBrowserSchedulingNotifications();
  const result = await updateScheduledTestWithoutNotifications(input);
  await recoverBrowserSchedulingNotifications();
  return result;
}

async function updateScheduledTestWithoutNotifications(input: {
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
  if (existingTest.rulesVersion === 2) {
    assertNewTestConfiguration(state, { ...input, assessmentKind: existingTest.assessmentKind ?? "standard" });
    if (existingTest.countdownStartedAt) throw new Error("Tests cannot be edited after launch.");
  }
  if (input.title?.trim() !== existingTest.title) assertAssessmentName(input.title ?? "", "Test name");

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
          shareCode: scheduledTest.rulesVersion === 2 ? null : scheduledTest.shareCode,
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
  const state = await readStoreSnapshot();
  const scheduledTests = filterScheduledTestsForActor(hydrateScheduledTests(state), actorId).filter(
    (scheduledTest) => scheduledTest.status === "completed",
  );
  const scheduledTestIds = new Set(scheduledTests.map((scheduledTest) => scheduledTest.id));
  const attempts = state.attempts.filter((attempt) => scheduledTestIds.has(attempt.testId));

  return summarizeTestHistory(attempts, scheduledTests);
}

export async function listLeaderboards(actorId: string | null = null) {
  const state = await readStoreSnapshot();
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
  const state = await readStoreSnapshot();
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
  const state = await readStoreSnapshot();
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
  const state = await readStoreSnapshot();
  const normalizedIdentifier = normalizeParticipantIdentifier(identifier);
  const scheduledTests = hydrateScheduledTests(state).filter((scheduledTest) =>
    Boolean(scheduledTest.creatorIdentifier && identifiersMatch(scheduledTest.creatorIdentifier, normalizedIdentifier))
    || scheduledTest.resolvedParticipantIdentifiers.some((participantIdentifier) =>
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
    .map((scheduledTest) => {
      const leaderboard = leaderboardByTestId.get(scheduledTest.id);
      const participantResult = leaderboard?.entries.find((entry) =>
        identifiersMatch(entry.participantId, normalizedIdentifier),
      );

      return {
    assessmentKind: scheduledTest.assessmentKind,
    rulesVersion: scheduledTest.rulesVersion,
    creatorDisplayName: scheduledTest.creatorDisplayName,
    creatorIdentifier: scheduledTest.creatorIdentifier,
    countdownStartedAt: scheduledTest.countdownStartedAt,
    startedAt: scheduledTest.startedAt,
    isCreator: Boolean(scheduledTest.creatorIdentifier && identifiersMatch(scheduledTest.creatorIdentifier, normalizedIdentifier)),
    hasJoined: scheduledTest.participantSessions?.some((session) => identifiersMatch(session.identifier, normalizedIdentifier)) ?? false,
    acceptedCount: scheduledTest.participantSessions?.length ?? 0,
    joinedCount: scheduledTest.participantSessions?.length,
    sharedCount: dedupeParticipantIdentifiers(resolveParticipantIdentifiers(state, [], scheduledTest.participantGroupIds)).length,
    branding: scheduledTest.branding ?? null,
    createdAt: scheduledTest.createdAt,
    durationMinutes: scheduledTest.durationMinutes,
    groupNames: scheduledTest.participantGroupIds.map(
      (groupId) => state.participantGroups.find((group) => group.id === groupId)?.name ?? "Unknown group",
    ),
    hasAttempt: state.attempts.some(
      (attempt) =>
        attempt.testId === scheduledTest.id && identifiersMatch(attempt.userId, normalizedIdentifier),
    ),
    id: scheduledTest.id,
    isSelfTest: scheduledTest.participantGroupIds.length === 0
      && scheduledTest.resolvedParticipantIdentifiers.length === 1
      && identifiersMatch(scheduledTest.resolvedParticipantIdentifiers[0], normalizedIdentifier),
    participantGroupIds: [...scheduledTest.participantGroupIds],
    participantResult,
    participantResultCount: participantResult ? leaderboard?.submittedCount : undefined,
    poolId: scheduledTest.poolId,
    poolName: state.pools.find((pool) => pool.id === scheduledTest.poolId)?.name ?? "Unknown pool",
    topPerformer: (() => {
      const topEntry = leaderboard?.entries[0];

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
    questions: scheduledTest.rulesVersion === 2 ? [] : scheduledTest.questionIds
      .map((questionId) => questionMap.get(questionId))
      .filter((question): question is PersistentQuestion => Boolean(question)),
    startsAt: scheduledTest.startsAt,
    status: scheduledTest.status,
    title: scheduledTest.title,
    updatedAt: scheduledTest.updatedAt,
      };
    })
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

export async function listBrowserNotificationSchedules(): Promise<BrowserSchedule[]> {
  const state = await readStoreSnapshot();
  // Do not silently use stale file data when the configured DynamoDB backend is unavailable.
  const polls = isDynamoDbPollStoreEnabled()
    ? await listAllScheduledPollsFromBackend()
    : hydrateScheduledPolls(state);
  return [
    ...hydrateScheduledTests(state).filter((test) => test.status !== "completed" && (test.assessmentKind !== "instant" || test.startedAt)).map((test) => ({
      kind: "test" as const,
      id: test.id,
      startsAt: test.startsAt,
      endsAt: getScheduledTestEndTime(test),
      recipients: resolveParticipantIdentifiers(state, test.participantIds, test.participantGroupIds),
    })),
    ...polls.filter((poll) => poll.status !== "completed").map((poll) => ({
      kind: "poll" as const,
      id: poll.id,
      startsAt: poll.startsAt,
      endsAt: poll.endsAt,
      // Public/open access and past responses are not notification invitations.
      recipients: resolveParticipantIdentifiers(state, [], poll.participantGroupIds),
    })),
  ];
}

async function recoverBrowserSchedulingNotifications() {
  return reconcileBrowserNotificationIntents(await listBrowserNotificationSchedules());
}

export async function listAvailablePollsForParticipant(identifier: string): Promise<ScheduledPoll[]> {
  const state = await readStoreSnapshot();
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
    .map((poll) => ({
      ...poll,
      groupNames: poll.participantGroupIds.map(
        (groupId) => state.participantGroups.find((group) => group.id === groupId)?.name ?? "Unknown group",
      ),
      hasSubmitted: respondedPollIds.has(poll.id),
    }))
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
      canRespond: !poll.openPollRequiresRegistration || Boolean(viewer?.identifier),
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
  const isRecurringResultPublished = !input.poll.seriesId || input.poll.status === "completed";
  const canViewResults = isRecurringResultPublished && (isCreator || hasSubmitted);
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

export async function listCompletedPollSeriesResults(
  poll: ScheduledPoll,
  viewer: { identifier?: string | null; isRegistered?: boolean; sub?: string | null },
) {
  if (!poll.seriesId) {
    return [];
  }

  const state = await readStore();
  if (isDynamoDbPollStoreEnabled()) {
    return withPollStoreFallback(
      () => listCompletedPollSeriesResultsFromBackend(poll.seriesId ?? ""),
      async () => [],
    );
  }

  const polls = isDynamoDbPollStoreEnabled()
    ? await withPollStoreFallback(() => listAllScheduledPollsFromBackend(), async () => hydrateScheduledPolls(state))
    : hydrateScheduledPolls(state);
  const completedCycles = polls
    .filter((cycle) => cycle.seriesId === poll.seriesId && cycle.status === "completed")
    .sort((left, right) => (left.recurrenceCycleIndex ?? 0) - (right.recurrenceCycleIndex ?? 0));
  const questionMap = new Map(state.pollQuestions.map((question) => [question.id, question]));

  return Promise.all(completedCycles.map(async (cycle) => {
    const payload = isDynamoDbPollStoreEnabled()
      ? await withPollStoreFallback(
          () => getPollByIdFromBackend(cycle.id, {
            identifier: viewer.identifier,
            isRegistered: viewer.isRegistered,
            responseUserId: viewer.identifier,
            sub: viewer.sub,
          }),
          async () => {
            const questions = cycle.questionIds.map((id) => questionMap.get(id)).filter((question): question is PersistentPollQuestion => Boolean(question));
            return buildParticipantPollSummary({
              attempts: state.pollAttempts.filter((attempt) => attempt.pollId === cycle.id),
              identifier: viewer.identifier ?? cycle.creatorIdentifier ?? "",
              poll: cycle,
              questions,
            });
          },
        )
      : buildParticipantPollSummary({
          attempts: state.pollAttempts.filter((attempt) => attempt.pollId === cycle.id),
          identifier: viewer.identifier ?? cycle.creatorIdentifier ?? "",
          poll: cycle,
          questions: cycle.questionIds.map((id) => questionMap.get(id)).filter((question): question is PersistentPollQuestion => Boolean(question)),
        });

    return {
      endsAt: cycle.endsAt,
      label: `Instance ${(cycle.recurrenceCycleIndex ?? 0) + 1}`,
      pollId: cycle.id,
      startsAt: cycle.startsAt,
      summary: payload.summary,
      totalResponses: payload.totalResponses,
    };
  }));
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
        const isRecurringResultPublished = !poll.seriesId || poll.status === "completed";
        const canViewResults = isRecurringResultPublished
          && (isCreator || Boolean(viewer?.isRegistered && hasSubmitted));
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
      const isRecurringResultPublished = !poll.seriesId || poll.status === "completed";
      const canViewResults = isRecurringResultPublished
        && (isCreator || Boolean(viewer?.isRegistered && hasSubmitted));
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

function findVersionedTest(state: TestingWorkspaceState, testId: string) {
  const test = state.scheduledTests.find((entry) => entry.id === testId);
  if (!test || test.rulesVersion !== 2) throw new Error("This test does not support participant sessions.");
  return test;
}

function canAccessTest(state: TestingWorkspaceState, test: ScheduledTest, identifier: string) {
  return Boolean(test.creatorIdentifier && identifiersMatch(test.creatorIdentifier, identifier))
    || (test.participantSessions ?? []).some((entry) => identifiersMatch(entry.identifier, identifier))
    || resolveParticipantIdentifiers(state, [], test.participantGroupIds).some((entry) => identifiersMatch(entry, identifier));
}

function finalizeTestSession(state: TestingWorkspaceState, test: ScheduledTest, session: NonNullable<ScheduledTest["participantSessions"]>[number], completedAt: string) {
  const previous = state.attempts.find((entry) => entry.testId === test.id && identifiersMatch(entry.userId, session.identifier));
  if (previous) return previous;
  const questions = test.questionIds.map((id) => state.questions.find((entry) => entry.id === id)).filter((entry): entry is PersistentQuestion => Boolean(entry));
  const effectiveStart = Math.max(Date.parse(test.startsAt), Date.parse(session.startedAt ?? test.startsAt));
  const scored = scoreObjectiveTest(questions, session.answers, effectiveStart, Date.parse(completedAt));
  if (typeof session.elapsedMs === "number" && Number.isFinite(session.elapsedMs) && session.elapsedMs >= 0) {
    scored.elapsedMs = Math.min(scored.elapsedMs, Math.floor(session.elapsedMs));
  }
  const attempt: TestAttempt = {
    id: createEntityId("attempt"),
    testId: test.id,
    userId: session.identifier,
    participantName: session.participantName,
    answers: { ...session.answers },
    startedAt: new Date(effectiveStart).toISOString(),
    completedAt,
    result: {
      ...scored,
      correctMarks: test.assessmentKind === "instant" ? 4 : 1,
    },
  };
  session.submittedAt = completedAt;
  state.attempts.push(attempt);
  return attempt;
}

function finalizeExpiredTestSessions(state: TestingWorkspaceState, now: number) {
  for (const test of state.scheduledTests) {
    if (test.rulesVersion !== 2 || (test.assessmentKind === "instant" && !test.startedAt)) continue;
    const end = getScheduledTestEndTime(test);
    if (now < Date.parse(end)) continue;
    for (const session of test.participantSessions ?? []) {
      if (!session.submittedAt) finalizeTestSession(state, test, session, end);
    }
  }
}

function hasExpiredTestSessionsToFinalize(state: TestingWorkspaceState, now: number) {
  return state.scheduledTests.some((test) => {
    if (test.rulesVersion !== 2 || (test.assessmentKind === "instant" && !test.startedAt)) return false;
    const end = getScheduledTestEndTime(test);
    if (now < Date.parse(end)) return false;
    return (test.participantSessions ?? []).some((session) => !session.submittedAt);
  });
}

export async function reconcileExpiredTestSessions() {
  const snapshot = await readStoreSnapshot();
  if (!hasExpiredTestSessionsToFinalize(snapshot, Date.now())) {
    return;
  }
  return withSerializedTestingMutation((state) => {
    finalizeExpiredTestSessions(state, Date.now());
  });
}

function getCumulativeTestMarks(state: TestingWorkspaceState, identifier: string) {
  const completedTestIds = new Set(
    hydrateScheduledTests(state)
      .filter((test) => test.status === "completed")
      .map((test) => test.id),
  );
  return state.attempts
    .filter((attempt) => completedTestIds.has(attempt.testId) && identifiersMatch(attempt.userId, identifier))
    .reduce((total, attempt) => total + getTestMarks(attempt.result), 0);
}

function buildLiveInstantLeaderboard(state: TestingWorkspaceState, test: ScheduledTest, viewerIdentifier: string, isCreator: boolean) {
  if (test.assessmentKind !== "instant") return [];
  const questions = test.questionIds
    .map((id) => state.questions.find((entry) => entry.id === id))
    .filter((entry): entry is PersistentQuestion => Boolean(entry));
  const sessions = test.participantSessions ?? [];
  const startMs = Date.parse(test.startsAt);
  const scoredSessions = sessions.map((session) => {
    const answeredQuestions = questions.filter((q) => typeof session.answers[q.id] === "number");
    const correctCount = answeredQuestions.filter((q) => session.answers[q.id] === q.correctOptionIndex).length;
    const incorrectCount = answeredQuestions.length - correctCount;
    const unansweredCount = session.submittedAt ? Math.max(0, questions.length - answeredQuestions.length) : 0;
    const penaltyCount = incorrectCount + unansweredCount;
    const marks = (correctCount * 4) - penaltyCount;
    const fallbackElapsed = session.updatedAt && Number.isFinite(startMs)
      ? Math.max(0, Date.parse(session.updatedAt) - Math.max(startMs, Date.parse(session.startedAt ?? test.startsAt)))
      : 0;
    const elapsedMs = typeof session.elapsedMs === "number" && Number.isFinite(session.elapsedMs)
      ? Math.max(0, Math.floor(session.elapsedMs))
      : fallbackElapsed;
    return {
      identifier: session.identifier,
      participantName: session.participantName || session.identifier,
      maskedIdentifier: formatPhoneNumberForDisplay(session.identifier),
      correctCount,
      incorrectUnansweredCount: penaltyCount,
      marks,
      elapsedMs,
      isSelf: identifiersMatch(session.identifier, viewerIdentifier),
    };
  }).sort((left, right) =>
    right.marks - left.marks
    || left.incorrectUnansweredCount - right.incorrectUnansweredCount
    || left.elapsedMs - right.elapsedMs
    || left.participantName.localeCompare(right.participantName),
  );

  const ranked = scoredSessions.map((entry, index, list) => {
    const prev = list[index - 1];
    const rank = index === 0
      ? 1
      : prev && prev.marks === entry.marks && prev.incorrectUnansweredCount === entry.incorrectUnansweredCount && prev.elapsedMs === entry.elapsedMs
        ? (list.slice(0, index).find((item) => item.marks === entry.marks && item.incorrectUnansweredCount === entry.incorrectUnansweredCount && item.elapsedMs === entry.elapsedMs) ? index : index + 1)
        : index + 1;
    return { ...entry, rank };
  });
  for (let i = 1; i < ranked.length; i += 1) {
    const prev = ranked[i - 1];
    const curr = ranked[i];
    if (prev.marks === curr.marks && prev.incorrectUnansweredCount === curr.incorrectUnansweredCount && prev.elapsedMs === curr.elapsedMs) {
      curr.rank = prev.rank;
    } else {
      curr.rank = i + 1;
    }
  }

  return ranked
    .filter((entry, index) => isCreator || index < 10 || entry.isSelf)
    .map(({ identifier: _id, ...rest }) => rest);
}

function testSessionPayload(state: TestingWorkspaceState, test: ScheduledTest, identifier: string) {
  const session = test.participantSessions?.find((entry) => identifiersMatch(entry.identifier, identifier)) ?? null;
  const now = Date.now();
  const status = resolveScheduledTestStatus(test, state.attempts, test.id);
  const canReadQuestions = Boolean(session && !session.submittedAt && status === "live" && now >= Date.parse(test.startsAt));
  const isCreator = Boolean(test.creatorIdentifier && identifiersMatch(test.creatorIdentifier, identifier));
  return {
    test: {
      id: test.id,
      title: test.title,
      branding: test.branding,
      assessmentKind: test.assessmentKind,
      rulesVersion: test.rulesVersion,
      startsAt: test.startsAt,
      startedAt: test.startedAt,
      countdownStartedAt: test.countdownStartedAt,
      durationMinutes: test.durationMinutes,
      questionCount: test.questionCount,
      status,
      questions: canReadQuestions
        ? test.questionIds.map((id) => state.questions.find((question) => question.id === id))
          .filter((question): question is PersistentQuestion => Boolean(question))
          .map(({ id, prompt, options }) => ({ id, prompt, options }))
        : [],
    },
    session,
    acceptedCount: test.participantSessions?.length ?? 0,
    isCreator,
    overallMarks: getCumulativeTestMarks(state, identifier),
    leaderboard: buildLiveInstantLeaderboard(state, test, identifier, isCreator),
  };
}

export async function getTestParticipantSession(testId: string, identifier: string) {
  const snapshot = await readStoreSnapshot();
  const now = Date.now();
  if (!hasExpiredTestSessionsToFinalize(snapshot, now)) {
    const test = findVersionedTest(snapshot, testId);
    if (!canAccessTest(snapshot, test, identifier)) throw new Error("You are not assigned to this test.");
    return testSessionPayload(snapshot, test, identifier);
  }
  return withSerializedTestingMutation((state) => {
    finalizeExpiredTestSessions(state, Date.now());
    const test = findVersionedTest(state, testId);
    if (!canAccessTest(state, test, identifier)) throw new Error("You are not assigned to this test.");
    return testSessionPayload(state, test, identifier);
  });
}

export async function saveTestParticipantSession(input: {
  testId: string;
  identifier: string;
  participantName?: string;
  answers?: Record<string, number | undefined>;
  elapsedMs?: number;
  revision?: number;
}) {
  return withSerializedTestingMutation((state) => {
    const test = findVersionedTest(state, input.testId);
    if (!canAccessTest(state, test, input.identifier)) throw new Error("You are not assigned to this test.");
    const now = Date.now();
    const instant = test.assessmentKind === "instant";
    const startsAt = Date.parse(test.startsAt);
    if ((!instant || test.startedAt) && now >= Date.parse(getScheduledTestEndTime(test))) throw new Error("This test has ended.");
    let session = test.participantSessions?.find((entry) => identifiersMatch(entry.identifier, input.identifier));
    if (!session) {
      if (instant && test.countdownStartedAt) throw new Error("This test has already launched.");
      if (!instant && now < startsAt - 60_000) throw new Error("Entry opens one minute before the test.");
      const participantName = input.participantName?.trim();
      if (!participantName) throw new Error("Enter your name before joining.");
      session = {
        identifier: normalizeParticipantIdentifier(input.identifier),
        participantName,
        joinedAt: new Date(now).toISOString(),
        startedAt: instant ? null : new Date(Math.max(now, startsAt)).toISOString(),
        answers: {},
        revision: 0,
        submittedAt: null,
      };
      (test.participantSessions ??= []).push(session);
    }
    if (session.submittedAt) throw new Error("This test has already been submitted.");
    if (input.answers) {
      if ((instant && !test.startedAt) || now < startsAt) throw new Error("Questions are not available yet.");
      if (!Number.isSafeInteger(input.revision) || (input.revision ?? 0) < 1) throw new Error("A valid answer revision is required.");
      for (const [id, answer] of Object.entries(input.answers)) {
        const question = state.questions.find((entry) => entry.id === id && test.questionIds.includes(id));
        if (!question || (answer !== undefined && (!Number.isInteger(answer) || answer < 0 || answer >= question.options.length))) {
          throw new Error("An answer references an invalid question or option.");
        }
      }
      const revision = input.revision;
      if (typeof revision === "number" && revision > session.revision) {
        session.answers = { ...input.answers };
        session.revision = revision;
        session.updatedAt = new Date(now).toISOString();
        const effectiveStart = Math.max(startsAt, Date.parse(session.startedAt ?? test.startsAt));
        const serverElapsed = Math.max(0, now - effectiveStart);
        session.elapsedMs = typeof input.elapsedMs === "number" && Number.isFinite(input.elapsedMs) && input.elapsedMs >= 0
          ? Math.min(serverElapsed, Math.floor(input.elapsedMs))
          : serverElapsed;
      } else if (!isDeepStrictEqual(session.answers, input.answers)) {
        throw new Error("A newer answer revision was already saved. Refresh this test before continuing.");
      }
    }
    test.updatedAt = new Date(now).toISOString();
    return testSessionPayload(state, test, input.identifier);
  });
}

export async function startInstantTest(testId: string, identifier: string) {
  return withSerializedTestingMutation((state) => {
    const test = findVersionedTest(state, testId);
    if (test.assessmentKind !== "instant") throw new Error("Only Instant Tests use a creator-controlled start.");
    if (!test.creatorIdentifier || !identifiersMatch(test.creatorIdentifier, identifier)) throw new Error("Only the creator can start this test.");
    if (test.countdownStartedAt) return testSessionPayload(state, test, identifier);
    const eligible = resolveParticipantIdentifiers(state, [], test.participantGroupIds);
    test.participantSessions = (test.participantSessions ?? []).filter((session) =>
      identifiersMatch(session.identifier, identifier) || eligible.some((member) => identifiersMatch(member, session.identifier)));
    if (test.participantSessions.length < 4) throw new Error("At least 4 participants must accept before starting.");
    const now = Date.now();
    test.countdownStartedAt = new Date(now).toISOString();
    test.startsAt = new Date(now + GAME_LAUNCH_COUNTDOWN_MS).toISOString();
    test.startedAt = test.startsAt;
    for (const session of test.participantSessions) session.startedAt = test.startsAt;
    test.updatedAt = test.countdownStartedAt;
    return testSessionPayload(state, test, identifier);
  });
}

export async function submitVersionedTest(testId: string, identifier: string) {
  return withSerializedTestingMutation((state) => {
    const test = findVersionedTest(state, testId);
    const session = test.participantSessions?.find((entry) => identifiersMatch(entry.identifier, identifier));
    if (!session) throw new Error("Join this test and enter your name before submitting.");
    if ((test.assessmentKind === "instant" && !test.startedAt) || Date.now() < Date.parse(test.startsAt)) throw new Error("This test has not started.");
    const end = getScheduledTestEndTime(test);
    const completedAt = new Date(Math.min(Date.now(), Date.parse(end))).toISOString();
    const attempt = finalizeTestSession(state, test, session, completedAt);
    return { attempt: { id: attempt.id }, resultReleased: Date.now() >= Date.parse(end), resultReleaseAt: end };
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

  if (scheduledTest.rulesVersion === 2) {
    throw new Error("Use the participant session to save and submit this test.");
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

export async function getTestResults(input: {
  actorId: string | null;
  participantIdentifier: string;
  testId: string;
}) {
  await reconcileExpiredTestSessions();
  const state = await readStoreSnapshot();
  const scheduledTest = getCompletedScheduledTest(state, input.testId);
  const normalizedParticipantIdentifier = normalizeParticipantIdentifier(input.participantIdentifier);
  const participantAttempt = state.attempts.find(
    (attempt) => attempt.testId === input.testId
      && identifiersMatch(attempt.userId, normalizedParticipantIdentifier),
  );
  const hasParticipantScope = Boolean(participantAttempt)
    || scheduledTest.resolvedParticipantIdentifiers.some((identifier) =>
      identifiersMatch(identifier, normalizedParticipantIdentifier),
    );
  const hasCreatorScope = input.actorId === null || scheduledTest.createdBy === input.actorId;

  if (!hasCreatorScope && !hasParticipantScope) {
    throw new Error("You do not have access to these test results.");
  }

  const attempts = state.attempts.filter((attempt) => attempt.testId === input.testId);
  const leaderboard = buildTestLeaderboards(attempts, [scheduledTest])[0];
  const participantEntry = leaderboard.entries.find((entry) =>
    identifiersMatch(entry.participantId, normalizedParticipantIdentifier),
  );
  const questionMap = getQuestionMap(state);
  const pool = state.pools.find((entry) => entry.id === scheduledTest.poolId);
  const groupNames = scheduledTest.participantGroupIds.map(
    (groupId) => state.participantGroups.find((group) => group.id === groupId)?.name ?? "Unknown group",
  );
  const creatorProfile = state.participants.find((participant) =>
    scheduledTest.creatorIdentifier
    && identifiersMatch(participant.identifier, scheduledTest.creatorIdentifier),
  );
  const creatorName = formatPhoneNumberForDisplay(scheduledTest.creatorDisplayName?.trim()
    || creatorProfile?.label?.trim()
    || formatPhoneNumberForDisplay(scheduledTest.creatorIdentifier)
    || "Unknown creator");
  const visibleEntries = hasCreatorScope
    ? leaderboard.entries
    : leaderboard.entries.filter((entry, index) =>
        index < 10 || identifiersMatch(entry.participantId, normalizedParticipantIdentifier),
      );
  const sharedCount = dedupeParticipantIdentifiers(resolveParticipantIdentifiers(
    state,
    [],
    scheduledTest.participantGroupIds,
  )).length;
  const assessmentKind = scheduledTest.assessmentKind ?? "standard";
  const correctMarks = scheduledTest.rulesVersion === 2
    ? (assessmentKind === "instant" ? 4 : 1)
    : (attempts[0]?.result.correctMarks ?? 4);
  const overallMarks = getCumulativeTestMarks(state, normalizedParticipantIdentifier);

  return {
    assessmentKind,
    branding: scheduledTest.branding ?? null,
    correctMarks,
    groupNames,
    hasCreatorScope,
    hasParticipantScope,
    overallMarks,
    participantResult: participantEntry
      ? {
          completedAt: participantEntry.completedAt,
          correctCount: participantEntry.correctCount,
          elapsedMs: participantEntry.elapsedMs,
          incorrectCount: participantEntry.incorrectCount,
          marks: participantEntry.marks,
          participantName: formatPhoneNumberForDisplay(participantEntry.participantName?.trim() || normalizedParticipantIdentifier),
          rank: participantEntry.rank,
          rankedParticipantCount: leaderboard.submittedCount,
          totalCount: participantEntry.totalCount,
        }
      : null,
    participants: visibleEntries.map((entry) => {
          return {
            correctCount: entry.correctCount,
            elapsedMs: entry.elapsedMs,
            marks: entry.marks,
            incorrectCount: entry.incorrectCount,
            isCurrentParticipant: identifiersMatch(entry.participantId, normalizedParticipantIdentifier),
            manualName: formatPhoneNumberForDisplay(entry.participantName?.trim()) || "—",
            maskedIdentifier: formatPhoneNumberForDisplay(entry.participantId),
            rank: entry.rank,
            totalCount: entry.totalCount,
            unansweredCount: entry.unansweredCount,
          };
        }),
    poolName: pool?.name ?? "Unknown pool",
    questions: scheduledTest.questionIds
      .map((questionId) => questionMap.get(questionId))
      .filter((question): question is PersistentQuestion => Boolean(question))
      .map((question) => {
        const optionSelectionCounts = question.options.map(() => 0);

        for (const attempt of attempts) {
          const selectedOptionIndex = attempt.answers[question.id];

          if (typeof selectedOptionIndex === "number" && optionSelectionCounts[selectedOptionIndex] !== undefined) {
            optionSelectionCounts[selectedOptionIndex] += 1;
          }
        }

        const selectedOptionIndex = hasParticipantScope ? participantAttempt?.answers[question.id] ?? null : null;
        const questionMarks = hasParticipantScope
          ? selectedOptionIndex === question.correctOptionIndex
            ? correctMarks
            : -1
          : null;

        return {
          correctOptionIndex: question.correctOptionIndex,
          marks: questionMarks,
          optionSelectionCounts,
          options: question.options,
          prompt: question.prompt,
          questionId: question.id,
          selectedOptionIndex,
        };
      }),
    summary: {
      creatorName,
      durationMinutes: scheduledTest.durationMinutes,
      participantName: formatPhoneNumberForDisplay(participantEntry?.participantName?.trim() || normalizedParticipantIdentifier) || "—",
      poolName: pool?.name ?? "Unknown pool",
      startsAt: scheduledTest.startsAt,
      submittedCount: leaderboard.submittedCount,
      sharedCount,
      testId: scheduledTest.id,
      title: scheduledTest.title,
    },
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
  const state = await readStoreSnapshot();
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
      games: state.games.length,
      groups: state.participantGroups.length,
      participants: state.participants.length,
      pools: state.pools.length,
      questions: state.questions.length,
      scheduledTests: state.scheduledTests.length,
    },
  };
}

function findGameParticipant(game: ScheduledGame, participantIdentifier: string) {
  return game.participants.find((participant) =>
    identifiersMatch(participant.identifier, participantIdentifier),
  );
}

function refreshRapidInvitations(state: TestingWorkspaceState, game: ScheduledGame) {
  if (game.rulesVersion !== 4 || game.countdownStartedAt) return;
  const groups = state.participantGroups.filter((group) =>
    (game.participantGroupIds ?? [game.participantGroupId]).includes(group.id)
    && isGroupOwnedBy(group, game.creatorIdentifier));
  const memberIds = new Set(groups.flatMap((group) => group.participantIds));
  const profiles = state.participants.filter((profile) => memberIds.has(profile.id));
  const identifiers = dedupeParticipantIdentifiers([...profiles.map((profile) => profile.identifier), game.creatorIdentifier]);
  game.participants = identifiers.map((identifier) => findGameParticipant(game, identifier) ?? {
    acceptedAt: null, identifier,
    label: profiles.find((profile) => identifiersMatch(profile.identifier, identifier))?.label || identifier,
  });
}

function getAcceptedGameParticipants(game: ScheduledGame) {
  return game.participants.filter((participant, participantIndex, participants) =>
    Boolean(participant.acceptedAt)
    && participants.findIndex((candidate) =>
      Boolean(candidate.acceptedAt)
      && identifiersMatch(candidate.identifier, participant.identifier),
    ) === participantIndex,
  );
}

function advanceGameLifecycle(game: ScheduledGame, now: Date) {
  if (game.rulesVersion === 4) {
    reconcileRapidGame(game, now.getTime());
    return;
  }
  if (game.completedAt) {
    return;
  }

  if (game.rulesVersion !== 2 && game.rulesVersion !== 3) {
    if (getGameStatus(game, now.getTime()) === "completed") {
      game.completedAt = now.toISOString();
      game.updatedAt = game.completedAt;
    }
    return;
  }

  if (!game.countdownStartedAt) {
    return;
  }

  const launchAtMs = new Date(game.countdownStartedAt).getTime() + GAME_LAUNCH_COUNTDOWN_MS;

  if (game.rulesVersion === 3) {
    const questionPreparedAt = game.questionPreparedAt ?? (game.questionPreparedAt = []);
    const questionReadyParticipantIdentifiers = game.questionReadyParticipantIdentifiers
      ?? (game.questionReadyParticipantIdentifiers = []);
    const questionStartedAt = game.questionStartedAt ?? (game.questionStartedAt = []);

    if (!questionPreparedAt.length) {
      if (now.getTime() < launchAtMs) {
        return;
      }

      questionPreparedAt[0] = new Date(launchAtMs).toISOString();
      questionReadyParticipantIdentifiers[0] = [];
      game.updatedAt = questionPreparedAt[0];
      return;
    }

    const questionIndex = questionPreparedAt.length - 1;
    const acceptedParticipants = getAcceptedGameParticipants(game);

    if (!questionStartedAt[questionIndex]) {
      const readyIdentifiers = questionReadyParticipantIdentifiers[questionIndex] ?? [];
      const allAcceptedReady = acceptedParticipants.length > 0 && acceptedParticipants.every((participant) =>
        readyIdentifiers.some((identifier) => identifiersMatch(identifier, participant.identifier)),
      );
      const fallbackAtMs = new Date(questionPreparedAt[questionIndex]).getTime() + GAME_QUESTION_READY_FALLBACK_MS;

      if (!allAcceptedReady && now.getTime() < fallbackAtMs) {
        return;
      }

      questionStartedAt[questionIndex] = now.toISOString();
      game.startedAt ??= questionStartedAt[questionIndex];
      game.updatedAt = questionStartedAt[questionIndex];
      return;
    }

    const questionAnswers = game.answers.filter((answer) => answer.questionIndex === questionIndex);
    const allAcceptedAnswered = acceptedParticipants.length > 0 && acceptedParticipants.every((participant) =>
      questionAnswers.some((answer) => identifiersMatch(answer.participantIdentifier, participant.identifier)),
    );
    const deadlineMs = new Date(questionStartedAt[questionIndex]).getTime() + GAME_QUESTION_DURATION_MS;

    if (!allAcceptedAnswered && now.getTime() < deadlineMs) {
      return;
    }

    const transitionAt = allAcceptedAnswered ? now.getTime() : deadlineMs;

    if (!allAcceptedAnswered) {
      for (const participant of acceptedParticipants) {
        if (questionAnswers.some((answer) => identifiersMatch(answer.participantIdentifier, participant.identifier))) {
          continue;
        }
        game.answers.push({
          answeredAt: new Date(deadlineMs).toISOString(),
          isCorrect: false,
          kind: "timeout",
          optionIndex: null,
          participantIdentifier: participant.identifier,
          points: GAME_INCORRECT_POINTS,
          questionIndex,
          responsePosition: null,
        });
      }
    }

    if (questionIndex === GAME_QUESTION_COUNT - 1) {
      game.completedAt = new Date(transitionAt).toISOString();
      game.updatedAt = game.completedAt;
      return;
    }

    questionPreparedAt[questionIndex + 1] = new Date(transitionAt).toISOString();
    questionReadyParticipantIdentifiers[questionIndex + 1] = [];
    game.updatedAt = questionPreparedAt[questionIndex + 1];
    return;
  }

  const questionStartedAt = game.questionStartedAt ?? (game.questionStartedAt = []);

  if (!game.startedAt) {
    if (now.getTime() < launchAtMs) {
      return;
    }

    game.startedAt = new Date(launchAtMs).toISOString();
    questionStartedAt[0] = game.startedAt;
    game.updatedAt = game.startedAt;
  }

  while (!game.completedAt) {
    const questionIndex = questionStartedAt.length - 1;

    if (questionIndex < 0 || questionIndex >= GAME_QUESTION_COUNT) {
      return;
    }

    const acceptedParticipants = getAcceptedGameParticipants(game);
    const questionAnswers = game.answers.filter((answer) => answer.questionIndex === questionIndex);
    const allAcceptedAnswered = acceptedParticipants.length > 0 && acceptedParticipants.every((participant) =>
      questionAnswers.some((answer) => identifiersMatch(answer.participantIdentifier, participant.identifier)),
    );
    const deadlineMs = new Date(questionStartedAt[questionIndex]).getTime() + GAME_QUESTION_DURATION_MS;

    if (!allAcceptedAnswered && now.getTime() < deadlineMs) {
      return;
    }

    const transitionAt = allAcceptedAnswered
      ? questionAnswers.reduce(
          (latest, answer) => Math.max(latest, new Date(answer.answeredAt).getTime()),
          new Date(questionStartedAt[questionIndex]).getTime(),
        )
      : deadlineMs;

    if (!allAcceptedAnswered) {
      for (const participant of acceptedParticipants) {
        if (questionAnswers.some((answer) => identifiersMatch(answer.participantIdentifier, participant.identifier))) {
          continue;
        }

        game.answers.push({
          answeredAt: new Date(deadlineMs).toISOString(),
          isCorrect: false,
          kind: "timeout",
          optionIndex: null,
          participantIdentifier: participant.identifier,
          points: GAME_INCORRECT_POINTS,
          questionIndex,
          responsePosition: null,
        });
      }
    }

    if (questionIndex === GAME_QUESTION_COUNT - 1) {
      game.completedAt = new Date(transitionAt).toISOString();
      game.updatedAt = game.completedAt;
      return;
    }

    questionStartedAt[questionIndex + 1] = getNextGameQuestionStartedAt(
      transitionAt,
      now.getTime(),
    );
    game.updatedAt = questionStartedAt[questionIndex + 1];

    if (now.getTime() < transitionAt) {
      return;
    }
  }
}

export type AvailableGame = ScheduledGame & {
  acceptedCount: number;
  countdownDeadline: string | null;
  currentQuestionIndex: number | null;
  leaderboard: GameLeaderboardEntry[];
  preparationDeadline: string | null;
  questionDeadline: string | null;
  status: ReturnType<typeof getGameStatus>;
  globalDeadline: string | null;
  participantQuestionStartedAt: string | null;
};

function hydrateGame(game: ScheduledGame, nowMs = Date.now(), viewerIdentifier?: string): AvailableGame {
  const participant = viewerIdentifier ? findGameParticipant(game, viewerIdentifier) : undefined;
  const currentQuestionIndex = game.rulesVersion === 4
    ? participant ? getRapidParticipantQuestionIndex(game, participant, nowMs) : null
    : getGamePresentedQuestionIndex(game, nowMs);
  const participantQuestionStartedAt = currentQuestionIndex === null ? null : participant?.questionStartedAt?.[currentQuestionIndex] ?? null;
  const globalDeadlineMs = game.rulesVersion === 4 ? getRapidGameDeadline(game) : null;

  return {
    ...game,
    globalDeadline: globalDeadlineMs === null ? null : new Date(globalDeadlineMs).toISOString(),
    participantQuestionStartedAt,
    acceptedCount: getAcceptedGameParticipants(game).length,
    countdownDeadline: game.countdownStartedAt && !game.startedAt && !game.questionPreparedAt?.length
      ? new Date(new Date(game.countdownStartedAt).getTime() + GAME_LAUNCH_COUNTDOWN_MS).toISOString()
      : null,
    currentQuestionIndex,
    leaderboard: buildGameLeaderboard(game),
    preparationDeadline: game.rulesVersion === 3
      && currentQuestionIndex !== null
      && game.questionPreparedAt?.[currentQuestionIndex]
      && !game.questionStartedAt?.[currentQuestionIndex]
      ? new Date(
          new Date(game.questionPreparedAt[currentQuestionIndex]).getTime() + GAME_QUESTION_READY_FALLBACK_MS,
        ).toISOString()
      : null,
    questionDeadline: game.rulesVersion === 4
      ? participantQuestionStartedAt && globalDeadlineMs
        ? new Date(Math.min(Date.parse(participantQuestionStartedAt) + GAME_QUESTION_DURATION_MS, globalDeadlineMs)).toISOString()
        : null
      : currentQuestionIndex === null
      ? null
      : getGameQuestionDeadline(game, currentQuestionIndex),
    status: getGameStatus(game, nowMs),
  };
}

export async function createScheduledGame(input: {
  actorIdentifier: string;
  actorLabel?: string | null;
  createdBy: string | null;
  participantGroupId?: string;
  participantGroupIds?: string[];
  poolId: string;
  title?: string | null;
}) {
  return withSerializedGameMutation((state) => {
    const actorIdentifier = normalizeParticipantIdentifier(input.actorIdentifier);
    const pool = ensureActorOwnsPool(state, input.poolId, input.createdBy, actorIdentifier);
    const groupIds = dedupe(input.participantGroupIds?.length ? input.participantGroupIds : input.participantGroupId ? [input.participantGroupId] : []);
    const groups = groupIds.map((id) => state.participantGroups.find((entry) => entry.id === id));
    const group = groups[0];

    if (!actorIdentifier) {
      throw new Error("A signed-in identifier is required to create a game.");
    }

    if (!group || groups.some((entry) => !entry || !isGroupOwnedBy(entry, actorIdentifier))) {
      throw new Error("Choose groups you manage.");
    }
    const title = input.title?.trim() || "Rapid test";
    if (title.length > 30) throw new Error("Rapid test titles must be 30 characters or fewer.");

    const participantMap = getParticipantMap(state);
    const groupParticipants = groups.flatMap((entry) => entry!.participantIds).flatMap((participantId) => {
      const participant = participantMap.get(participantId);
      return participant ? [participant] : [];
    });
    const uniqueGroupIdentifiers = dedupeParticipantIdentifiers(
      groupParticipants.map((participant) => normalizeParticipantIdentifier(participant.identifier)),
    );

    if (uniqueGroupIdentifiers.length < 4) {
      throw new Error("Rapid tests require at least 4 unique current members across the selected groups.");
    }

    const availableQuestionIds = dedupe(pool.questionIds).filter((questionId) =>
      state.questions.some((question) => question.id === questionId),
    );

    if (availableQuestionIds.length < GAME_QUESTION_COUNT) {
      throw new Error(`Games require a question pool with at least ${GAME_QUESTION_COUNT} questions.`);
    }

    const timestamp = new Date().toISOString();
    const selectedQuestionIds = selectQuestionIdsForScheduledTest(
      availableQuestionIds,
      GAME_QUESTION_COUNT,
      `${actorIdentifier}:${timestamp}:game`,
    );
    const selectedQuestions = selectedQuestionIds.flatMap((questionId) => {
      const question = state.questions.find((entry) => entry.id === questionId);
      return question ? [question] : [];
    });
    const presentedQuestions = createPresentedQuestions(
      selectedQuestions,
      `${actorIdentifier}:${timestamp}:game-options`,
    ).map((entry) => ({
      correctOptionIndex: entry.correctOptionIndex,
      id: entry.question.id,
      options: entry.displayOptions,
      originalOptionIndexes: entry.originalOptionIndexes,
      prompt: entry.question.prompt,
    }));
    const participants = uniqueGroupIdentifiers.map((identifier) => {
      const participant = groupParticipants.find((entry) =>
        identifiersMatch(entry.identifier, identifier),
      );

      return {
        acceptedAt: null,
        identifier,
        label: participant?.label?.trim() || participant?.identifier || identifier,
      };
    });

    if (!participants.some((participant) => identifiersMatch(participant.identifier, actorIdentifier))) {
      participants.push({
        acceptedAt: null,
        identifier: actorIdentifier,
        label: input.actorLabel?.trim() || input.actorIdentifier,
      });
    }

    const game: ScheduledGame = {
      answers: [],
      completedAt: null,
      countdownStartedAt: null,
      createdAt: timestamp,
      createdBy: input.createdBy,
      creatorRole: null,
      creatorIdentifier: actorIdentifier,
      id: createEntityId("game"),
      participantGroupId: group.id,
      participantGroupIds: groupIds,
      participants,
      poolId: pool.id,
      presentedQuestions,
      questionPreparedAt: [],
      questionReadyParticipantIdentifiers: [],
      questionStartedAt: [],
      questionIds: presentedQuestions.map((question) => question.id),
      rulesVersion: 4,
      startedAt: null,
      title,
      updatedAt: timestamp,
    };

    state.games = [game, ...state.games];
    return hydrateGame(game);
  });
}

function gameNeedsLifecycleWrite(state: TestingWorkspaceState, game: ScheduledGame, now: Date) {
  if (game.completedAt) return false;
  if (game.rulesVersion === 4) {
    if (!game.countdownStartedAt) {
      const groups = state.participantGroups.filter((group) =>
        (game.participantGroupIds ?? [game.participantGroupId]).includes(group.id)
        && isGroupOwnedBy(group, game.creatorIdentifier));
      const memberIds = new Set(groups.flatMap((group) => group.participantIds));
      const profiles = state.participants.filter((profile) => memberIds.has(profile.id));
      const identifiers = dedupeParticipantIdentifiers([...profiles.map((profile) => profile.identifier), game.creatorIdentifier]);
      return identifiers.length !== game.participants.length
        || identifiers.some((id) => !findGameParticipant(game, id));
    }
    const nowMs = now.getTime();
    const launch = Date.parse(game.countdownStartedAt) + GAME_LAUNCH_COUNTDOWN_MS;
    if (nowMs < launch) return false;
    if (!game.startedAt) return true;
    const globalDeadline = getRapidGameDeadline(game)!;
    if (nowMs >= globalDeadline) return true;
    const participants = game.participants.filter((participant) => participant.acceptedAt);
    for (const participant of participants) {
      for (let index = 0; index < GAME_QUESTION_COUNT; index += 1) {
        const start = participant.questionStartedAt?.[index];
        const deadline = start ? Math.min(Date.parse(start) + GAME_QUESTION_DURATION_MS, globalDeadline) : globalDeadline;
        if (nowMs >= deadline && !game.answers.some((answer) =>
          answer.questionIndex === index && identifiersMatch(answer.participantIdentifier, participant.identifier))) {
          return true;
        }
      }
    }
    const allResolved = participants.length > 0 && participants.every((participant) =>
      game.answers.filter((answer) => identifiersMatch(answer.participantIdentifier, participant.identifier)).length === GAME_QUESTION_COUNT);
    return allResolved;
  }
  return true;
}

export async function listGamesForParticipant(participantIdentifier: string) {
  const normalizedIdentifier = normalizeParticipantIdentifier(participantIdentifier);
  const snapshot = await readStoreSnapshot();
  const now = new Date();
  const relevantGames = snapshot.games.filter((game) => findGameParticipant(game, normalizedIdentifier));
  if (!relevantGames.some((game) => gameNeedsLifecycleWrite(snapshot, game, now))) {
    return relevantGames.map((game) => hydrateGame(game, now.getTime(), normalizedIdentifier));
  }

  return withSerializedGameMutation((state) => {
    const mutationNow = new Date();

    for (const game of state.games) {
      if (!findGameParticipant(game, normalizedIdentifier)) continue;
      refreshRapidInvitations(state, game);
      advanceGameLifecycle(game, mutationNow);
    }

    return state.games
      .filter((game) => findGameParticipant(game, normalizedIdentifier))
      .map((game) => hydrateGame(game, mutationNow.getTime(), normalizedIdentifier));
  });
}

export async function reconcileExpiredGames() {
  const snapshot = await readStoreSnapshot();
  const checkNow = new Date();
  if (!snapshot.games.some((game) => game.rulesVersion === 4 && !game.completedAt && gameNeedsLifecycleWrite(snapshot, game, checkNow))) {
    return false;
  }
  return withSerializedGameMutation((state) => {
    const now = new Date();
    let changed = false;
    for (const game of state.games) {
      if (game.rulesVersion !== 4 || game.completedAt) continue;
      const previous = JSON.stringify(game);
      advanceGameLifecycle(game, now);
      changed ||= previous !== JSON.stringify(game);
    }
    return changed;
  });
}

export async function getGameForParticipant(gameId: string, participantIdentifier: string) {
  const normalizedIdentifier = normalizeParticipantIdentifier(participantIdentifier);
  const snapshot = await readStoreSnapshot();
  const targetGame = snapshot.games.find((entry) => entry.id === gameId);
  if (!targetGame || !findGameParticipant(targetGame, normalizedIdentifier)) {
    const needsRefresh = targetGame && !targetGame.countdownStartedAt && targetGame.rulesVersion === 4;
    if (!needsRefresh) return null;
  }
  const now = new Date();
  if (targetGame && findGameParticipant(targetGame, normalizedIdentifier) && !gameNeedsLifecycleWrite(snapshot, targetGame, now)) {
    return hydrateGame(targetGame, now.getTime(), normalizedIdentifier);
  }
  return withSerializedGameMutation((state) => {
    const game = state.games.find((entry) => entry.id === gameId);
    if (!game) return null;
    const mutationNow = new Date();
    refreshRapidInvitations(state, game);
    advanceGameLifecycle(game, mutationNow);
    if (!findGameParticipant(game, normalizedIdentifier)) return null;
    return hydrateGame(game, mutationNow.getTime(), normalizedIdentifier);
  });
}

export async function recordGameQuestionReady(input: {
  gameId: string;
  participantIdentifier: string;
  questionIndex: number;
}) {
  return withSerializedGameMutation((state) => {
    const game = state.games.find((entry) => entry.id === input.gameId);

    if (!game || (game.rulesVersion !== 3 && game.rulesVersion !== 4)) {
      throw new Error("Game readiness is unavailable.");
    }

    const participant = findGameParticipant(game, input.participantIdentifier);
    if (!participant?.acceptedAt) {
      throw new Error("Only accepted participants can mark a question ready.");
    }

    advanceGameLifecycle(game, new Date());
    if (game.rulesVersion === 4) {
      const nowMs = Date.now();
      const starts = participant.questionStartedAt ?? (participant.questionStartedAt = []);
      if (starts[input.questionIndex]) return hydrateGame(game, nowMs, participant.identifier);
      const index = getRapidParticipantQuestionIndex(game, participant, nowMs);
      if (!Number.isInteger(input.questionIndex) || index === null || index !== input.questionIndex) {
        if (Number.isInteger(input.questionIndex) && input.questionIndex >= 0 && index !== null && input.questionIndex < index) {
          return hydrateGame(game, nowMs, participant.identifier);
        }
        throw new Error("This question is not available.");
      }
      starts[index] = new Date(nowMs).toISOString();
      game.updatedAt = starts[index];
      return hydrateGame(game, nowMs, participant.identifier);
    }
    const presentedQuestionIndex = getGamePresentedQuestionIndex(game);
    if (presentedQuestionIndex === null || presentedQuestionIndex !== input.questionIndex) {
      return hydrateGame(game);
    }

    const readyByQuestion = game.questionReadyParticipantIdentifiers
      ?? (game.questionReadyParticipantIdentifiers = []);
    const readyIdentifiers = readyByQuestion[input.questionIndex]
      ?? (readyByQuestion[input.questionIndex] = []);
    if (!readyIdentifiers.some((identifier) => identifiersMatch(identifier, participant.identifier))) {
      readyIdentifiers.push(participant.identifier);
      game.updatedAt = new Date().toISOString();
    }

    advanceGameLifecycle(game, new Date());
    return hydrateGame(game);
  });
}

export async function acceptGame(gameId: string, participantIdentifier: string, participantName: string) {
  return withSerializedGameMutation((state) => {
    const game = state.games.find((entry) => entry.id === gameId);

    if (!game) {
      throw new Error("Game not found.");
    }

    refreshRapidInvitations(state, game);
    const participant = findGameParticipant(game, participantIdentifier);

    if (!participant) {
      throw new Error("You are not invited to this game.");
    }

    if (identifiersMatch(game.creatorIdentifier, participantIdentifier)) {
      throw new Error("Choose Join Game or Watch Game in the waiting room.");
    }

    if (game.countdownStartedAt || game.startedAt) {
      throw new Error("This game has already started.");
    }

    if (!participant.acceptedAt) {
      const normalizedParticipantName = participantName.trim();

      if (!normalizedParticipantName) {
        throw new Error("Enter your name before accepting the game.");
      }
      if (game.rulesVersion === 4 && normalizedParticipantName.length > 80) throw new Error("Names must be 80 characters or fewer.");

      participant.label = normalizedParticipantName;
      participant.acceptedAt = new Date().toISOString();
      game.updatedAt = participant.acceptedAt;
    }

    return hydrateGame(game);
  });
}

export async function setGameCreatorRole(
  gameId: string,
  creatorIdentifier: string,
  role: GameCreatorRole,
  participantName?: string,
) {
  return withSerializedGameMutation((state) => {
    const game = state.games.find((entry) => entry.id === gameId);

    if (!game) {
      throw new Error("Game not found.");
    }

    if (!identifiersMatch(game.creatorIdentifier, creatorIdentifier)) {
      throw new Error("Only the game creator can choose this role.");
    }

    if (game.countdownStartedAt || game.startedAt) {
      throw new Error("The creator role cannot change after the game starts.");
    }

    const participant = findGameParticipant(game, creatorIdentifier);

    if (!participant) {
      throw new Error("Game creator is not available in this game.");
    }

    const timestamp = new Date().toISOString();
    if (role === "participant" && !participant.acceptedAt) {
      const normalizedParticipantName = participantName?.trim() ?? "";

      if (!normalizedParticipantName) {
        throw new Error("Enter your name before joining the game.");
      }
      if (game.rulesVersion === 4 && normalizedParticipantName.length > 80) throw new Error("Names must be 80 characters or fewer.");

      participant.label = normalizedParticipantName;
    }

    game.creatorRole = role;
    participant.acceptedAt = role === "participant" ? (participant.acceptedAt ?? timestamp) : null;
    game.updatedAt = timestamp;
    return hydrateGame(game);
  });
}

export async function startGame(gameId: string, creatorIdentifier: string) {
  return withSerializedGameMutation((state) => {
    const game = state.games.find((entry) => entry.id === gameId);

    if (!game) {
      throw new Error("Game not found.");
    }

    if (!identifiersMatch(game.creatorIdentifier, creatorIdentifier)) {
      throw new Error("Only the game creator can start this game.");
    }

    if (!game.creatorRole) {
      throw new Error("Choose Join Game or Watch Game before starting.");
    }

    refreshRapidInvitations(state, game);
    if (game.rulesVersion === 4 && !game.countdownStartedAt) {
      const groups = state.participantGroups.filter((group) =>
        (game.participantGroupIds ?? [game.participantGroupId]).includes(group.id)
        && isGroupOwnedBy(group, game.creatorIdentifier));
      const ids = new Set(groups.flatMap((group) => group.participantIds));
      if (dedupeParticipantIdentifiers(state.participants.filter((participant) => ids.has(participant.id))
        .map((participant) => participant.identifier)).length < 4) {
        throw new Error("At least 4 unique current group members are required.");
      }
    }
    if (getAcceptedGameParticipants(game).length < 4) {
      throw new Error("At least 4 participants must accept before the game can start.");
    }

    if (!game.countdownStartedAt && !game.startedAt) {
      game.countdownStartedAt = new Date().toISOString();
      game.updatedAt = game.countdownStartedAt;
    }

    return hydrateGame(game);
  });
}

export async function recordGameAnswer(input: {
  elapsedMs?: number;
  gameId: string;
  optionIndex: number;
  participantIdentifier: string;
  questionIndex: number;
}) {
  return withSerializedGameMutation((state) => {
    const now = new Date();
    const game = state.games.find((entry) => entry.id === input.gameId);

    if (!game) {
      throw new Error("Game not found.");
    }

    advanceGameLifecycle(game, now);
    const participant = findGameParticipant(game, input.participantIdentifier);

    if (!participant?.acceptedAt) {
      throw new Error("Accept the game invitation before playing.");
    }

    if (game.rulesVersion === 4) {
      const duplicate = game.answers.find((answer) => answer.questionIndex === input.questionIndex
        && identifiersMatch(answer.participantIdentifier, participant.identifier));
      if (duplicate) {
        if (duplicate.optionIndex !== input.optionIndex) throw new Error("This question is already resolved.");
        return { answer: duplicate, game: hydrateGame(game, now.getTime(), participant.identifier) };
      }
      const index = getRapidParticipantQuestionIndex(game, participant, now.getTime());
      const start = participant.questionStartedAt?.[input.questionIndex];
      if (index === null || index !== input.questionIndex || !start) throw new Error("This question is no longer accepting answers.");
      const serverElapsed = now.getTime() - Date.parse(start);
      const elapsedMs = input.elapsedMs ?? serverElapsed;
      if (!Number.isFinite(elapsedMs) || elapsedMs < 0 || elapsedMs > serverElapsed
        || elapsedMs >= GAME_QUESTION_DURATION_MS) throw new Error("Invalid answer timing. Refresh and retry.");
      const question = game.presentedQuestions?.[index];
      if (!question || !Number.isInteger(input.optionIndex) || input.optionIndex < 0 || input.optionIndex >= question.options.length) {
        throw new Error("Choose a valid answer.");
      }
      const answer = {
        answeredAt: now.toISOString(), elapsedMs, kind: "submitted" as const,
        isCorrect: input.optionIndex === question.correctOptionIndex, optionIndex: input.optionIndex,
        participantIdentifier: participant.identifier, points: GAME_INCORRECT_POINTS, questionIndex: index,
        responsePosition: null as number | null,
      };
      game.answers.push(answer);
      reconcileRapidGame(game, now.getTime());
      const nextIndex = getRapidParticipantQuestionIndex(game, participant, now.getTime());
      if (nextIndex !== null) {
        const starts = participant.questionStartedAt ?? (participant.questionStartedAt = []);
        if (!starts[nextIndex]) {
          starts[nextIndex] = now.toISOString();
          game.updatedAt = starts[nextIndex];
        }
      }
      return { answer, game: hydrateGame(game, now.getTime(), participant.identifier) };
    }

    const currentQuestionIndex = getGameQuestionIndex(game, now.getTime());

    if (currentQuestionIndex === null || currentQuestionIndex !== input.questionIndex) {
      throw new Error("This question is no longer accepting answers.");
    }

    if (game.answers.some((answer) =>
      answer.questionIndex === currentQuestionIndex
      && identifiersMatch(answer.participantIdentifier, participant.identifier),
    )) {
      throw new Error("You already answered this question.");
    }

    const questionId = game.questionIds[currentQuestionIndex];
    const question = game.presentedQuestions?.[currentQuestionIndex]
      ?? state.questions.find((entry) => entry.id === questionId);

    if (!question || input.optionIndex < 0 || input.optionIndex >= question.options.length) {
      throw new Error("Choose a valid answer.");
    }

    const isCorrect = input.optionIndex === question.correctOptionIndex;
    const correctPosition = isCorrect
      ? game.answers.filter((answer) => answer.questionIndex === currentQuestionIndex && answer.isCorrect).length
      : null;
    const answer = {
      answeredAt: now.toISOString(),
      isCorrect,
      kind: "submitted" as const,
      optionIndex: input.optionIndex,
      participantIdentifier: participant.identifier,
      points: getGameQuestionPoints(correctPosition),
      questionIndex: currentQuestionIndex,
      responsePosition: game.answers.filter((candidate) =>
        candidate.questionIndex === currentQuestionIndex && candidate.kind !== "timeout",
      ).length + 1,
    };

    game.answers.push(answer);
    game.updatedAt = answer.answeredAt;
    advanceGameLifecycle(game, now);

    return { answer, game: hydrateGame(game, now.getTime()) };
  });
}

export async function getOverallGamePoints(participantIdentifier: string) {
  const snapshot = await readStoreSnapshot();
  const nowMs = Date.now();
  return snapshot.games
    .filter((game) => findGameParticipant(game, participantIdentifier) && getGameStatus(game, nowMs) === "completed")
    .reduce((total, game) => {
      const entry = buildGameLeaderboard(game).find((candidate) =>
        identifiersMatch(candidate.participantIdentifier, participantIdentifier),
      );
      return total + (entry?.points ?? 0);
    }, 0);
}

export async function getGameRouteMetadata(game: ScheduledGame, viewerIdentifier: string) {
  const snapshot = await readStoreSnapshot();
  const nowMs = Date.now();
  const overallGamePoints = snapshot.games
    .filter((entry) => findGameParticipant(entry, viewerIdentifier) && getGameStatus(entry, nowMs) === "completed")
    .reduce((total, entry) => {
      const row = buildGameLeaderboard(entry).find((candidate) =>
        identifiersMatch(candidate.participantIdentifier, viewerIdentifier),
      );
      return total + (row?.points ?? 0);
    }, 0);
  const poolName = snapshot.pools.find((pool) => pool.id === game.poolId)?.name ?? "Unknown pool";
  const groupName = (game.participantGroupIds ?? [game.participantGroupId]).map((id) =>
    snapshot.participantGroups.find((group) => group.id === id)?.name ?? "Unknown group").join(", ");
  const creatorProfile = snapshot.participants.find((profile) =>
    identifiersMatch(profile.identifier, game.creatorIdentifier),
  );
  const fallbackQuestions = new Map(
    game.questionIds.flatMap((id) => {
      const q = snapshot.questions.find((entry) => entry.id === id);
      return q ? [[id, q] as const] : [];
    }),
  );
  return {
    creatorProfileLabel: creatorProfile?.label?.trim() || null,
    fallbackQuestions,
    groupName,
    overallGamePoints,
    poolName,
  };
}

export async function getGamePayloadForViewer(gameId: string, viewerIdentifier: string) {
  const game = await getGameForParticipant(gameId, viewerIdentifier);
  if (!game) return null;
  const metadata = await getGameRouteMetadata(game, viewerIdentifier);
  const overallGamePoints = metadata.overallGamePoints;
  const currentQuestionIndex = game.currentQuestionIndex;
  const question = currentQuestionIndex === null
    ? null
    : game.presentedQuestions?.[currentQuestionIndex]
      ?? metadata.fallbackQuestions.get(game.questionIds[currentQuestionIndex]);
  const participant = game.participants.find((entry) =>
    identifiersMatch(entry.identifier, viewerIdentifier),
  );
  const ownAnswers = game.answers.filter((answer) =>
    identifiersMatch(answer.participantIdentifier, viewerIdentifier),
  );
  const isAccepted = Boolean(participant?.acceptedAt);
  const isCreator = identifiersMatch(game.creatorIdentifier, viewerIdentifier);
  const isMissed = game.status === "completed"
    && !isAccepted
    && !(isCreator && game.creatorRole === "spectator");
  const reviewQuestions = game.status === "completed"
    ? game.questionIds.map((questionId, questionIndex) => {
      const reviewQuestion = game.presentedQuestions?.[questionIndex]
        ?? metadata.fallbackQuestions.get(questionId);
        const answer = ownAnswers.find((entry) => entry.questionIndex === questionIndex) ?? null;

        return reviewQuestion
          ? {
              answer,
              correctOptionIndex: reviewQuestion.correctOptionIndex,
              id: reviewQuestion.id,
              options: reviewQuestion.options,
              prompt: reviewQuestion.prompt,
              questionIndex,
            }
          : null;
      }).filter((entry) => entry !== null)
    : [];
  const acceptedParticipants = game.participants
    .filter((entry) => entry.acceptedAt)
    .sort((left, right) => new Date(left.acceptedAt as string).getTime() - new Date(right.acceptedAt as string).getTime());
  const poolName = metadata.poolName;
  const groupName = metadata.groupName;
  const creatorParticipant = game.participants.find((entry) =>
    identifiersMatch(entry.identifier, game.creatorIdentifier),
  );
  const rapid = game.rulesVersion === 4;
  const completed = game.status === "completed";
  const standings = game.leaderboard.map((entry) => {
    const responses = game.answers.filter((answer) => identifiersMatch(answer.participantIdentifier, entry.participantIdentifier));
    return {
      ...entry,
      isSelf: identifiersMatch(entry.participantIdentifier, viewerIdentifier),
      maskedIdentifier: /^\+?[\d\s()-]+$/.test(entry.participantIdentifier)
        ? `••••••${entry.participantIdentifier.replace(/\D/g, "").slice(-4)}` : "",
      correctCount: responses.filter((answer) => answer.isCorrect).length,
      incorrectUnansweredCount: responses.filter((answer) => !answer.isCorrect).length,
      elapsedMs: responses.reduce((total, answer) => total + (answer.elapsedMs ?? 0), 0),
    };
  });

  return {
    acceptedCount: game.acceptedCount,
    canStart: isCreator && Boolean(game.creatorRole) && game.acceptedCount >= 4,
    countdownDeadline: game.countdownDeadline,
    creatorRole: game.creatorRole ?? null,
    currentQuestion: question && (!rapid || isAccepted)
      ? { id: question.id, options: question.options, prompt: question.prompt }
      : null,
    currentQuestionIndex: game.currentQuestionIndex,
    displayName: participant?.label ?? viewerIdentifier,
    globalDeadline: game.globalDeadline,
    questionStartedAt: game.participantQuestionStartedAt,
    rulesVersion: game.rulesVersion,
    isAccepted,
    isCreator,
    isMissed,
    leaderboard: rapid
      ? standings.filter((entry, index) => isCreator || index < 10 || entry.isSelf)
      : game.leaderboard,
    overallGamePoints,
    ownAnswers: rapid && !completed ? ownAnswers.map((answer) => ({
      answeredAt: answer.answeredAt, kind: answer.kind, optionIndex: answer.optionIndex,
      participantIdentifier: answer.participantIdentifier, questionIndex: answer.questionIndex,
    })) : ownAnswers,
    participantCount: game.participants.length,
    participants: acceptedParticipants.map((entry) => ({
      acceptedAt: entry.acceptedAt,
      identifier: entry.identifier,
      label: entry.label,
    })),
    preparationDeadline: game.preparationDeadline,
    questionDeadline: game.questionDeadline,
    resultMetadata: {
      creatorName: metadata.creatorProfileLabel
        || creatorParticipant?.label?.trim()
        || game.creatorIdentifier,
      groupName,
      poolName,
      startedAt: game.startedAt,
      completedAt: game.completedAt,
      durationMinutes: 10,
      submittedCount: acceptedParticipants.filter((entry) =>
        game.answers.filter((answer) => identifiersMatch(answer.participantIdentifier, entry.identifier)).length === GAME_QUESTION_COUNT).length,
      sharedCount: game.participants.filter((entry) =>
        !identifiersMatch(entry.identifier, game.creatorIdentifier) || game.creatorRole === "participant").length,
    },
    recentDeltas: rapid ? [] : game.answers.slice(-6).map((answer) => ({
      answeredAt: answer.answeredAt,
      participantIdentifier: answer.participantIdentifier,
      points: answer.points,
    })),
    reviewQuestions,
    rules: {
      correctPoints: GAME_CORRECT_POINTS,
      incorrectPoints: GAME_INCORRECT_POINTS,
      launchCountdownMs: game.rulesVersion === 2 || game.rulesVersion === 3 || rapid ? GAME_LAUNCH_COUNTDOWN_MS : 0,
      questionCount: GAME_QUESTION_COUNT,
      questionDurationMs: getGameQuestionDurationMs(game),
    },
    status: game.status,
    title: game.title,
    viewerMode: isAccepted ? "participant" : "spectator",
  };
}

function resolveBrandingActorKey(state: TestingWorkspaceState, actorKey?: string | null) {
  const normalized = normalizeBrandingActorKey(actorKey);
  if (!normalized) return null;
  return Object.keys(state.workspaceBrandingByActor).find((key) => identifiersMatch(key, normalized))
    ?? Object.keys(state.workspaceAppointmentShareCodesByActor).find((key) => identifiersMatch(key, normalized))
    ?? normalized;
}