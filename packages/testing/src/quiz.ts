export const MIN_OPTION_COUNT = 4;
export const MAX_OPTION_COUNT = 5;
export const GAME_QUESTION_COUNT = 20;
export const LEGACY_GAME_QUESTION_DURATION_MS = 15_000;
export const GAME_QUESTION_DURATION_MS = 30_000;
export const GAME_LAUNCH_COUNTDOWN_MS = 60_000;
export const GAME_CORRECT_POINTS = [50, 30, 10, 5, 5] as const;
export const GAME_INCORRECT_POINTS = -5;

function getParticipantIdentifierCandidates(value: string) {
  const normalized = value.trim().toLowerCase();
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

export function participantIdentifiersMatch(left: string, right: string) {
  const leftCandidates = getParticipantIdentifierCandidates(left);

  return Array.from(getParticipantIdentifierCandidates(right)).some((candidate) =>
    leftCandidates.has(candidate),
  );
}

export function dedupeParticipantIdentifiers(identifiers: string[]) {
  return identifiers.reduce<string[]>((uniqueIdentifiers, identifier) => {
    const normalizedIdentifier = identifier.trim();

    if (
      normalizedIdentifier
      && !uniqueIdentifiers.some((candidate) =>
        participantIdentifiersMatch(candidate, normalizedIdentifier),
      )
    ) {
      uniqueIdentifiers.push(normalizedIdentifier);
    }

    return uniqueIdentifiers;
  }, []);
}

export type ObjectiveQuestion = {
  correctOptionIndex: number;
  id: string;
  options: string[];
  prompt: string;
};

export type QuestionDraft = {
  correctOptionIndex: number;
  options: string[];
  prompt: string;
};

export type TestResult = {
  attemptedCount: number;
  assignedParticipantCount?: number;
  correctCount: number;
  elapsedMs: number;
  incorrectCount: number;
  rank?: number;
  rankedParticipantCount?: number;
  totalCount: number;
};

export type QuestionImportSource = "manual" | "ocr-import" | "sample";

export type PersistentQuestion = ObjectiveQuestion & {
  createdAt: string;
  createdBy: string | null;
  poolIds: string[];
  source: QuestionImportSource;
  updatedAt: string;
};

export type QuestionPool = {
  createdAt: string;
  createdBy: string | null;
  description: string;
  id: string;
  name: string;
  questionIds: string[];
  sharedWithIdentifiers: string[];
  updatedAt: string;
};

export type PollQuestionDraft = {
  options: string[];
  prompt: string;
  topic: string;
};

export type PersistentPollQuestion = PollQuestionDraft & {
  createdAt: string;
  createdBy: string | null;
  id: string;
  updatedAt: string;
};

export type PollParticipantType = "open" | "registered";

export type PollResponseMode =
  | "groups-named"
  | "groups-anonymous"
  | "open-registered-anonymous"
  | "open-unregistered-anonymous";

export type PollRecurrenceFrequency = "weekly" | "biweekly" | "monthly";

export type PollRecurrenceCycle = {
  cycleIndex: number;
  endsAt: string;
  startsAt: string;
};

export type AppointmentLocation = {
  address: string;
  id: string;
  name: string;
  workingHours: string;
  workingHoursSecondWindow: string;
  workingDays: string;
};

export type WorkspaceBranding = {
  address: string;
  advanceBookingWeeks: number | null;
  appointmentDateOverrides?: {
    closedDateKeys: string[];
    openedDateKeys: string[];
  };
  appointmentShareCode: string | null;
  appointmentLocations?: AppointmentLocation[];
  appointmentNotesPrompt: string;
  appointmentsPerSlot: number | null;
  breakHours: string;
  imageDataUrl: string | null;
  instituteName: string;
  justAddToList: boolean;
  profileImageDataUrl: string | null;
  promotionalImageDataUrls?: string[];
  recurringBookingLimit?: number | null;
  recurringBookingsEnabled?: boolean;
  showRemainingBookings: boolean;
  slotDurationMinutes: number | null;
  workingHoursSecondWindow: string;
  workingDays: string;
  workingHours: string;
};

export type ScheduledPoll = {
  anonymous: boolean;
  branding?: WorkspaceBranding | null;
  createdAt: string;
  createdBy: string | null;
  creatorDisplayName?: string | null;
  creatorIdentifier?: string | null;
  endsAt: string;
  groupNames?: string[];
  hasSubmitted?: boolean;
  id: string;
  openPollRequiresRegistration?: boolean;
  participantGroupIds: string[];
  participantType: PollParticipantType;
  questionIds: string[];
  recurrenceCycleCount?: number | null;
  recurrenceCycleIndex?: number | null;
  recurrenceFrequency?: PollRecurrenceFrequency | null;
  responseMode?: PollResponseMode;
  seriesId?: string | null;
  shareCode: string | null;
  startsAt: string;
  status: ScheduledTestStatus;
  title: string;
  totalResponses?: number;
  updatedAt: string;
};

export type PollAttempt = {
  answers: Record<string, number | undefined>;
  completedAt: string;
  id: string;
  participantName?: string;
  pollId: string;
  startedAt: string;
  userId: string;
};

export type ParticipantProfile = {
  createdAt: string;
  id: string;
  identifier: string;
  label: string;
  updatedAt: string;
};

export type ParticipantGroup = {
  createdAt: string;
  description: string;
  id: string;
  inviteJoinMode: ParticipantGroupInviteJoinMode;
  name: string;
  ownerIdentifier: string | null;
  participantIds: string[];
  shareCode: string | null;
  updatedAt: string;
};

export type ParticipantGroupInviteJoinMode = "approval-required" | "automatic";

export type GroupJoinRequestStatus = "pending" | "accepted" | "rejected";

export type GroupJoinRequestType = "admin-invite" | "user-request";

export type GroupJoinRequest = {
  adminGroupId: string;
  adminIdentifier: string;
  adminGroupName: string;
  adminLabel: string;
  id: string;
  requestedAt: string;
  requesterId: string;
  requesterLabel: string;
  resolvedAt: string | null;
  status: GroupJoinRequestStatus;
  requestType: GroupJoinRequestType;
};

export type ScheduledTestStatus = "scheduled" | "live" | "completed";

export type ScheduledTestInviteJoinMode = "approval-required" | "automatic";

export type ScheduledTest = {
  branding?: WorkspaceBranding | null;
  createdAt: string;
  createdBy: string | null;
  creatorDisplayName?: string | null;
  creatorIdentifier?: string | null;
  durationMinutes: number;
  id: string;
  inviteJoinMode: ScheduledTestInviteJoinMode;
  participantGroupIds: string[];
  participantIds: string[];
  poolId: string;
  questionIds: string[];
  questionCount: number;
  resolvedParticipantIdentifiers: string[];
  shareCode: string | null;
  startsAt: string;
  status: ScheduledTestStatus;
  title: string;
  updatedAt: string;
};

export type ScheduledGameStatus = "upcoming" | "countdown" | "ongoing" | "completed";

export type GameCreatorRole = "participant" | "spectator";

export type GameAnswerKind = "submitted" | "timeout";

export type GameParticipant = {
  acceptedAt: string | null;
  identifier: string;
  label: string;
};

export type GameAnswer = {
  answeredAt: string;
  kind?: GameAnswerKind;
  isCorrect: boolean;
  optionIndex: number | null;
  participantIdentifier: string;
  points: number;
  questionIndex: number;
  responsePosition?: number | null;
};

export type GamePresentedQuestion = {
  correctOptionIndex: number;
  id: string;
  options: string[];
  originalOptionIndexes: number[];
  prompt: string;
};

export type ScheduledGame = {
  answers: GameAnswer[];
  completedAt: string | null;
  countdownStartedAt?: string | null;
  createdAt: string;
  createdBy: string | null;
  creatorRole?: GameCreatorRole | null;
  creatorIdentifier: string;
  id: string;
  participantGroupId: string;
  participants: GameParticipant[];
  poolId: string;
  presentedQuestions?: GamePresentedQuestion[];
  questionStartedAt?: string[];
  questionIds: string[];
  rulesVersion?: 1 | 2;
  startedAt: string | null;
  title: string;
  updatedAt: string;
};

export type GameLeaderboardEntry = {
  participantIdentifier: string;
  participantLabel: string;
  points: number;
  rank: number;
};

export type TestAttempt = {
  answers: Record<string, number | undefined>;
  completedAt: string;
  id: string;
  participantName?: string;
  result: TestResult;
  startedAt: string;
  testId: string;
  userId: string;
};

export type TestQuestionReport = {
  createdAt: string;
  id: string;
  questionId: string;
  reason: string;
  reporterIdentifier: string;
  reporterLabel: string | null;
  resolvedAt: string | null;
  status: "open" | "resolved";
  testId: string;
};

export type TestHistoryEntry = {
  attemptId: string;
  completedAt: string;
  correctCount: number;
  elapsedMs: number;
  incorrectCount: number;
  participantId: string;
  participantName?: string;
  rank?: number;
  status: "missed" | "submitted";
  testId: string;
  testTitle: string;
  totalCount: number;
};

export type TestLeaderboardEntry = {
  attemptId: string;
  completedAt: string;
  correctCount: number;
  elapsedMs: number;
  incorrectCount: number;
  marks: number;
  participantId: string;
  participantName?: string;
  rank: number;
  totalCount: number;
  unansweredCount: number;
};

export type TestLeaderboard = {
  assignedParticipantCount: number;
  endsAt: string;
  entries: TestLeaderboardEntry[];
  startsAt: string;
  submittedCount: number;
  testId: string;
  testTitle: string;
};

export type TestingWorkspaceState = {
  attempts: TestAttempt[];
  games: ScheduledGame[];
  groupJoinRequests: GroupJoinRequest[];
  pollAttempts: PollAttempt[];
  participantGroups: ParticipantGroup[];
  participants: ParticipantProfile[];
  pollQuestions: PersistentPollQuestion[];
  pools: QuestionPool[];
  questions: PersistentQuestion[];
  questionReports: TestQuestionReport[];
  scheduledPolls: ScheduledPoll[];
  scheduledTests: ScheduledTest[];
  workspaceAppointmentShareCodesByActor: Record<string, string>;
  workspaceBranding: WorkspaceBranding | null;
  workspaceBrandingByActor: Record<string, WorkspaceBranding>;
};

export function getGameQuestionPoints(correctPosition: number | null) {
  if (correctPosition === null) {
    return GAME_INCORRECT_POINTS;
  }

  return GAME_CORRECT_POINTS[correctPosition] ?? 0;
}

export function getGameQuestionDurationMs(game: Pick<ScheduledGame, "rulesVersion">) {
  return game.rulesVersion === 2
    ? GAME_QUESTION_DURATION_MS
    : LEGACY_GAME_QUESTION_DURATION_MS;
}

export function getNextGameQuestionStartedAt(
  transitionAtMs: number,
  observedAtMs: number,
) {
  return new Date(Math.max(transitionAtMs, observedAtMs)).toISOString();
}

export function getGameStatus(
  game: Pick<ScheduledGame, "completedAt" | "countdownStartedAt" | "questionStartedAt" | "rulesVersion" | "startedAt">,
  nowMs = Date.now(),
): ScheduledGameStatus {
  if (game.completedAt) {
    return "completed";
  }

  if (game.rulesVersion === 2 && game.countdownStartedAt && !game.startedAt) {
    return "countdown";
  }

  if (!game.startedAt) {
    return "upcoming";
  }

  if (game.rulesVersion === 2) {
    const finalQuestionStartedAt = game.questionStartedAt?.[GAME_QUESTION_COUNT - 1];
    return finalQuestionStartedAt
      && nowMs >= new Date(finalQuestionStartedAt).getTime() + GAME_QUESTION_DURATION_MS
      ? "completed"
      : "ongoing";
  }

  const endsAt = new Date(game.startedAt).getTime()
    + GAME_QUESTION_COUNT * getGameQuestionDurationMs(game);

  return nowMs >= endsAt ? "completed" : "ongoing";
}

export function getGameQuestionIndex(
  game: Pick<ScheduledGame, "completedAt" | "countdownStartedAt" | "questionStartedAt" | "rulesVersion" | "startedAt">,
  nowMs = Date.now(),
) {
  if (!game.startedAt || getGameStatus(game, nowMs) !== "ongoing") {
    return null;
  }

  if (game.rulesVersion === 2) {
    const questionStartedAt = game.questionStartedAt ?? [];

    for (let index = Math.min(questionStartedAt.length, GAME_QUESTION_COUNT) - 1; index >= 0; index -= 1) {
      if (new Date(questionStartedAt[index]).getTime() <= nowMs) {
        return index;
      }
    }

    return null;
  }

  return Math.min(
    GAME_QUESTION_COUNT - 1,
    Math.floor((nowMs - new Date(game.startedAt).getTime()) / getGameQuestionDurationMs(game)),
  );
}

export function getGameQuestionDeadline(
  game: Pick<ScheduledGame, "completedAt" | "countdownStartedAt" | "questionStartedAt" | "rulesVersion" | "startedAt">,
  questionIndex: number,
) {
  if (game.rulesVersion === 2) {
    const questionStartedAt = game.questionStartedAt?.[questionIndex];
    return questionStartedAt
      ? new Date(new Date(questionStartedAt).getTime() + GAME_QUESTION_DURATION_MS).toISOString()
      : null;
  }

  return game.startedAt
    ? new Date(
        new Date(game.startedAt).getTime()
        + (questionIndex + 1) * getGameQuestionDurationMs(game),
      ).toISOString()
    : null;
}

export function buildGameLeaderboard(
  game: Pick<ScheduledGame, "answers" | "participants">,
): GameLeaderboardEntry[] {
  const pointsByParticipant = new Map<string, number>();

  for (const answer of game.answers) {
    pointsByParticipant.set(
      answer.participantIdentifier,
      (pointsByParticipant.get(answer.participantIdentifier) ?? 0) + answer.points,
    );
  }

  return game.participants
    .filter((participant) => participant.acceptedAt)
    .map((participant) => ({
      participantIdentifier: participant.identifier,
      participantLabel: participant.label,
      points: pointsByParticipant.get(participant.identifier) ?? 0,
      rank: 0,
    }))
    .sort((left, right) =>
      right.points - left.points
      || left.participantLabel.localeCompare(right.participantLabel),
    )
    .map((entry, index, entries) => ({
      ...entry,
      rank: index > 0 && entries[index - 1].points === entry.points
        ? entries[index - 1].rank
        : index + 1,
    }));
}

export type ImportIssue = {
  code:
    | "answer"
    | "format"
    | "options"
    | "prompt"
    | "validation";
  message: string;
};

export type ImportCandidate = {
  draft: QuestionDraft;
  id: string;
  issues: ImportIssue[];
  rawText: string;
  valid: boolean;
};

export type BulkImportPreview = {
  candidates: ImportCandidate[];
  invalidCount: number;
  totalCount: number;
  validCount: number;
};

export type PollImportCandidate = {
  draft: PollQuestionDraft;
  id: string;
  issues: ImportIssue[];
  rawText: string;
  valid: boolean;
};

export type PollBulkImportPreview = {
  candidates: PollImportCandidate[];
  invalidCount: number;
  totalCount: number;
  validCount: number;
};

export const sampleQuestions: ObjectiveQuestion[] = [
  {
    correctOptionIndex: 1,
    id: "sample-1",
    options: [
      "HyperText Transfer Protocol",
      "HyperText Markup Language",
      "High Transfer Machine Language",
      "Home Tool Markup Language",
    ],
    prompt: "What does HTML stand for?",
  },
  {
    correctOptionIndex: 2,
    id: "sample-2",
    options: [
      "A database migration file",
      "A CSS reset sheet",
      "A function that returns a new array from an existing array",
      "A React component lifecycle hook",
    ],
    prompt: "In JavaScript, what does the `map` method do?",
  },
];

export function createQuestionId() {
  return `question-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createPollQuestionId() {
  return `poll-question-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createEntityId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function hashSeed(input: string) {
  let hash = 0;

  for (let index = 0; index < input.length; index += 1) {
    hash = (hash * 31 + input.charCodeAt(index)) >>> 0;
  }

  return hash;
}

function createSeededRandom(seedInput: string) {
  let seed = hashSeed(seedInput) || 1;

  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0x100000000;
  };
}

function shuffleWithRandom<T>(items: T[], random: () => number) {
  const nextItems = [...items];

  for (let currentIndex = nextItems.length - 1; currentIndex > 0; currentIndex -= 1) {
    const swapIndex = Math.floor(random() * (currentIndex + 1));
    const nextItem = nextItems[currentIndex];
    nextItems[currentIndex] = nextItems[swapIndex];
    nextItems[swapIndex] = nextItem;
  }

  return nextItems;
}

export function shuffleWithSeed<T>(items: T[], seedInput: string) {
  return shuffleWithRandom(items, createSeededRandom(seedInput));
}

function isTailLockedOption(option: string) {
  return /^(all\s+of\s+the\s+above|both\s+[a-e]\s+and\s+[a-e])\b/i.test(option.trim());
}

export type PresentedQuestion = {
  correctOptionIndex: number;
  displayOptions: string[];
  originalOptionIndexes: number[];
  question: ObjectiveQuestion;
};

export function selectQuestionIdsForScheduledTest(
  questionIds: string[],
  questionCount: number,
  seedInput: string,
) {
  if (questionCount >= questionIds.length) {
    return shuffleWithRandom(questionIds, createSeededRandom(seedInput));
  }

  const random = createSeededRandom(seedInput);
  const selectedQuestionIds = Array.from({ length: questionCount }, (_, bucketIndex) => {
    const startIndex = Math.floor((bucketIndex * questionIds.length) / questionCount);
    const endIndex = Math.floor(((bucketIndex + 1) * questionIds.length) / questionCount);
    const segment = questionIds.slice(startIndex, Math.max(startIndex + 1, endIndex));

    return segment[Math.floor(random() * segment.length)];
  });

  return shuffleWithRandom(selectedQuestionIds, random);
}

export function createPresentedQuestions(
  questions: ObjectiveQuestion[],
  seedInput: string,
): PresentedQuestion[] {
  const random = createSeededRandom(seedInput);
  const correctAnswerUsage = new Map<number, number>();
  const orderedQuestions = shuffleWithSeed(questions, `${seedInput}:question-order`);

  return orderedQuestions.map((question) => {
    const fixedTailIndexes = question.options
      .map((option, optionIndex) => ({ option, optionIndex }))
      .filter(({ option }) => isTailLockedOption(option))
      .map(({ optionIndex }) => optionIndex);
    const movableIndexes = question.options
      .map((_, optionIndex) => optionIndex)
      .filter((optionIndex) => !fixedTailIndexes.includes(optionIndex));
    const correctOptionIsTailLocked = fixedTailIndexes.includes(question.correctOptionIndex);
    const tailIndexes = [...fixedTailIndexes];
    let frontIndexes: number[];
    let correctOptionIndex: number;

    if (correctOptionIsTailLocked) {
      frontIndexes = shuffleWithRandom(movableIndexes, random);
      correctOptionIndex = frontIndexes.length + tailIndexes.indexOf(question.correctOptionIndex);
    } else {
      const movableIndexesWithoutCorrect = movableIndexes.filter(
        (optionIndex) => optionIndex !== question.correctOptionIndex,
      );
      const shuffledOtherIndexes = shuffleWithRandom(movableIndexesWithoutCorrect, random);
      const candidatePositions = movableIndexes.map((_, position) => position);
      const lowestUsage = Math.min(
        ...candidatePositions.map((position) => correctAnswerUsage.get(position) ?? 0),
      );
      const leastUsedPositions = candidatePositions.filter(
        (position) => (correctAnswerUsage.get(position) ?? 0) === lowestUsage,
      );
      const targetPosition =
        leastUsedPositions[Math.floor(random() * leastUsedPositions.length)] ?? 0;

      frontIndexes = [];

      for (const position of candidatePositions) {
        if (position === targetPosition) {
          frontIndexes.push(question.correctOptionIndex);
          continue;
        }

        const nextOptionIndex = shuffledOtherIndexes.shift();

        if (typeof nextOptionIndex === "number") {
          frontIndexes.push(nextOptionIndex);
        }
      }

      correctOptionIndex = targetPosition;
    }

    correctAnswerUsage.set(correctOptionIndex, (correctAnswerUsage.get(correctOptionIndex) ?? 0) + 1);

    const originalOptionIndexes = [...frontIndexes, ...tailIndexes];

    return {
      correctOptionIndex,
      displayOptions: originalOptionIndexes.map((optionIndex) => question.options[optionIndex]),
      originalOptionIndexes,
      question,
    } satisfies PresentedQuestion;
  });
}

export function createQuestionFromDraft(draft: QuestionDraft): ObjectiveQuestion {
  const normalized = normalizeDraft(draft);

  return {
    correctOptionIndex: normalized.correctOptionIndex,
    id: createQuestionId(),
    options: normalized.options,
    prompt: normalized.prompt,
  };
}

export function createPersistentQuestion(
  draft: QuestionDraft,
  config?: {
    createdBy?: string | null;
    poolIds?: string[];
    source?: QuestionImportSource;
  },
): PersistentQuestion {
  const baseQuestion = createQuestionFromDraft(draft);
  const timestamp = new Date().toISOString();

  return {
    ...baseQuestion,
    createdAt: timestamp,
    createdBy: config?.createdBy ?? null,
    poolIds: config?.poolIds ?? [],
    source: config?.source ?? "manual",
    updatedAt: timestamp,
  };
}

export function normalizePollQuestionDraft(draft: PollQuestionDraft): PollQuestionDraft {
  return {
    options: draft.options.map((option) => option.trim()),
    prompt: draft.prompt.trim(),
    topic: draft.topic.trim(),
  };
}

export function validatePollQuestionDraft(draft: PollQuestionDraft): string | null {
  const normalized = normalizePollQuestionDraft(draft);

  if (!normalized.prompt) {
    return "Poll question text is required.";
  }

  if (normalized.options.length < 2) {
    return "Poll questions must include at least 2 options.";
  }

  if (normalized.options.some((option) => !option)) {
    return "Each poll option must be filled in.";
  }

  return null;
}

export function createPersistentPollQuestion(
  draft: PollQuestionDraft,
  config?: {
    createdBy?: string | null;
  },
): PersistentPollQuestion {
  const normalized = normalizePollQuestionDraft(draft);
  const timestamp = new Date().toISOString();

  return {
    createdAt: timestamp,
    createdBy: config?.createdBy ?? null,
    id: createPollQuestionId(),
    options: normalized.options,
    prompt: normalized.prompt,
    topic: normalized.topic,
    updatedAt: timestamp,
  };
}

export function normalizeWorkspaceBranding(
  branding: WorkspaceBranding | null | undefined,
): WorkspaceBranding | null {
  if (!branding) {
    return null;
  }

  const instituteName = branding.instituteName?.trim() ?? "";
  const address = branding.address?.trim() ?? "";
  const imageDataUrl = branding.imageDataUrl?.trim() ?? null;
  const profileImageDataUrl = branding.profileImageDataUrl?.trim() ?? null;
  const promotionalImageDataUrls = (branding.promotionalImageDataUrls ?? [])
    .map((value) => value.trim())
    .filter(Boolean)
    .slice(0, 4);
  const advanceBookingWeeks = [1, 2, 3, 4].includes(branding.advanceBookingWeeks ?? 0)
    ? branding.advanceBookingWeeks
    : null;
  const appointmentShareCode = branding.appointmentShareCode?.trim() || null;
  const validDateKey = /^\d{4}-\d{2}-\d{2}$/;
  const closedDateKeys = Array.from(new Set(
    (branding.appointmentDateOverrides?.closedDateKeys ?? []).map((value) => value.trim()).filter((value) => validDateKey.test(value)),
  ));
  const openedDateKeys = Array.from(new Set(
    (branding.appointmentDateOverrides?.openedDateKeys ?? [])
      .map((value) => value.trim())
      .filter((value) => validDateKey.test(value) && !closedDateKeys.includes(value)),
  ));
  const appointmentNotesPrompt = branding.appointmentNotesPrompt?.trim() || "Share a brief about appointment purpose";
  const breakHours = branding.breakHours?.trim() ?? "";
  const justAddToList = branding.justAddToList === true;
  const recurringBookingsEnabled = branding.recurringBookingsEnabled === true;
  const recurringBookingLimit = recurringBookingsEnabled
    && Number.isInteger(branding.recurringBookingLimit)
    && (branding.recurringBookingLimit ?? 0) >= 1
    && (branding.recurringBookingLimit ?? 0) <= 12
    ? branding.recurringBookingLimit ?? 6
    : recurringBookingsEnabled
      ? 6
      : null;
  const workingDays = branding.workingDays?.trim() ?? "";
  const workingHours = branding.workingHours?.trim() ?? "";
  const workingHoursSecondWindow = branding.workingHoursSecondWindow?.trim() ?? "";
  const appointmentLocations = (branding.appointmentLocations?.length
    ? branding.appointmentLocations
    : address || workingDays || workingHours || workingHoursSecondWindow
      ? [{
        address,
        id: "location-1",
        name: "Location 1",
        workingDays,
        workingHours,
        workingHoursSecondWindow,
      }]
      : [])
    .slice(0, 2)
    .map((location, index) => ({
      address: location.address?.trim() ?? "",
      id: location.id?.trim() || `location-${index + 1}`,
      name: location.name?.trim() || `Location ${index + 1}`,
      workingDays: location.workingDays?.trim() ?? "",
      workingHours: location.workingHours?.trim() ?? "",
      workingHoursSecondWindow: location.workingHoursSecondWindow?.trim() ?? "",
    }));
  const primaryLocation = appointmentLocations[0];
  const showRemainingBookings = branding.showRemainingBookings === true;
  const appointmentsPerSlot = Number.isFinite(branding.appointmentsPerSlot) && branding.appointmentsPerSlot && branding.appointmentsPerSlot > 0
    ? Math.floor(branding.appointmentsPerSlot)
    : null;
  const slotDurationMinutes = [5, 10, 15, 30, 45, 60, 120, 180, 240].includes(branding.slotDurationMinutes ?? 0)
    ? branding.slotDurationMinutes
    : null;

  if (!instituteName && !address && !imageDataUrl && !profileImageDataUrl && !promotionalImageDataUrls.length && !breakHours && !workingDays && !workingHours && !workingHoursSecondWindow && !appointmentLocations.length && advanceBookingWeeks === null && appointmentsPerSlot === null && slotDurationMinutes === null && !justAddToList && !recurringBookingsEnabled) {
    return null;
  }

  return {
    address: primaryLocation?.address ?? address,
    advanceBookingWeeks,
		appointmentDateOverrides: { closedDateKeys, openedDateKeys },
		appointmentLocations,
    appointmentShareCode,
    appointmentNotesPrompt,
    appointmentsPerSlot,
    breakHours,
    imageDataUrl,
    instituteName,
    justAddToList,
    profileImageDataUrl,
    promotionalImageDataUrls,
    recurringBookingLimit,
    recurringBookingsEnabled,
    showRemainingBookings,
    slotDurationMinutes,
    workingHoursSecondWindow: primaryLocation?.workingHoursSecondWindow ?? workingHoursSecondWindow,
    workingDays: primaryLocation?.workingDays ?? workingDays,
    workingHours: primaryLocation?.workingHours ?? workingHours,
  };
}

export function resolveScheduledPollStatus(
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

function addPollRecurrencePeriod(value: Date, frequency: PollRecurrenceFrequency) {
  const next = new Date(value);

  if (frequency === "weekly" || frequency === "biweekly") {
    next.setUTCDate(next.getUTCDate() + (frequency === "weekly" ? 7 : 14));
    return next;
  }

  const originalDay = next.getUTCDate();
  next.setUTCDate(1);
  next.setUTCMonth(next.getUTCMonth() + 1);
  const finalDayOfMonth = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate();
  next.setUTCDate(Math.min(originalDay, finalDayOfMonth));
  return next;
}

export function buildPollRecurrenceCycles(input: {
  cycleCount: number;
  frequency: PollRecurrenceFrequency;
  startsAt: string;
}): PollRecurrenceCycle[] {
  const firstStart = new Date(input.startsAt);

  if (Number.isNaN(firstStart.getTime())) {
    throw new Error("Choose a valid poll start date and time.");
  }

  if (!Number.isInteger(input.cycleCount) || input.cycleCount < 1) {
    throw new Error("Recurring polls require at least one cycle.");
  }

  const cycles: PollRecurrenceCycle[] = [];
  let cycleStart = firstStart;

  for (let cycleIndex = 0; cycleIndex < input.cycleCount; cycleIndex += 1) {
    const cycleEnd = addPollRecurrencePeriod(cycleStart, input.frequency);
    cycles.push({
      cycleIndex,
      endsAt: cycleEnd.toISOString(),
      startsAt: cycleStart.toISOString(),
    });
    cycleStart = cycleEnd;
  }

  return cycles;
}

export function findActivePollRecurrenceCycle(
  cycles: PollRecurrenceCycle[],
  nowMs = Date.now(),
) {
  return cycles.find((cycle) => {
    const startsAtMs = new Date(cycle.startsAt).getTime();
    const endsAtMs = new Date(cycle.endsAt).getTime();
    return startsAtMs <= nowMs && nowMs < endsAtMs;
  }) ?? null;
}

export function countPendingPollRecurrenceCycles(
  cycles: PollRecurrenceCycle[],
  nowMs = Date.now(),
) {
  return cycles.filter((cycle) => new Date(cycle.startsAt).getTime() > nowMs).length;
}

export function createParticipantProfile(input: {
  identifier: string;
  label?: string;
}): ParticipantProfile {
  const timestamp = new Date().toISOString();
  const identifier = input.identifier.trim();

  return {
    createdAt: timestamp,
    id: createEntityId("participant"),
    identifier,
    label: input.label?.trim() || identifier,
    updatedAt: timestamp,
  };
}

export function createParticipantGroup(input: {
  description?: string;
  inviteJoinMode?: ParticipantGroupInviteJoinMode;
  name: string;
  ownerIdentifier?: string | null;
  participantIds: string[];
  shareCode?: string | null;
}): ParticipantGroup {
  const timestamp = new Date().toISOString();

  return {
    createdAt: timestamp,
    description: input.description?.trim() ?? "",
    id: createEntityId("group"),
    inviteJoinMode: input.inviteJoinMode ?? "approval-required",
    name: input.name.trim(),
    ownerIdentifier: input.ownerIdentifier?.trim() || null,
    participantIds: Array.from(new Set(input.participantIds)),
    shareCode: input.shareCode?.trim() || null,
    updatedAt: timestamp,
  };
}

export function createGroupJoinRequest(input: {
  adminGroupId: string;
  adminIdentifier: string;
  adminGroupName: string;
  adminLabel: string;
  requestType?: GroupJoinRequestType;
  requesterId: string;
  requesterLabel: string;
}): GroupJoinRequest {
  return {
    adminGroupId: input.adminGroupId,
    adminIdentifier: input.adminIdentifier.trim(),
    adminGroupName: input.adminGroupName.trim(),
    adminLabel: input.adminLabel.trim(),
    id: createEntityId("group-request"),
    requestedAt: new Date().toISOString(),
    requestType: input.requestType ?? "user-request",
    requesterId: input.requesterId.trim(),
    requesterLabel: input.requesterLabel.trim(),
    resolvedAt: null,
    status: "pending",
  };
}

export function resolveScheduledTestStatus(
  test: Pick<ScheduledTest, "durationMinutes" | "resolvedParticipantIdentifiers" | "startsAt">,
  attempts: Array<Pick<TestAttempt, "testId" | "userId">>,
  testId: string,
): ScheduledTestStatus {
  const startsAtMs = new Date(test.startsAt).getTime();
  const endsAtMs = startsAtMs + test.durationMinutes * 60 * 1000;

  if (startsAtMs > Date.now()) {
    return "scheduled";
  }

  if (Date.now() >= endsAtMs) {
    return "completed";
  }

  return "live";
}

export function getScheduledTestEndTime(
  test: Pick<ScheduledTest, "durationMinutes" | "startsAt">,
) {
  return new Date(
    new Date(test.startsAt).getTime() + test.durationMinutes * 60 * 1000,
  ).toISOString();
}

export function normalizeDraft(draft: QuestionDraft): QuestionDraft {
  return {
    correctOptionIndex: draft.correctOptionIndex,
    options: draft.options.map((option) => option.trim()),
    prompt: draft.prompt.trim(),
  };
}

export function validateQuestionDraft(draft: QuestionDraft): string | null {
  const normalized = normalizeDraft(draft);

  if (!normalized.prompt) {
    return "Question text is required.";
  }

  if (
    normalized.options.length < MIN_OPTION_COUNT ||
    normalized.options.length > MAX_OPTION_COUNT
  ) {
    return "Questions must have 4 or 5 options.";
  }

  if (normalized.options.some((option) => !option)) {
    return "Each option must be filled in.";
  }

  if (
    normalized.correctOptionIndex < 0 ||
    normalized.correctOptionIndex >= normalized.options.length
  ) {
    return "Select the correct answer.";
  }

  return null;
}

export function scoreObjectiveTest(
  questions: ObjectiveQuestion[],
  answers: Record<string, number | undefined>,
  startedAt: number,
  completedAt: number,
): TestResult {
  const attemptedCount = questions.filter(
    (question) => typeof answers[question.id] === "number",
  ).length;
  const correctCount = questions.filter(
    (question) => answers[question.id] === question.correctOptionIndex,
  ).length;

  return {
    attemptedCount,
    correctCount,
    elapsedMs: Math.max(0, completedAt - startedAt),
    incorrectCount: Math.max(0, attemptedCount - correctCount),
    totalCount: questions.length,
  };
}

export function getIncorrectCount(
  result: Pick<TestResult, "attemptedCount" | "correctCount" | "incorrectCount">,
) {
  return typeof result.incorrectCount === "number"
    ? result.incorrectCount
    : Math.max(0, result.attemptedCount - result.correctCount);
}

export function getUnansweredCount(
  result: Pick<TestResult, "attemptedCount" | "totalCount">,
) {
  return Math.max(0, result.totalCount - result.attemptedCount);
}

export function getTestMarks(
  result: Pick<TestResult, "attemptedCount" | "correctCount" | "incorrectCount" | "totalCount">,
) {
  return (result.correctCount * 4) - getIncorrectCount(result) - getUnansweredCount(result);
}

export function compareTestResults(
  left: Pick<TestResult, "attemptedCount" | "correctCount" | "elapsedMs" | "incorrectCount" | "totalCount">,
  right: Pick<TestResult, "attemptedCount" | "correctCount" | "elapsedMs" | "incorrectCount" | "totalCount">,
) {
  const leftMarks = getTestMarks(left);
  const rightMarks = getTestMarks(right);

  if (leftMarks !== rightMarks) {
    return rightMarks - leftMarks;
  }

  const leftPenaltyCount = getIncorrectCount(left) + getUnansweredCount(left);
  const rightPenaltyCount = getIncorrectCount(right) + getUnansweredCount(right);

  if (leftPenaltyCount !== rightPenaltyCount) {
    return leftPenaltyCount - rightPenaltyCount;
  }

  if (left.elapsedMs !== right.elapsedMs) {
    return left.elapsedMs - right.elapsedMs;
  }

  return 0;
}

export function buildTestLeaderboards(
  attempts: TestAttempt[],
  tests: ScheduledTest[] = [],
): TestLeaderboard[] {
  return tests.map((test) => {
    const sortedAttempts = attempts
      .filter((attempt) => attempt.testId === test.id)
      .sort((left, right) => {
        const resultComparison = compareTestResults(left.result, right.result);

        if (resultComparison !== 0) {
          return resultComparison;
        }

        return new Date(left.completedAt).getTime() - new Date(right.completedAt).getTime();
      });

    const entries: TestLeaderboardEntry[] = [];

    for (const [index, attempt] of sortedAttempts.entries()) {
      const previousEntry = entries[index - 1];
      const previousAttempt = sortedAttempts[index - 1];
      const rank =
        index === 0
          ? 1
          : previousAttempt && compareTestResults(attempt.result, previousAttempt.result) === 0
            ? previousEntry.rank
            : index + 1;

      entries.push({
        attemptId: attempt.id,
        completedAt: attempt.completedAt,
        correctCount: attempt.result.correctCount,
        elapsedMs: attempt.result.elapsedMs,
        incorrectCount: getIncorrectCount(attempt.result),
        marks: getTestMarks(attempt.result),
        participantId: attempt.userId,
        participantName: attempt.participantName,
        rank,
        totalCount: attempt.result.totalCount,
        unansweredCount: getUnansweredCount(attempt.result),
      });
    }

    return {
      assignedParticipantCount: test.resolvedParticipantIdentifiers.length,
      endsAt: getScheduledTestEndTime(test),
      entries,
      startsAt: test.startsAt,
      submittedCount: entries.length,
      testId: test.id,
      testTitle: test.title,
    } satisfies TestLeaderboard;
  });
}

export function formatElapsedTime(elapsedMs: number) {
  const totalSeconds = Math.max(0, Math.round(elapsedMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${minutes}m ${seconds.toString().padStart(2, "0")}s`;
}

export function createEmptyTestingWorkspaceState(): TestingWorkspaceState {
  return {
    attempts: [],
    games: [],
    groupJoinRequests: [],
    pollAttempts: [],
    participantGroups: [],
    participants: [],
    pollQuestions: [],
    pools: [],
    questions: [],
    questionReports: [],
    scheduledPolls: [],
    scheduledTests: [],
    workspaceAppointmentShareCodesByActor: {},
    workspaceBranding: null,
    workspaceBrandingByActor: {},
  };
}

function createEmptyDraft(): QuestionDraft {
  return {
    correctOptionIndex: -1,
    options: [],
    prompt: "",
  };
}

function resolveAnswerIndex(answerToken: string, options: string[]) {
  const normalizedAnswer = answerToken.trim();

  if (!normalizedAnswer) {
    return -1;
  }

  const letterMatch = normalizedAnswer.match(/^([A-E])$/i);

  if (letterMatch) {
    return letterMatch[1].toUpperCase().charCodeAt(0) - 65;
  }

  const numericMatch = normalizedAnswer.match(/^([1-5])$/);

  if (numericMatch) {
    return Number(numericMatch[1]) - 1;
  }

  return options.findIndex(
    (option) => option.trim().toLowerCase() === normalizedAnswer.toLowerCase(),
  );
}

function parseQuestionBlock(block: string, index: number): ImportCandidate {
  const lines = block
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const issues: ImportIssue[] = [];
  const optionEntries: Array<{ key: string; value: string }> = [];
  const promptParts: string[] = [];
  let answerToken = "";

  for (const line of lines) {
    if (/^(answer|correct answer)\s*[:\-]/i.test(line)) {
      answerToken = line.replace(/^(answer|correct answer)\s*[:\-]\s*/i, "");
      continue;
    }

    if (/^(question|q)\s*[:\-]/i.test(line)) {
      promptParts.push(line.replace(/^(question|q)\s*[:\-]\s*/i, ""));
      continue;
    }

    const optionMatch = line.match(/^(?:option\s*)?([A-E1-5])[\).:\-]\s*(.+)$/i);

    if (optionMatch) {
      optionEntries.push({
        key: optionMatch[1].toUpperCase(),
        value: optionMatch[2].trim(),
      });
      continue;
    }

    promptParts.push(line);
  }

  const orderedOptions = optionEntries
    .sort((left, right) => left.key.localeCompare(right.key))
    .map((entry) => entry.value);
  const draft: QuestionDraft = {
    correctOptionIndex: resolveAnswerIndex(answerToken, orderedOptions),
    options: orderedOptions,
    prompt: promptParts.join(" ").trim(),
  };

  if (!draft.prompt) {
    issues.push({
      code: "prompt",
      message: "Question text could not be detected.",
    });
  }

  if (!orderedOptions.length) {
    issues.push({
      code: "options",
      message: "No answer options were detected in this block.",
    });
  }

  if (!answerToken) {
    issues.push({
      code: "answer",
      message: "Correct answer marker is missing.",
    });
  }

  if (orderedOptions.length && draft.correctOptionIndex < 0) {
    issues.push({
      code: "answer",
      message: "Correct answer did not match any detected option.",
    });
  }

  const validationError = validateQuestionDraft(draft);

  if (validationError) {
    issues.push({
      code: "validation",
      message: validationError,
    });
  }

  if (!lines.length) {
    issues.push({
      code: "format",
      message: "This block is empty.",
    });
  }

  return {
    draft: lines.length ? draft : createEmptyDraft(),
    id: `import-${index + 1}`,
    issues,
    rawText: block,
    valid: issues.length === 0,
  };
}

function parsePollQuestionBlock(block: string, index: number): PollImportCandidate {
  const lines = block
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const promptLine = lines.find((line) => /^question\s*:/i.test(line))
    ?? lines.find((line) => !/^option\s*[a-z0-9]+\s*:/i.test(line) && !/^topic\s*:/i.test(line))
    ?? "";
  const topicLine = lines.find((line) => /^topic\s*:/i.test(line)) ?? "";
  const optionLines = lines.filter((line) => /^option\s*[a-z0-9]+\s*:/i.test(line));
  const prompt = promptLine.replace(/^question\s*:/i, "").trim();
  const topic = topicLine.replace(/^topic\s*:/i, "").trim();
  const draft: PollQuestionDraft = {
    options: optionLines
      .map((line) => line.replace(/^option\s*[a-z0-9]+\s*:/i, "").trim())
      .filter(Boolean),
    prompt,
    topic,
  };
  const issues: ImportIssue[] = [];

  if (!prompt) {
    issues.push({
      code: "prompt",
      message: "Question text is missing.",
    });
  }

  if (optionLines.length < 2) {
    issues.push({
      code: "options",
      message: "At least 2 option lines are required.",
    });
  }

  if (!lines.length) {
    issues.push({
      code: "format",
      message: "This block is empty.",
    });
  }

  const validationError = validatePollQuestionDraft(draft);

  if (validationError) {
    issues.push({
      code: "validation",
      message: validationError,
    });
  }

  return {
    draft: lines.length ? draft : { options: [], prompt: "", topic: "" },
    id: `poll-import-${index + 1}`,
    issues,
    rawText: block,
    valid: issues.length === 0,
  };
}

export function previewQuestionImport(text: string): BulkImportPreview {
  const blocks = text
    .replace(/\r\n/g, "\n")
    .split(/\n\s*\n+/)
    .map((block) => block.trim())
    .filter(Boolean);
  const candidates = blocks.map((block, index) => parseQuestionBlock(block, index));

  return {
    candidates,
    invalidCount: candidates.filter((candidate) => !candidate.valid).length,
    totalCount: candidates.length,
    validCount: candidates.filter((candidate) => candidate.valid).length,
  };
}

export function previewPollQuestionImport(text: string): PollBulkImportPreview {
  const blocks = text
    .replace(/\r\n/g, "\n")
    .split(/\n\s*\n+/)
    .map((block) => block.trim())
    .filter(Boolean);
  const candidates = blocks.map((block, index) => parsePollQuestionBlock(block, index));

  return {
    candidates,
    invalidCount: candidates.filter((candidate) => !candidate.valid).length,
    totalCount: candidates.length,
    validCount: candidates.filter((candidate) => candidate.valid).length,
  };
}

export function summarizeTestHistory(
  attempts: TestAttempt[],
  tests: ScheduledTest[] = [],
): TestHistoryEntry[] {
  const rankByAttemptId = new Map(
    buildTestLeaderboards(attempts, tests)
      .flatMap((leaderboard) => leaderboard.entries)
      .map((entry) => [entry.attemptId, entry.rank]),
  );

  return attempts.map((attempt) => ({
    attemptId: attempt.id,
    completedAt: attempt.completedAt,
    correctCount: attempt.result.correctCount,
    elapsedMs: attempt.result.elapsedMs,
    incorrectCount: getIncorrectCount(attempt.result),
    participantId: attempt.userId,
    participantName: attempt.participantName,
    rank: rankByAttemptId.get(attempt.id),
    status: "submitted",
    testId: attempt.testId,
    testTitle:
      tests.find((test) => test.id === attempt.testId)?.title ?? "Scheduled test",
    totalCount: attempt.result.totalCount,
  }));
}