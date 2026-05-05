import {
  buildTestLeaderboards,
  compareTestResults,
  createEmptyTestingWorkspaceState,
  createEntityId,
  createGroupJoinRequest,
  createParticipantGroup,
  createParticipantProfile,
  createPersistentPollQuestion,
  createPersistentQuestion,
  getIncorrectCount,
  getScheduledTestEndTime,
  resolveScheduledTestStatus,
  scoreObjectiveTest,
  selectQuestionIdsForScheduledTest,
  summarizeTestHistory,
  validatePollQuestionDraft,
  type GroupJoinRequest,
  type ObjectiveQuestion,
  type ParticipantGroup,
  type ParticipantProfile,
  type PersistentPollQuestion,
  type PersistentQuestion,
  type PollParticipantType,
  type PollQuestionDraft,
  type QuestionDraft,
  type QuestionPool,
  type ScheduledPoll,
  type ScheduledTest,
  type TestAttempt,
  type TestHistoryEntry,
  type TestLeaderboard,
  type TestingWorkspaceState,
  sampleQuestions,
} from "@trapit/testing";
import * as SecureStore from "expo-secure-store";
import { createContext, useContext, useEffect, useState } from "react";

const STORAGE_KEY = "trapit.mobile.testing-workspace";

type AvailableUserTest = {
  durationMinutes: number;
  hasAttempt: boolean;
  id: string;
  poolId: string;
  questionCount: number;
  questions: PersistentQuestion[];
  startsAt: string;
  status: ScheduledTest["status"];
  title: string;
  topPerformer?: {
    correctCount: number;
    elapsedMs: number;
    participantName: string;
  };
};

type CreateGroupInput = {
  description?: string;
  name: string;
  ownerIdentifier: string | null;
  participantIdentifiers?: string[];
};

type UpdateGroupInput = {
  description?: string;
  groupId: string;
  name: string;
  participantIdentifiers: string[];
};

type QuestionBankContextValue = {
  attempts: TestAttempt[];
  groupJoinRequests: GroupJoinRequest[];
  participantGroups: ParticipantGroup[];
  participants: ParticipantProfile[];
  pollQuestions: PersistentPollQuestion[];
  pools: QuestionPool[];
  questions: PersistentQuestion[];
  scheduledPolls: ScheduledPoll[];
  scheduledTests: ScheduledTest[];
  addQuestion: (draft: QuestionDraft, poolIds: string[], createdBy?: string | null) => void;
  clearQuestions: (actorId?: string | null) => void;
  createGroup: (input: CreateGroupInput) => ParticipantGroup | null;
  createPollQuestions: (drafts: PollQuestionDraft[], createdBy?: string | null) => PersistentPollQuestion[];
  createPool: (input: { createdBy?: string | null; description?: string; name: string }) => QuestionPool | null;
  createScheduledPoll: (input: {
    anonymous: boolean;
    createdBy: string | null;
    endsAt: string;
    generateQrCode: boolean;
    participantGroupIds: string[];
    participantType: PollParticipantType;
    questionIds: string[];
    startsAt: string;
    title: string;
  }) => ScheduledPoll;
  createScheduledTest: (input: {
    createdBy: string | null;
    durationMinutes: number;
    participantGroupIds: string[];
    participantIds: string[];
    poolId: string;
    questionCount: number;
    startsAt: string;
  }) => ScheduledTest;
  deleteGroup: (groupId: string) => void;
  getAvailablePollsForParticipant: (identifier: string) => ScheduledPoll[];
  getAvailableTestsForParticipant: (identifier: string) => AvailableUserTest[];
  getHydratedScheduledPolls: () => ScheduledPoll[];
  getHydratedScheduledTests: () => ScheduledTest[];
  getLeaderboardsForActor: (actorId?: string | null) => TestLeaderboard[];
  getSummaryForActor: (input?: { actorIdentifier?: string | null; actorSub?: string | null }) => {
    attempts: number;
    groups: number;
    participants: number;
    pools: number;
    questions: number;
    scheduledTests: number;
  };
  getUserHistory: (identifier: string) => TestHistoryEntry[];
  getUserTestReview: (testId: string, identifier: string) => {
    review: Array<{
      correctOptionIndex: number;
      options: string[];
      prompt: string;
      questionId: string;
      selectedOptionIndex?: number;
    }>;
    submittedAt: string | null;
    testId: string;
    testTitle: string;
  };
  isReady: boolean;
  loadSamples: (createdBy?: string | null) => void;
  recordAttempt: (input: {
    answers: Record<string, number | undefined>;
    completedAt: string;
    participantName?: string;
    startedAt: string;
    testId: string;
    userId: string;
  }) => TestAttempt;
  removeQuestion: (questionId: string) => void;
  requestGroupJoin: (input: {
    adminGroupId: string;
    requesterId: string;
    requesterLabel: string;
  }) => GroupJoinRequest;
  resolveGroupJoinRequest: (input: {
    decision: "accept" | "reject";
    requestId: string;
  }) => GroupJoinRequest;
  searchGroupsByAdminIdentifier: (identifier: string) => ParticipantGroup[];
  updateGroup: (input: UpdateGroupInput) => ParticipantGroup;
};

