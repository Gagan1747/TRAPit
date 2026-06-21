export const MIN_OPTION_COUNT = 4;
export const MAX_OPTION_COUNT = 5;

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

export type WorkspaceBranding = {
  imageDataUrl: string | null;
  instituteName: string;
};

export type ScheduledPoll = {
  anonymous: boolean;
  branding?: WorkspaceBranding | null;
  createdAt: string;
  createdBy: string | null;
  creatorDisplayName?: string | null;
  creatorIdentifier?: string | null;
  endsAt: string;
  id: string;
  participantGroupIds: string[];
  participantType: PollParticipantType;
  questionIds: string[];
  shareCode: string | null;
  startsAt: string;
  status: ScheduledTestStatus;
  title: string;
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
  participantId: string;
  participantName?: string;
  rank: number;
  totalCount: number;
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
  workspaceBranding: WorkspaceBranding | null;
  workspaceBrandingByActor: Record<string, WorkspaceBranding>;
};

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
  const imageDataUrl = branding.imageDataUrl?.trim() ?? null;

  if (!instituteName && !imageDataUrl) {
    return null;
  }

  return {
    imageDataUrl,
    instituteName,
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

export function compareTestResults(
  left: Pick<TestResult, "attemptedCount" | "correctCount" | "elapsedMs" | "incorrectCount">,
  right: Pick<TestResult, "attemptedCount" | "correctCount" | "elapsedMs" | "incorrectCount">,
) {
  if (left.correctCount !== right.correctCount) {
    return right.correctCount - left.correctCount;
  }

  const leftIncorrectCount = getIncorrectCount(left);
  const rightIncorrectCount = getIncorrectCount(right);

  if (leftIncorrectCount !== rightIncorrectCount) {
    return leftIncorrectCount - rightIncorrectCount;
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
        participantId: attempt.userId,
        participantName: attempt.participantName,
        rank,
        totalCount: attempt.result.totalCount,
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