const QuestionBankContext = createContext<QuestionBankContextValue | null>(null);

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

function dedupe(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function createLocalPool(input: { createdBy?: string | null; description?: string; name: string }): QuestionPool {
  const timestamp = new Date().toISOString();

  return {
    createdAt: timestamp,
    createdBy: input.createdBy ?? null,
    description: input.description?.trim() ?? "",
    id: createEntityId("pool"),
    name: input.name.trim(),
    questionIds: [],
    updatedAt: timestamp,
  };
}

function migrateLegacyQuestions(questions: ObjectiveQuestion[]): TestingWorkspaceState {
  if (!questions.length) {
    return createEmptyTestingWorkspaceState();
  }

  const defaultPool = createLocalPool({
    description: "Imported from the existing mobile question bank.",
    name: "General pool",
  });
  const timestamp = new Date().toISOString();
  const nextQuestions: PersistentQuestion[] = questions.map((question) => ({
    ...question,
    createdAt: timestamp,
    createdBy: null,
    poolIds: [defaultPool.id],
    source: "manual",
    updatedAt: timestamp,
  }));

  return {
    ...createEmptyTestingWorkspaceState(),
    pools: [
      {
        ...defaultPool,
        questionIds: nextQuestions.map((question) => question.id),
      },
    ],
    questions: nextQuestions,
  };
}

function normalizeState(parsed: Partial<TestingWorkspaceState>): TestingWorkspaceState {
  return {
    attempts: parsed.attempts ?? [],
    groupJoinRequests: parsed.groupJoinRequests ?? [],
    participantGroups: parsed.participantGroups ?? [],
    participants: parsed.participants ?? [],
    pollAttempts: parsed.pollAttempts ?? [],
    pollQuestions: (parsed.pollQuestions ?? []).map((question) => ({
      ...question,
      topic: question.topic?.trim() ?? "",
    })),
    pools: parsed.pools ?? [],
    questions: parsed.questions ?? [],
    scheduledPolls: (parsed.scheduledPolls ?? []).map((poll) => {
      const legacyDurationValue = (poll as ScheduledPoll & { durationMinutes?: number }).durationMinutes;
      const legacyDurationMinutes = typeof legacyDurationValue === "number" ? legacyDurationValue : null;
      const startsAt = poll.startsAt;
      const endsAt = poll.endsAt
        ?? (legacyDurationMinutes !== null
          ? new Date(new Date(startsAt).getTime() + legacyDurationMinutes * 60 * 1000).toISOString()
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

function parseStoredWorkspace(value: string): TestingWorkspaceState {
  const parsed = JSON.parse(value) as Partial<TestingWorkspaceState> | QuestionPool[] | ObjectiveQuestion[];

  if (Array.isArray(parsed)) {
    return migrateLegacyQuestions(parsed as ObjectiveQuestion[]);
  }

  if (!("attempts" in parsed) && "questions" in parsed) {
    return {
      ...createEmptyTestingWorkspaceState(),
      pools: parsed.pools ?? [],
      questions: parsed.questions ?? [],
    };
  }

  return normalizeState(parsed);
}

function resolveScheduledPollStatus(poll: Pick<ScheduledPoll, "endsAt" | "startsAt">) {
  const startsAtMs = new Date(poll.startsAt).getTime();
  const endsAtMs = new Date(poll.endsAt).getTime();

  if (startsAtMs > Date.now()) {
    return "scheduled" as const;
  }

  if (Date.now() >= endsAtMs) {
    return "completed" as const;
  }

  return "live" as const;
}

export function QuestionBankProvider({ children }: { children: React.ReactNode }) {
  const [isReady, setIsReady] = useState(false);
  const [workspace, setWorkspace] = useState<TestingWorkspaceState>(createEmptyTestingWorkspaceState());

  useEffect(() => {
    let isMounted = true;

    void SecureStore.getItemAsync(STORAGE_KEY)
      .then((value) => {
        if (!isMounted || !value) {
          return;
        }

        setWorkspace(parseStoredWorkspace(value));
      })
      .finally(() => {
        if (isMounted) {
          setIsReady(true);
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (!isReady) {
      return;
    }

    void SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify(workspace));
  }, [isReady, workspace]);

  function updateWorkspace(updater: (currentWorkspace: TestingWorkspaceState) => TestingWorkspaceState) {
    setWorkspace((currentWorkspace) => updater(currentWorkspace));
  }

  function ensureParticipantProfile(
    currentWorkspace: TestingWorkspaceState,
    input: { identifier: string; label?: string },
  ) {
    const existingParticipant = currentWorkspace.participants.find((participant) =>
      identifiersMatch(participant.identifier, input.identifier),
    );

    if (existingParticipant) {
      return { participant: existingParticipant, workspace: currentWorkspace };
    }

    const participant = createParticipantProfile({
      identifier: input.identifier,
      label: input.label,
    });

    return {
      participant,
      workspace: {
        ...currentWorkspace,
        participants: [participant, ...currentWorkspace.participants],
      },
    };
  }

  function resolveParticipantIdentifiers(
    currentWorkspace: TestingWorkspaceState,
    participantIds: string[],
    participantGroupIds: string[],
  ) {
    const directIdentifiers = participantIds.map((participantId) => participantId.trim()).filter(Boolean);
    const groupIdentifiers = participantGroupIds.flatMap((groupId) => {
      const group = currentWorkspace.participantGroups.find((entry) => entry.id === groupId);

      if (!group) {
        return [];
      }

      return group.participantIds
        .map((participantId) =>
          currentWorkspace.participants.find((participant) => participant.id === participantId)?.identifier,
        )
        .filter((identifier): identifier is string => Boolean(identifier));
    });

    return dedupe([...directIdentifiers, ...groupIdentifiers]);
  }

  function getQuestionMap(currentWorkspace: TestingWorkspaceState) {
    return new Map(currentWorkspace.questions.map((question) => [question.id, question]));
  }

  function getHydratedScheduledTests() {
    return workspace.scheduledTests.map((scheduledTest) => ({
      ...scheduledTest,
      status: resolveScheduledTestStatus(scheduledTest, workspace.attempts, scheduledTest.id),
    }));
  }

  function getHydratedScheduledPolls() {
    return workspace.scheduledPolls.map((scheduledPoll) => ({
      ...scheduledPoll,
      status: resolveScheduledPollStatus(scheduledPoll),
    }));
  }

  function createPool(input: { createdBy?: string | null; description?: string; name: string }) {
    if (!input.name.trim()) {
      return null;
    }

    const nextPool = createLocalPool(input);

    updateWorkspace((currentWorkspace) => ({
      ...currentWorkspace,
      pools: [nextPool, ...currentWorkspace.pools],
    }));

    return nextPool;
  }

  function addQuestion(draft: QuestionDraft, poolIds: string[], createdBy: string | null = null) {
    const normalizedPoolIds = dedupe(poolIds);
    const nextQuestion = createPersistentQuestion(draft, { createdBy, poolIds: normalizedPoolIds });

    updateWorkspace((currentWorkspace) => ({
      ...currentWorkspace,
      questions: [nextQuestion, ...currentWorkspace.questions],
      pools: currentWorkspace.pools.map((pool) =>
        normalizedPoolIds.includes(pool.id)
          ? {
              ...pool,
              questionIds: [nextQuestion.id, ...pool.questionIds],
              updatedAt: new Date().toISOString(),
            }
          : pool,
      ),
    }));
  }

  function removeQuestion(questionId: string) {
    updateWorkspace((currentWorkspace) => ({
      ...currentWorkspace,
      questions: currentWorkspace.questions.filter((question) => question.id !== questionId),
      pools: currentWorkspace.pools.map((pool) => ({
        ...pool,
        questionIds: pool.questionIds.filter((currentQuestionId) => currentQuestionId !== questionId),
        updatedAt: new Date().toISOString(),
      })),
    }));
  }

  function clearQuestions(actorId: string | null = null) {
    updateWorkspace((currentWorkspace) => {
      const remainingQuestions = actorId
        ? currentWorkspace.questions.filter((question) => question.createdBy !== actorId)
        : [];
      const removedQuestionIds = new Set(
        currentWorkspace.questions
          .filter((question) => !actorId || question.createdBy === actorId)
          .map((question) => question.id),
      );

      return {
        ...currentWorkspace,
        questions: remainingQuestions,
        pools: currentWorkspace.pools.map((pool) => ({
          ...pool,
          questionIds: pool.questionIds.filter((questionId) => !removedQuestionIds.has(questionId)),
          updatedAt: new Date().toISOString(),
        })),
      };
    });
  }

  function loadSamples(createdBy: string | null = null) {
    const samplePool = createLocalPool({
      createdBy,
      description: "Sample questions for quick mobile testing.",
      name: "Sample pool",
    });
    const sampleBank = sampleQuestions.map((question) => ({
      ...createPersistentQuestion(question, {
        createdBy,
        poolIds: [samplePool.id],
        source: "sample",
      }),
      id: question.id,
    }));

    updateWorkspace((currentWorkspace) => ({
      ...currentWorkspace,
      pools: [
        {
          ...samplePool,
          questionIds: sampleBank.map((question) => question.id),
        },
        ...currentWorkspace.pools.filter((pool) => pool.id !== samplePool.id),
      ],
      questions: [...sampleBank, ...currentWorkspace.questions.filter((question) => !sampleBank.some((sample) => sample.id === question.id))],
    }));
  }

  function createGroup(input: CreateGroupInput) {
    if (!input.name.trim()) {
      return null;
    }

    let nextWorkspace = workspace;
    const participantIds: string[] = [];

    for (const participantIdentifier of dedupe(input.participantIdentifiers ?? [])) {
      const ensured = ensureParticipantProfile(nextWorkspace, {
        identifier: participantIdentifier,
        label: participantIdentifier,
      });
      nextWorkspace = ensured.workspace;
      participantIds.push(ensured.participant.id);
    }

    const nextGroup = createParticipantGroup({
      description: input.description,
      name: input.name,
      ownerIdentifier: input.ownerIdentifier,
      participantIds,
    });

    setWorkspace({
      ...nextWorkspace,
      participantGroups: [nextGroup, ...nextWorkspace.participantGroups],
    });

    return nextGroup;
  }

  function updateGroup(input: UpdateGroupInput) {
    const existingGroup = workspace.participantGroups.find((group) => group.id === input.groupId);

    if (!existingGroup) {
      throw new Error("Group not found.");
    }

    let nextWorkspace = workspace;
    const participantIds: string[] = [];

    for (const participantIdentifier of dedupe(input.participantIdentifiers)) {
      const ensured = ensureParticipantProfile(nextWorkspace, {
        identifier: participantIdentifier,
        label: participantIdentifier,
      });
      nextWorkspace = ensured.workspace;
      participantIds.push(ensured.participant.id);
    }

    const timestamp = new Date().toISOString();
    const nextGroup: ParticipantGroup = {
      ...existingGroup,
      description: input.description?.trim() ?? existingGroup.description,
      name: input.name.trim(),
      participantIds,
      updatedAt: timestamp,
    };

    setWorkspace({
      ...nextWorkspace,
      participantGroups: nextWorkspace.participantGroups.map((group) =>
        group.id === existingGroup.id ? nextGroup : group,
      ),
    });

    return nextGroup;
  }

  function deleteGroup(groupId: string) {
    updateWorkspace((currentWorkspace) => ({
      ...currentWorkspace,
      groupJoinRequests: currentWorkspace.groupJoinRequests.filter((request) => request.adminGroupId !== groupId),
      participantGroups: currentWorkspace.participantGroups.filter((group) => group.id !== groupId),
    }));
  }

  function searchGroupsByAdminIdentifier(identifier: string) {
    const normalizedIdentifier = normalizeParticipantIdentifier(identifier);

    return workspace.participantGroups.filter((group) =>
      group.ownerIdentifier ? identifiersMatch(group.ownerIdentifier, normalizedIdentifier) : false,
    );
  }

  function requestGroupJoin(input: {
    adminGroupId: string;
    requesterId: string;
    requesterLabel: string;
  }) {
    const group = workspace.participantGroups.find((entry) => entry.id === input.adminGroupId);

    if (!group || !group.ownerIdentifier) {
      throw new Error("Group not found.");
    }

    const existingRequest = workspace.groupJoinRequests.find(
      (request) =>
        request.adminGroupId === group.id && identifiersMatch(request.requesterId, input.requesterId),
    );

    if (existingRequest && existingRequest.status !== "rejected") {
      throw new Error("A request already exists for this group.");
    }

    const nextRequest = createGroupJoinRequest({
      adminGroupId: group.id,
      adminIdentifier: group.ownerIdentifier,
      adminGroupName: group.name,
      requesterId: input.requesterId,
      requesterLabel: input.requesterLabel,
    });

    updateWorkspace((currentWorkspace) => ({
      ...currentWorkspace,
      groupJoinRequests: [nextRequest, ...currentWorkspace.groupJoinRequests],
    }));

    return nextRequest;
  }

  function resolveGroupJoinRequest(input: { decision: "accept" | "reject"; requestId: string }) {
    const request = workspace.groupJoinRequests.find((entry) => entry.id === input.requestId);

    if (!request) {
      throw new Error("Request not found.");
    }

    let nextWorkspace = workspace;

    if (input.decision === "accept") {
      const ensured = ensureParticipantProfile(nextWorkspace, {
        identifier: request.requesterId,
        label: request.requesterLabel,
      });
      nextWorkspace = ensured.workspace;

      nextWorkspace = {
        ...nextWorkspace,
        participantGroups: nextWorkspace.participantGroups.map((group) =>
          group.id === request.adminGroupId
            ? {
                ...group,
                participantIds: dedupe([...group.participantIds, ensured.participant.id]),
                updatedAt: new Date().toISOString(),
              }
            : group,
        ),
      };
    }

    const resolvedRequest: GroupJoinRequest = {
      ...request,
      resolvedAt: new Date().toISOString(),
      status: input.decision === "accept" ? "accepted" : "rejected",
    };

    setWorkspace({
      ...nextWorkspace,
      groupJoinRequests: nextWorkspace.groupJoinRequests.map((entry) =>
        entry.id === request.id ? resolvedRequest : entry,
      ),
    });

    return resolvedRequest;
  }

  function createScheduledTest(input: {
    createdBy: string | null;
    durationMinutes: number;
    participantGroupIds: string[];
    participantIds: string[];
    poolId: string;
    questionCount: number;
    startsAt: string;
  }) {
    const pool = workspace.pools.find((entry) => entry.id === input.poolId);

    if (!pool) {
      throw new Error("Select a valid question pool.");
    }

    const poolQuestionIds = dedupe(pool.questionIds).filter((questionId) =>
      workspace.questions.some((question) => question.id === questionId),
    );

    if (input.questionCount > poolQuestionIds.length) {
      throw new Error("Question count cannot exceed the number of questions in the selected pool.");
    }

    const resolvedParticipantIdentifiers = resolveParticipantIdentifiers(
      workspace,
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

    updateWorkspace((currentWorkspace) => ({
      ...currentWorkspace,
      scheduledTests: [scheduledTest, ...currentWorkspace.scheduledTests],
    }));

    return scheduledTest;
  }

  function createPollQuestions(drafts: PollQuestionDraft[], createdBy: string | null = null) {
    const normalizedDrafts = drafts
      .map((draft) => ({
        options: draft.options.map((option) => option.trim()),
        prompt: draft.prompt.trim(),
        topic: draft.topic.trim(),
      }))
      .filter((draft) => draft.prompt || draft.options.some((option) => option));

    if (!normalizedDrafts.length) {
      throw new Error("Add at least one poll question before saving.");
    }

    const validationError = normalizedDrafts
      .map((draft) => validatePollQuestionDraft(draft))
      .find((error): error is string => Boolean(error));

    if (validationError) {
      throw new Error(validationError);
    }

    const nextPollQuestions = normalizedDrafts.map((draft) =>
      createPersistentPollQuestion(draft, { createdBy }),
    );

    updateWorkspace((currentWorkspace) => ({
      ...currentWorkspace,
      pollQuestions: [...nextPollQuestions.reverse(), ...currentWorkspace.pollQuestions],
    }));

    return nextPollQuestions;
  }

  function createScheduledPoll(input: {
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
    const questionIds = dedupe(input.questionIds);

    if (!questionIds.length) {
      throw new Error("Select at least one poll question.");
    }

    if (input.participantType === "registered" && !dedupe(input.participantGroupIds).length) {
      throw new Error("Select at least one group when sharing a poll with groups.");
    }

    const timestamp = new Date().toISOString();
    const scheduledPoll: ScheduledPoll = {
      anonymous: input.anonymous,
      createdAt: timestamp,
      createdBy: input.createdBy,
      endsAt: input.endsAt,
      id: createEntityId("poll"),
      participantGroupIds: dedupe(input.participantGroupIds),
      participantType: input.participantType,
      questionIds,
      shareCode: input.generateQrCode && input.participantType === "open"
        ? `TRAPIT-POLL-${createEntityId("access").replace(/-/g, "").toUpperCase()}`
        : null,
      startsAt: input.startsAt,
      status: resolveScheduledPollStatus({ endsAt: input.endsAt, startsAt: input.startsAt }),
      title: input.title.trim() || `${questionIds.length} question poll`,
      updatedAt: timestamp,
    };

    updateWorkspace((currentWorkspace) => ({
      ...currentWorkspace,
      scheduledPolls: [scheduledPoll, ...currentWorkspace.scheduledPolls],
    }));

    return scheduledPoll;
  }

  function getLeaderboardsForActor(actorId: string | null = null) {
    const hydratedTests = getHydratedScheduledTests().filter((test) => !actorId || test.createdBy === actorId);
    const scheduledTestIds = new Set(hydratedTests.map((test) => test.id));
    const attempts = workspace.attempts.filter((attempt) => scheduledTestIds.has(attempt.testId));

    return buildTestLeaderboards(attempts, hydratedTests).filter((leaderboard) =>
      hydratedTests.some((scheduledTest) => scheduledTest.id === leaderboard.testId && scheduledTest.status === "completed"),
    );
  }

  function getSummaryForActor(input?: { actorIdentifier?: string | null; actorSub?: string | null }) {
    const actorSub = input?.actorSub ?? null;
    const actorIdentifier = input?.actorIdentifier ?? null;
    const visibleQuestions = actorSub
      ? workspace.questions.filter((question) => question.createdBy === actorSub)
      : workspace.questions;
    const visiblePools = actorSub
      ? workspace.pools.filter((pool) => pool.createdBy === actorSub)
      : workspace.pools;
    const visibleScheduledTests = actorSub
      ? getHydratedScheduledTests().filter((test) => test.createdBy === actorSub)
      : getHydratedScheduledTests();
    const visibleAttempts = workspace.attempts.filter((attempt) =>
      visibleScheduledTests.some((scheduledTest) => scheduledTest.id === attempt.testId),
    );
    const visibleGroups = actorIdentifier
      ? workspace.participantGroups.filter((group) =>
          group.ownerIdentifier ? identifiersMatch(group.ownerIdentifier, actorIdentifier) : false,
        )
      : workspace.participantGroups;

    return {
      attempts: visibleAttempts.length,
      groups: visibleGroups.length,
      participants: workspace.participants.length,
      pools: visiblePools.length,
      questions: visibleQuestions.length,
      scheduledTests: visibleScheduledTests.length,
    };
  }

  function getAvailableTestsForParticipant(identifier: string): AvailableUserTest[] {
    const normalizedIdentifier = normalizeParticipantIdentifier(identifier);
    const hydratedTests = getHydratedScheduledTests().filter((scheduledTest) =>
      scheduledTest.resolvedParticipantIdentifiers.some((participantIdentifier) =>
        identifiersMatch(participantIdentifier, normalizedIdentifier),
      ),
    );
    const leaderboardByTestId = new Map(
      buildTestLeaderboards(workspace.attempts, hydratedTests).map((leaderboard) => [leaderboard.testId, leaderboard]),
    );
    const questionMap = getQuestionMap(workspace);

    return hydratedTests
      .map((scheduledTest) => ({
        durationMinutes: scheduledTest.durationMinutes,
        hasAttempt: workspace.attempts.some(
          (attempt) => attempt.testId === scheduledTest.id && identifiersMatch(attempt.userId, normalizedIdentifier),
        ),
        id: scheduledTest.id,
        poolId: scheduledTest.poolId,
        questionCount: scheduledTest.questionCount,
        questions: scheduledTest.questionIds
          .map((questionId) => questionMap.get(questionId))
          .filter((question): question is PersistentQuestion => Boolean(question)),
        startsAt: scheduledTest.startsAt,
        status: scheduledTest.status,
        title: scheduledTest.title,
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

  function getAvailablePollsForParticipant(identifier: string) {
    const normalizedIdentifier = normalizeParticipantIdentifier(identifier);
    const participantProfileIds = workspace.participants
      .filter((participant) => identifiersMatch(participant.identifier, normalizedIdentifier))
      .map((participant) => participant.id);
    const participantGroupIds = new Set(
      workspace.participantGroups
        .filter((group) => group.participantIds.some((participantId) => participantProfileIds.includes(participantId)))
        .map((group) => group.id),
    );

    return getHydratedScheduledPolls()
      .filter((poll) =>
        poll.participantType === "open"
          ? true
          : poll.participantGroupIds.some((groupId) => participantGroupIds.has(groupId)),
      )
      .sort((left, right) => new Date(right.startsAt).getTime() - new Date(left.startsAt).getTime());
  }

  function getUserHistory(identifier: string) {
    const normalizedIdentifier = normalizeParticipantIdentifier(identifier);
    const hydratedTests = getHydratedScheduledTests();
    const submittedAttempts = workspace.attempts.filter((attempt) => identifiersMatch(attempt.userId, normalizedIdentifier));
    const submittedHistory = summarizeTestHistory(submittedAttempts, hydratedTests);
    const missedHistory = hydratedTests
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
        rank: undefined,
        status: "missed" as const,
        testId: scheduledTest.id,
        testTitle: scheduledTest.title,
        totalCount: scheduledTest.questionCount,
      }));

    return [...submittedHistory, ...missedHistory].sort(
      (left, right) => new Date(right.completedAt).getTime() - new Date(left.completedAt).getTime(),
    );
  }

  function recordAttempt(input: {
    answers: Record<string, number | undefined>;
    completedAt: string;
    participantName?: string;
    startedAt: string;
    testId: string;
    userId: string;
  }) {
    const normalizedUserId = normalizeParticipantIdentifier(input.userId);
    const scheduledTest = getHydratedScheduledTests().find((test) => test.id === input.testId);

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
      workspace.attempts.some(
        (attempt) => attempt.testId === input.testId && identifiersMatch(attempt.userId, normalizedUserId),
      )
    ) {
      throw new Error("This test has already been submitted.");
    }

    const questionMap = getQuestionMap(workspace);
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

    const baseAttempt: TestAttempt = {
      answers: input.answers,
      completedAt: input.completedAt,
      id: createEntityId("attempt"),
      participantName,
      result: scoreObjectiveTest(questions, input.answers, startedAtMs, completedAtMs),
      startedAt: input.startedAt,
      testId: input.testId,
      userId: normalizedUserId,
    };

    const attemptsForTest = [baseAttempt, ...workspace.attempts.filter((attempt) => attempt.testId === input.testId)];
    const higherScoreCount = attemptsForTest.filter((savedAttempt) => {
      if (savedAttempt.id === baseAttempt.id) {
        return false;
      }

      return compareTestResults(savedAttempt.result, baseAttempt.result) < 0;
    }).length;

    const attempt: TestAttempt = {
      ...baseAttempt,
      result: {
        ...baseAttempt.result,
        assignedParticipantCount: scheduledTest.resolvedParticipantIdentifiers.length,
        incorrectCount: getIncorrectCount(baseAttempt.result),
        rank: higherScoreCount + 1,
        rankedParticipantCount: attemptsForTest.length,
      },
    };

    updateWorkspace((currentWorkspace) => ({
      ...currentWorkspace,
      attempts: [attempt, ...currentWorkspace.attempts],
    }));

    return attempt;
  }

  function getUserTestReview(testId: string, identifier: string) {
    const normalizedIdentifier = normalizeParticipantIdentifier(identifier);
    const scheduledTest = getHydratedScheduledTests().find((test) => test.id === testId);

    if (!scheduledTest || scheduledTest.status !== "completed") {
      throw new Error("Questions can be reviewed after results are announced.");
    }

    if (
      !scheduledTest.resolvedParticipantIdentifiers.some((participantIdentifier) =>
        identifiersMatch(participantIdentifier, normalizedIdentifier),
      )
    ) {
      throw new Error("You are not assigned to this test.");
    }

    const attempt = workspace.attempts.find(
      (entry) => entry.testId === testId && identifiersMatch(entry.userId, normalizedIdentifier),
    );
    const questionMap = getQuestionMap(workspace);

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

  return (
    <QuestionBankContext.Provider
      value={{
        addQuestion,
        attempts: workspace.attempts,
        clearQuestions,
        createGroup,
        createPollQuestions,
        createPool,
        createScheduledPoll,
        createScheduledTest,
        deleteGroup,
        getAvailablePollsForParticipant,
        getAvailableTestsForParticipant,
        getHydratedScheduledPolls,
        getHydratedScheduledTests,
        getLeaderboardsForActor,
        getSummaryForActor,
        getUserHistory,
        getUserTestReview,
        groupJoinRequests: workspace.groupJoinRequests,
        isReady,
        loadSamples,
        participantGroups: workspace.participantGroups,
        participants: workspace.participants,
        pollQuestions: workspace.pollQuestions,
        pools: workspace.pools,
        questions: workspace.questions,
        recordAttempt,
        removeQuestion,
        requestGroupJoin,
        resolveGroupJoinRequest,
        scheduledPolls: workspace.scheduledPolls,
        scheduledTests: workspace.scheduledTests,
        searchGroupsByAdminIdentifier,
        updateGroup,
      }}
    >
      {children}
    </QuestionBankContext.Provider>
  );
}

export function useQuestionBank() {
  const context = useContext(QuestionBankContext);

  if (!context) {
    throw new Error("useQuestionBank must be used within a QuestionBankProvider.");
  }

  return context;
}
