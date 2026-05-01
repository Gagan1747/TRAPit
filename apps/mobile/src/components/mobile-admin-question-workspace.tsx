import { validateQuestionDraft, type PollQuestionDraft, type PollParticipantType, type ScheduledPoll, type ScheduledTest } from "@trapit/testing";
import { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

import { useQuestionBank } from "../testing/question-bank-context";
import { MobileCollapsibleSection } from "./mobile-collapsible-section";

function formatShortDateTime(value: string) {
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function createEmptyOptions(count: number) {
  return Array.from({ length: count }, () => "");
}

function createDefaultScheduleTime() {
  const date = new Date(Date.now() + 60 * 60 * 1000);
  const timezoneOffsetMs = date.getTimezoneOffset() * 60 * 1000;

  return new Date(date.getTime() - timezoneOffsetMs).toISOString().slice(0, 16);
}

function createEmptyPollQuestionDraft(): PollQuestionDraft {
  return {
    options: ["", ""],
    prompt: "",
  };
}

function parseIdentifierList(value: string) {
  return value
    .split(/[\n,]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function normalizeIdentifier(value: string | null | undefined) {
  return value?.trim().toLowerCase() ?? "";
}

function belongsToActor(ownerId: string | null | undefined, actorId: string | null) {
  if (!actorId) {
    return true;
  }

  return !ownerId || normalizeIdentifier(ownerId) === normalizeIdentifier(actorId);
}

type AdminMobileSection =
  | "author"
  | "create-groups"
  | "history"
  | "join-groups"
  | "manage-groups"
  | "poll-questions"
  | "poll-schedule"
  | "question-bank"
  | "schedule"
  | "self-test";

type ResultsMode = "polls" | "tests";
type ResultsFilter = "admin" | "both" | "participant";

type MobileAdminQuestionWorkspaceProps = {
  currentAdminIdentifier: string | null;
};

const statusPriority: Record<ScheduledTest["status"], number> = {
  live: 0,
  scheduled: 1,
  completed: 2,
};

export function MobileAdminQuestionWorkspace({ currentAdminIdentifier }: MobileAdminQuestionWorkspaceProps) {
  const {
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
    groupJoinRequests,
    isReady,
    loadSamples,
    participantGroups,
    participants,
    pollQuestions,
    pools,
    questions,
    requestGroupJoin,
    resolveGroupJoinRequest,
    scheduledPolls,
    searchGroupsByAdminIdentifier,
    updateGroup,
    addQuestion,
    clearQuestions,
    removeQuestion,
  } = useQuestionBank();
  const [authorFeedback, setAuthorFeedback] = useState<string | null>(null);
  const [authorPoolId, setAuthorPoolId] = useState("");
  const [correctOptionIndex, setCorrectOptionIndex] = useState(0);
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [editingGroupParticipantText, setEditingGroupParticipantText] = useState("");
  const [editingGroupName, setEditingGroupName] = useState("");
  const [feedback, setFeedback] = useState<string | null>(null);
  const [groupDescription, setGroupDescription] = useState("");
  const [groupFeedback, setGroupFeedback] = useState<string | null>(null);
  const [groupName, setGroupName] = useState("");
  const [groupParticipantText, setGroupParticipantText] = useState("");
  const [groupSearchFeedback, setGroupSearchFeedback] = useState<string | null>(null);
  const [groupSearchPhoneNumber, setGroupSearchPhoneNumber] = useState("");
  const [groupSearchResults, setGroupSearchResults] = useState<string[]>([]);
  const [openSection, setOpenSection] = useState<AdminMobileSection | null>("history");
  const [optionCount, setOptionCount] = useState(4);
  const [options, setOptions] = useState<string[]>(createEmptyOptions(4));
  const [pollFeedback, setPollFeedback] = useState<string | null>(null);
  const [pollQuestionDrafts, setPollQuestionDrafts] = useState<PollQuestionDraft[]>([createEmptyPollQuestionDraft()]);
  const [pollScheduleAnonymous, setPollScheduleAnonymous] = useState(false);
  const [pollScheduleDurationMinutes, setPollScheduleDurationMinutes] = useState("10");
  const [pollScheduleGenerateQrCode, setPollScheduleGenerateQrCode] = useState(true);
  const [pollScheduleGroupIds, setPollScheduleGroupIds] = useState<string[]>([]);
  const [pollScheduleParticipantType, setPollScheduleParticipantType] = useState<PollParticipantType>("registered");
  const [pollScheduleQuestionIds, setPollScheduleQuestionIds] = useState<string[]>([]);
  const [pollScheduleStartMode, setPollScheduleStartMode] = useState<"later" | "now">("now");
  const [pollScheduleStartsAtInput, setPollScheduleStartsAtInput] = useState(createDefaultScheduleTime());
  const [prompt, setPrompt] = useState("");
  const [questionPoolIds, setQuestionPoolIds] = useState<string[]>([]);
  const [resultsFilter, setResultsFilter] = useState<ResultsFilter>("both");
  const [resultsMode, setResultsMode] = useState<ResultsMode>("tests");
  const [scheduleDurationMinutes, setScheduleDurationMinutes] = useState("30");
  const [scheduleFeedback, setScheduleFeedback] = useState<string | null>(null);
  const [scheduleGroupIds, setScheduleGroupIds] = useState<string[]>([]);
  const [schedulePoolId, setSchedulePoolId] = useState("");
  const [scheduleQuestionCount, setScheduleQuestionCount] = useState("1");
  const [scheduleStartMode, setScheduleStartMode] = useState<"later" | "now">("now");
  const [scheduleStartsAtInput, setScheduleStartsAtInput] = useState(createDefaultScheduleTime());
  const [selectedQuestionBankPoolId, setSelectedQuestionBankPoolId] = useState<string | null>(null);
  const [selfTestDurationMinutes, setSelfTestDurationMinutes] = useState("30");
  const [selfTestFeedback, setSelfTestFeedback] = useState<string | null>(null);
  const [selfTestPoolId, setSelfTestPoolId] = useState("");
  const [selfTestQuestionCount, setSelfTestQuestionCount] = useState("1");
  const [selfTestStartMode, setSelfTestStartMode] = useState<"later" | "now">("now");
  const [selfTestStartsAtInput, setSelfTestStartsAtInput] = useState(createDefaultScheduleTime());

  const visibleQuestions = questions.filter((question) => belongsToActor(question.createdBy, currentAdminIdentifier));
  const visiblePools = pools.filter((pool) => belongsToActor(pool.createdBy, currentAdminIdentifier));
  const visibleGroups = participantGroups.filter((group) => belongsToActor(group.ownerIdentifier, currentAdminIdentifier));
  const visiblePollQuestions = pollQuestions.filter((question) => belongsToActor(question.createdBy, currentAdminIdentifier));
  const visibleScheduledTests = getHydratedScheduledTests().filter((test) => belongsToActor(test.createdBy, currentAdminIdentifier));
  const visibleScheduledPolls = getHydratedScheduledPolls().filter((poll) => belongsToActor(poll.createdBy, currentAdminIdentifier));
  const visibleJoinRequests = groupJoinRequests.filter((request) =>
    visibleGroups.some((group) => group.id === request.adminGroupId),
  );
  const participantTests = currentAdminIdentifier ? getAvailableTestsForParticipant(currentAdminIdentifier) : [];
  const participantHistory = currentAdminIdentifier ? getUserHistory(currentAdminIdentifier) : [];
  const participantPolls = currentAdminIdentifier ? getAvailablePollsForParticipant(currentAdminIdentifier) : [];
  const leaderboards = getLeaderboardsForActor(currentAdminIdentifier);
  const summary = getSummaryForActor({
    actorIdentifier: currentAdminIdentifier,
    actorSub: currentAdminIdentifier,
  });
  const participantHistoryByTestId = new Map(participantHistory.map((entry) => [entry.testId, entry]));
  const completedTestsCount = visibleScheduledTests.filter((test) => test.status === "completed").length;
  const upcomingTestsCount = visibleScheduledTests.filter((test) => test.status === "scheduled").length;

  const mergedTests = useMemo(() => {
    const merged = new Map<string, {
      durationMinutes: number;
      hasAdminScope: boolean;
      hasParticipantScope: boolean;
      id: string;
      participantHistoryEntry?: (typeof participantHistory)[number];
      participantTest?: (typeof participantTests)[number];
      poolId: string;
      questionCount: number;
      scheduledTest?: (typeof visibleScheduledTests)[number];
      startsAt: string;
      status: ScheduledTest["status"];
      title: string;
    }>();

    for (const scheduledTest of visibleScheduledTests) {
      merged.set(scheduledTest.id, {
        durationMinutes: scheduledTest.durationMinutes,
        hasAdminScope: true,
        hasParticipantScope: false,
        id: scheduledTest.id,
        poolId: scheduledTest.poolId,
        questionCount: scheduledTest.questionCount,
        scheduledTest,
        startsAt: scheduledTest.startsAt,
        status: scheduledTest.status,
        title: scheduledTest.title,
      });
    }

    for (const participantTest of participantTests) {
      const existing = merged.get(participantTest.id);

      merged.set(participantTest.id, {
        durationMinutes: existing?.durationMinutes ?? participantTest.durationMinutes,
        hasAdminScope: existing?.hasAdminScope ?? false,
        hasParticipantScope: true,
        id: participantTest.id,
        participantHistoryEntry: participantHistoryByTestId.get(participantTest.id),
        participantTest,
        poolId: existing?.poolId ?? participantTest.poolId,
        questionCount: existing?.questionCount ?? participantTest.questionCount,
        scheduledTest: existing?.scheduledTest,
        startsAt: existing?.startsAt ?? participantTest.startsAt,
        status: existing?.status ?? participantTest.status,
        title: existing?.title ?? participantTest.title,
      });
    }

    return Array.from(merged.values())
      .filter((test) => {
        if (resultsFilter === "admin") {
          return test.hasAdminScope;
        }

        if (resultsFilter === "participant") {
          return test.hasParticipantScope;
        }

        return true;
      })
      .sort((left, right) => {
        const priorityDifference = statusPriority[left.status] - statusPriority[right.status];

        if (priorityDifference !== 0) {
          return priorityDifference;
        }

        return new Date(right.startsAt).getTime() - new Date(left.startsAt).getTime();
      });
  }, [participantHistoryByTestId, participantTests, resultsFilter, visibleScheduledTests]);

  const mergedPolls = useMemo(() => {
    const merged = new Map<string, {
      hasAdminScope: boolean;
      hasParticipantScope: boolean;
      id: string;
      participantPoll?: ScheduledPoll;
      scheduledPoll?: ScheduledPoll;
      startsAt: string;
      status: ScheduledPoll["status"];
      title: string;
    }>();

    for (const scheduledPoll of visibleScheduledPolls) {
      merged.set(scheduledPoll.id, {
        hasAdminScope: true,
        hasParticipantScope: false,
        id: scheduledPoll.id,
        scheduledPoll,
        startsAt: scheduledPoll.startsAt,
        status: scheduledPoll.status,
        title: scheduledPoll.title,
      });
    }

    for (const participantPoll of participantPolls) {
      const existing = merged.get(participantPoll.id);

      merged.set(participantPoll.id, {
        hasAdminScope: existing?.hasAdminScope ?? false,
        hasParticipantScope: true,
        id: participantPoll.id,
        participantPoll,
        scheduledPoll: existing?.scheduledPoll,
        startsAt: existing?.startsAt ?? participantPoll.startsAt,
        status: existing?.status ?? participantPoll.status,
        title: existing?.title ?? participantPoll.title,
      });
    }

    return Array.from(merged.values())
      .filter((poll) => {
        if (resultsFilter === "admin") {
          return poll.hasAdminScope;
        }

        if (resultsFilter === "participant") {
          return poll.hasParticipantScope;
        }

        return true;
      })
      .sort((left, right) => new Date(right.startsAt).getTime() - new Date(left.startsAt).getTime());
  }, [participantPolls, resultsFilter, visibleScheduledPolls]);

  const filteredQuestionBankQuestions = selectedQuestionBankPoolId
    ? visibleQuestions.filter((question) => question.poolIds.includes(selectedQuestionBankPoolId))
    : [];

  if (!isReady) {
    return null;
  }

  function toggleSection(section: AdminMobileSection) {
    setOpenSection((currentSection) => (currentSection === section ? null : section));
  }

  function toggleArrayValue(currentValues: string[], value: string) {
    return currentValues.includes(value)
      ? currentValues.filter((currentValue) => currentValue !== value)
      : [...currentValues, value];
  }

  function updateOption(index: number, value: string) {
    setOptions((currentOptions) =>
      currentOptions.map((option, optionIndex) => (optionIndex === index ? value : option)),
    );
  }

  function changeOptionCount(nextCount: number) {
    setOptionCount(nextCount);
    setOptions((currentOptions) => {
      if (nextCount > currentOptions.length) {
        return [...currentOptions, ...createEmptyOptions(nextCount - currentOptions.length)];
      }

      return currentOptions.slice(0, nextCount);
    });
    setCorrectOptionIndex((currentIndex) => Math.min(currentIndex, nextCount - 1));
  }

  function resetQuestionForm(nextCount = optionCount) {
    setPrompt("");
    setOptionCount(nextCount);
    setOptions(createEmptyOptions(nextCount));
    setCorrectOptionIndex(0);
    setQuestionPoolIds([]);
  }

  function handleCreatePool() {
    const nextPool = createPool({
      createdBy: currentAdminIdentifier,
      description: "",
      name: authorPoolId,
    });

    if (!nextPool) {
      setFeedback("Pool name is required.");
      return;
    }

    setFeedback("Pool created.");
    setAuthorPoolId("");
    setSelectedQuestionBankPoolId(nextPool.id);
  }

  function handleAddQuestion() {
    if (!questionPoolIds.length) {
      setAuthorFeedback("Select at least one pool before saving the question.");
      return;
    }

    const draft = {
      correctOptionIndex,
      options,
      prompt,
    };
    const validationError = validateQuestionDraft(draft);

    if (validationError) {
      setAuthorFeedback(validationError);
      return;
    }

    addQuestion(draft, questionPoolIds, currentAdminIdentifier);
    setAuthorFeedback("Question added.");
    resetQuestionForm(optionCount);
  }

  function handleCreateGroup() {
    const group = createGroup({
      description: groupDescription,
      name: groupName,
      ownerIdentifier: currentAdminIdentifier,
      participantIdentifiers: parseIdentifierList(groupParticipantText),
    });

    if (!group) {
      setGroupFeedback("Group name is required.");
      return;
    }

    setGroupFeedback("Group created.");
    setGroupDescription("");
    setGroupName("");
    setGroupParticipantText("");
  }

  function handleStartEditingGroup(groupId: string) {
    const group = visibleGroups.find((entry) => entry.id === groupId);

    if (!group) {
      return;
    }

    setEditingGroupId(group.id);
    setEditingGroupName(group.name);
    setEditingGroupParticipantText(
      group.participantIds
        .map((participantId) => participants.find((participant) => participant.id === participantId)?.identifier)
        .filter((identifier): identifier is string => Boolean(identifier))
        .join(", "),
    );
  }

  function handleSaveGroup(groupId: string) {
    try {
      updateGroup({
        groupId,
        name: editingGroupName,
        participantIdentifiers: parseIdentifierList(editingGroupParticipantText),
      });
      setEditingGroupId(null);
      setEditingGroupName("");
      setEditingGroupParticipantText("");
      setGroupFeedback("Group updated.");
    } catch (error) {
      setGroupFeedback(error instanceof Error ? error.message : "Unable to update the group.");
    }
  }

  function handleScheduleTest() {
    if (!schedulePoolId) {
      setScheduleFeedback("Select a question pool first.");
      return;
    }

    try {
      createScheduledTest({
        createdBy: currentAdminIdentifier,
        durationMinutes: Number(scheduleDurationMinutes),
        participantGroupIds: scheduleGroupIds,
        participantIds: [],
        poolId: schedulePoolId,
        questionCount: Number(scheduleQuestionCount),
        startsAt:
          scheduleStartMode === "now"
            ? new Date().toISOString()
            : new Date(scheduleStartsAtInput).toISOString(),
      });
      setScheduleFeedback("Test scheduled.");
      setScheduleDurationMinutes("30");
      setScheduleGroupIds([]);
      setScheduleQuestionCount("1");
      setScheduleStartMode("now");
      setScheduleStartsAtInput(createDefaultScheduleTime());
    } catch (error) {
      setScheduleFeedback(error instanceof Error ? error.message : "Unable to schedule the test.");
    }
  }

  function handleScheduleSelfTest() {
    if (!currentAdminIdentifier) {
      setSelfTestFeedback("Your account needs an identifier before you can create a self test.");
      return;
    }

    try {
      createScheduledTest({
        createdBy: currentAdminIdentifier,
        durationMinutes: Number(selfTestDurationMinutes),
        participantGroupIds: [],
        participantIds: [currentAdminIdentifier],
        poolId: selfTestPoolId,
        questionCount: Number(selfTestQuestionCount),
        startsAt:
          selfTestStartMode === "now"
            ? new Date().toISOString()
            : new Date(selfTestStartsAtInput).toISOString(),
      });
      setSelfTestFeedback("Self test scheduled.");
      setSelfTestDurationMinutes("30");
      setSelfTestQuestionCount("1");
      setSelfTestStartMode("now");
      setSelfTestStartsAtInput(createDefaultScheduleTime());
      setOpenSection("history");
    } catch (error) {
      setSelfTestFeedback(error instanceof Error ? error.message : "Unable to schedule the self test.");
    }
  }

  function updatePollQuestionDraft(index: number, updater: (draft: PollQuestionDraft) => PollQuestionDraft) {
    setPollQuestionDrafts((currentDrafts) =>
      currentDrafts.map((draft, draftIndex) => (draftIndex === index ? updater(draft) : draft)),
    );
  }

  function handleSavePollQuestions() {
    try {
      createPollQuestions(pollQuestionDrafts, currentAdminIdentifier);
      setPollFeedback("Poll questions saved.");
      setPollQuestionDrafts([createEmptyPollQuestionDraft()]);
    } catch (error) {
      setPollFeedback(error instanceof Error ? error.message : "Unable to save the poll questions.");
    }
  }

  function handleSchedulePoll() {
    try {
      createScheduledPoll({
        anonymous: pollScheduleAnonymous,
        createdBy: currentAdminIdentifier,
        durationMinutes: Number(pollScheduleDurationMinutes),
        generateQrCode: pollScheduleGenerateQrCode,
        participantGroupIds: pollScheduleParticipantType === "registered" ? pollScheduleGroupIds : [],
        participantType: pollScheduleParticipantType,
        questionIds: pollScheduleQuestionIds,
        startsAt:
          pollScheduleStartMode === "now"
            ? new Date().toISOString()
            : new Date(pollScheduleStartsAtInput).toISOString(),
      });
      setPollFeedback("Poll scheduled.");
      setPollScheduleAnonymous(false);
      setPollScheduleDurationMinutes("10");
      setPollScheduleGenerateQrCode(true);
      setPollScheduleGroupIds([]);
      setPollScheduleParticipantType("registered");
      setPollScheduleQuestionIds([]);
      setPollScheduleStartMode("now");
      setPollScheduleStartsAtInput(createDefaultScheduleTime());
    } catch (error) {
      setPollFeedback(error instanceof Error ? error.message : "Unable to schedule the poll.");
    }
  }

  function handleSearchGroups() {
    const nextResults = searchGroupsByAdminIdentifier(groupSearchPhoneNumber.trim());

    setGroupSearchResults(nextResults.map((group) => group.id));
    setGroupSearchFeedback(nextResults.length ? null : "No groups were found for that admin identifier.");
  }

  function handleRequestGroup(groupId: string) {
    if (!currentAdminIdentifier) {
      setGroupSearchFeedback("Your account needs an identifier before you can request a group.");
      return;
    }

    try {
      requestGroupJoin({
        adminGroupId: groupId,
        requesterId: currentAdminIdentifier,
        requesterLabel: currentAdminIdentifier,
      });
      setGroupSearchFeedback("Request sent to the admin for review.");
    } catch (error) {
      setGroupSearchFeedback(error instanceof Error ? error.message : "Unable to send the group request.");
    }
  }

  const searchResultGroups = groupSearchResults
    .map((groupId) => participantGroups.find((group) => group.id === groupId))
    .filter((group): group is NonNullable<typeof participantGroups[number]> => Boolean(group));

  const menuButton = (label: string, section: AdminMobileSection) => (
    <Pressable
      key={section}
      style={[styles.menuButton, openSection === section && styles.menuButtonActive]}
      onPress={() => setOpenSection(section)}
    >
      <Text style={[styles.menuButtonText, openSection === section && styles.menuButtonTextActive]}>{label}</Text>
    </Pressable>
  );

  return (
    <View style={styles.stack}>
      <View style={styles.summaryCard}>
        <Text style={styles.eyebrow}>Mobile admin rollout</Text>
        <Text style={styles.summaryTitle}>Questions, Test, Results</Text>
        <View style={styles.metricWrap}>
          <View style={styles.metricCard}><Text style={styles.metricValue}>{summary.participants}</Text><Text style={styles.metricLabel}>participants</Text></View>
          <View style={styles.metricCard}><Text style={styles.metricValue}>{summary.questions}</Text><Text style={styles.metricLabel}>questions</Text></View>
          <View style={styles.metricCard}><Text style={styles.metricValue}>{upcomingTestsCount}</Text><Text style={styles.metricLabel}>test upcoming</Text></View>
          <View style={styles.metricCard}><Text style={styles.metricValue}>{summary.groups}</Text><Text style={styles.metricLabel}>groups</Text></View>
          <View style={styles.metricCard}><Text style={styles.metricValue}>{summary.pools}</Text><Text style={styles.metricLabel}>pools</Text></View>
          <View style={styles.metricCard}><Text style={styles.metricValue}>{completedTestsCount}</Text><Text style={styles.metricLabel}>test completed</Text></View>
        </View>
      </View>

      <View style={styles.menuCard}>
        <Text style={styles.eyebrow}>Workspace menu</Text>
        <Text style={styles.menuTitle}>Admin navigation</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.menuRow}>
          {menuButton("Results", "history")}
          {menuButton("Add questions", "author")}
          {menuButton("Question Pool", "question-bank")}
          {menuButton("Schedule test", "schedule")}
          {menuButton("Self test", "self-test")}
          {menuButton("Add poll question", "poll-questions")}
          {menuButton("Schedule poll", "poll-schedule")}
          {menuButton("Create groups", "create-groups")}
          {menuButton("Manage groups", "manage-groups")}
          {menuButton("Join groups", "join-groups")}
        </ScrollView>
      </View>

      <MobileCollapsibleSection eyebrow="" isOpen={openSection === "history"} title="Results" onToggle={() => toggleSection("history")}>
        <View style={styles.toggleRow}>
          <Pressable style={[styles.pill, resultsMode === "tests" && styles.pillActive]} onPress={() => setResultsMode("tests")}><Text style={[styles.pillText, resultsMode === "tests" && styles.pillTextActive]}>Test results</Text></Pressable>
          <Pressable style={[styles.pill, resultsMode === "polls" && styles.pillActive]} onPress={() => setResultsMode("polls")}><Text style={[styles.pillText, resultsMode === "polls" && styles.pillTextActive]}>Poll results</Text></Pressable>
        </View>
        <View style={styles.toggleRow}>
          <Pressable style={[styles.pill, resultsFilter === "admin" && styles.pillActive]} onPress={() => setResultsFilter("admin")}><Text style={[styles.pillText, resultsFilter === "admin" && styles.pillTextActive]}>{resultsMode === "tests" ? "Scheduled as admin" : "Poll created as admin"}</Text></Pressable>
          <Pressable style={[styles.pill, resultsFilter === "both" && styles.pillActive]} onPress={() => setResultsFilter("both")}><Text style={[styles.pillText, resultsFilter === "both" && styles.pillTextActive]}>Both</Text></Pressable>
          <Pressable style={[styles.pill, resultsFilter === "participant" && styles.pillActive]} onPress={() => setResultsFilter("participant")}><Text style={[styles.pillText, resultsFilter === "participant" && styles.pillTextActive]}>{resultsMode === "tests" ? "Attended as participant" : "Poll responded as participant"}</Text></Pressable>
        </View>

        {resultsMode === "tests" ? (
          mergedTests.length ? mergedTests.map((test) => {
            const scheduledTest = test.scheduledTest;
            const leaderboard = scheduledTest ? leaderboards.find((entry) => entry.testId === scheduledTest.id) : undefined;
            const participantHistoryEntry = test.participantHistoryEntry;
            const scopeLabel = test.hasAdminScope && test.hasParticipantScope ? "Admin + participant" : test.hasAdminScope ? "Scheduled as admin" : "Attended as participant";

            return (
              <View key={test.id} style={styles.itemCard}>
                <View style={styles.itemHead}><Text style={styles.cardTitle}>{test.title}</Text><Text style={styles.statusText}>{test.status}</Text></View>
                <Text style={styles.metaText}>Scope: {scopeLabel}</Text>
                <Text style={styles.metaText}>Starts: {formatShortDateTime(test.startsAt)}</Text>
                <Text style={styles.metaText}>Duration: {test.durationMinutes} min</Text>
                <Text style={styles.metaText}>Questions: {test.questionCount}</Text>
                {scheduledTest ? (
                  <>
                    <Text style={styles.metaText}>Participants: {scheduledTest.resolvedParticipantIdentifiers.join(", ") || "None"}</Text>
                    {leaderboard ? (
                      <View style={styles.subList}>
                        <Text style={styles.cardSubtitle}>Leaderboard</Text>
                        {leaderboard.entries.length ? leaderboard.entries.map((entry) => (
                          <View key={entry.attemptId} style={styles.subCard}>
                            <Text style={styles.subCardTitle}>{entry.participantName?.trim() || entry.participantId}</Text>
                            <Text style={styles.metaText}>Rank {entry.rank} • {entry.correctCount}/{entry.totalCount} • {entry.elapsedMs / 1000}s</Text>
                          </View>
                        )) : <Text style={styles.metaText}>No submissions were recorded before this test closed.</Text>}
                      </View>
                    ) : scheduledTest.status === "scheduled" ? (
                      <Text style={styles.metaText}>This test has not started yet.</Text>
                    ) : scheduledTest.status === "live" ? (
                      <Text style={styles.metaText}>This test is live. Results will update as participants submit.</Text>
                    ) : null}
                  </>
                ) : null}
                {test.participantTest ? (
                  <>
                    {participantHistoryEntry ? (
                      participantHistoryEntry.status === "missed" ? (
                        <Text style={styles.metaText}>You were assigned to this test but did not submit before it closed.</Text>
                      ) : (
                        <>
                          <Text style={styles.metaText}>Submitted as {participantHistoryEntry.participantName?.trim() || participantHistoryEntry.participantId}</Text>
                          <Text style={styles.metaText}>Score {participantHistoryEntry.correctCount}/{participantHistoryEntry.totalCount}</Text>
                        </>
                      )
                    ) : <Text style={styles.metaText}>No participant submission was recorded for this test.</Text>}
                  </>
                ) : null}
              </View>
            );
          }) : <Text style={styles.metaText}>No tests match this view yet.</Text>
        ) : (
          mergedPolls.length ? mergedPolls.map((poll) => {
            const resolvedPoll = poll.scheduledPoll ?? poll.participantPoll;

            if (!resolvedPoll) {
              return null;
            }

            const scopeLabel = poll.hasAdminScope && poll.hasParticipantScope ? "Admin + participant" : poll.hasAdminScope ? "Created as admin" : "Available as participant";

            return (
              <View key={poll.id} style={styles.itemCard}>
                <View style={styles.itemHead}><Text style={styles.cardTitle}>{resolvedPoll.title}</Text><Text style={styles.statusText}>{resolvedPoll.status}</Text></View>
                <Text style={styles.metaText}>Scope: {scopeLabel}</Text>
                <Text style={styles.metaText}>Starts: {formatShortDateTime(resolvedPoll.startsAt)}</Text>
                <Text style={styles.metaText}>Duration: {resolvedPoll.durationMinutes} min</Text>
                <Text style={styles.metaText}>Questions: {resolvedPoll.questionIds.length}</Text>
                <Text style={styles.metaText}>Participant type: {resolvedPoll.participantType === "registered" ? "Registered only" : "Open to all"}</Text>
                <Text style={styles.metaText}>Anonymity: {resolvedPoll.anonymous ? "Anonymous" : "Named"}</Text>
                {resolvedPoll.shareCode ? <Text style={styles.metaText}>Access code: {resolvedPoll.shareCode}</Text> : null}
                <Text style={styles.metaText}>Poll response summaries will appear here when participation is recorded.</Text>
              </View>
            );
          }) : <Text style={styles.metaText}>No polls match this view yet.</Text>
        )}
      </MobileCollapsibleSection>

      <MobileCollapsibleSection eyebrow="Question pools" isOpen={openSection === "author"} title="Add Questions" onToggle={() => toggleSection("author")}>
        <TextInput placeholder="New pool name" placeholderTextColor="#8e7d70" style={styles.input} value={authorPoolId} onChangeText={setAuthorPoolId} />
        <View style={styles.actionRow}>
          <Pressable style={styles.secondaryButton} onPress={handleCreatePool}><Text style={styles.secondaryButtonText}>Create pool</Text></Pressable>
          <Pressable style={styles.secondaryButton} onPress={() => loadSamples(currentAdminIdentifier)}><Text style={styles.secondaryButtonText}>Load sample set</Text></Pressable>
        </View>
        <TextInput multiline placeholder="Question" placeholderTextColor="#8e7d70" style={[styles.input, styles.textarea]} value={prompt} onChangeText={setPrompt} />
        <View style={styles.toggleRow}>
          <Pressable style={[styles.pill, optionCount === 4 && styles.pillActive]} onPress={() => changeOptionCount(4)}><Text style={[styles.pillText, optionCount === 4 && styles.pillTextActive]}>4 options</Text></Pressable>
          <Pressable style={[styles.pill, optionCount === 5 && styles.pillActive]} onPress={() => changeOptionCount(5)}><Text style={[styles.pillText, optionCount === 5 && styles.pillTextActive]}>5 options</Text></Pressable>
        </View>
        {options.map((option, index) => (
          <View key={`option-${index}`} style={styles.optionRow}>
            <TextInput placeholder={`Option ${index + 1}`} placeholderTextColor="#8e7d70" style={[styles.input, styles.optionInput]} value={option} onChangeText={(value) => updateOption(index, value)} />
            <Pressable style={[styles.pill, correctOptionIndex === index && styles.pillActive]} onPress={() => setCorrectOptionIndex(index)}><Text style={[styles.pillText, correctOptionIndex === index && styles.pillTextActive]}>Correct</Text></Pressable>
          </View>
        ))}
        <Text style={styles.label}>Assign to pools</Text>
        <View style={styles.chipWrap}>
          {visiblePools.map((pool) => (
            <Pressable key={pool.id} style={[styles.selectionCard, questionPoolIds.includes(pool.id) && styles.selectionCardActive]} onPress={() => setQuestionPoolIds((currentIds) => toggleArrayValue(currentIds, pool.id))}>
              <Text style={[styles.selectionTitle, questionPoolIds.includes(pool.id) && styles.selectionTitleActive]}>{pool.name}</Text>
            </Pressable>
          ))}
        </View>
        {authorFeedback ? <Text style={styles.metaText}>{authorFeedback}</Text> : null}
        <View style={styles.actionRow}>
          <Pressable style={styles.primaryButton} onPress={handleAddQuestion}><Text style={styles.primaryButtonText}>Add question</Text></Pressable>
          <Pressable style={styles.secondaryButton} onPress={() => resetQuestionForm(optionCount)}><Text style={styles.secondaryButtonText}>Reset form</Text></Pressable>
        </View>
      </MobileCollapsibleSection>

      <MobileCollapsibleSection eyebrow="Question bank" isOpen={openSection === "question-bank"} title="Question Pool" onToggle={() => toggleSection("question-bank")}>
        <View style={styles.chipWrap}>
          {visiblePools.map((pool) => (
            <Pressable key={pool.id} style={[styles.selectionCard, selectedQuestionBankPoolId === pool.id && styles.selectionCardActive]} onPress={() => setSelectedQuestionBankPoolId(pool.id)}>
              <Text style={[styles.selectionTitle, selectedQuestionBankPoolId === pool.id && styles.selectionTitleActive]}>{pool.name}</Text>
            </Pressable>
          ))}
        </View>
        {selectedQuestionBankPoolId ? (
          filteredQuestionBankQuestions.length ? filteredQuestionBankQuestions.map((question) => (
            <View key={question.id} style={styles.itemCard}>
              <Text style={styles.cardTitle}>{question.prompt}</Text>
              {question.options.map((option, index) => (
                <Text key={`${question.id}-${index}`} style={styles.metaText}>{index + 1}. {option}{index === question.correctOptionIndex ? " (correct)" : ""}</Text>
              ))}
              <Pressable style={styles.secondaryButton} onPress={() => removeQuestion(question.id)}><Text style={styles.secondaryButtonText}>Remove question</Text></Pressable>
            </View>
          )) : <Text style={styles.metaText}>No questions exist in this pool yet.</Text>
        ) : <Text style={styles.metaText}>Select a pool to display only its questions.</Text>}
        <Pressable style={styles.secondaryButton} onPress={() => clearQuestions(currentAdminIdentifier)}><Text style={styles.secondaryButtonText}>Clear my questions</Text></Pressable>
      </MobileCollapsibleSection>

      <MobileCollapsibleSection eyebrow="Groups" isOpen={openSection === "create-groups"} title="Create Groups" onToggle={() => toggleSection("create-groups")}>
        <TextInput placeholder="Group name" placeholderTextColor="#8e7d70" style={styles.input} value={groupName} onChangeText={setGroupName} />
        <TextInput placeholder="Description" placeholderTextColor="#8e7d70" style={styles.input} value={groupDescription} onChangeText={setGroupDescription} />
        <TextInput multiline placeholder="Participant identifiers, separated by comma or newline" placeholderTextColor="#8e7d70" style={[styles.input, styles.textareaSmall]} value={groupParticipantText} onChangeText={setGroupParticipantText} />
        {groupFeedback ? <Text style={styles.metaText}>{groupFeedback}</Text> : null}
        <Pressable style={styles.primaryButton} onPress={handleCreateGroup}><Text style={styles.primaryButtonText}>Create group</Text></Pressable>
      </MobileCollapsibleSection>

      <MobileCollapsibleSection eyebrow="Groups" isOpen={openSection === "manage-groups"} title="Manage Groups" onToggle={() => toggleSection("manage-groups")}>
        {visibleJoinRequests.length ? (
          <View style={styles.subList}>
            <Text style={styles.cardSubtitle}>Pending requests</Text>
            {visibleJoinRequests.filter((request) => request.status === "pending").map((request) => (
              <View key={request.id} style={styles.subCard}>
                <Text style={styles.subCardTitle}>{request.requesterLabel}</Text>
                <Text style={styles.metaText}>Requesting {request.adminGroupName}</Text>
                <View style={styles.actionRow}>
                  <Pressable style={styles.primaryButton} onPress={() => resolveGroupJoinRequest({ decision: "accept", requestId: request.id })}><Text style={styles.primaryButtonText}>Accept</Text></Pressable>
                  <Pressable style={styles.secondaryButton} onPress={() => resolveGroupJoinRequest({ decision: "reject", requestId: request.id })}><Text style={styles.secondaryButtonText}>Reject</Text></Pressable>
                </View>
              </View>
            ))}
          </View>
        ) : null}
        {visibleGroups.length ? visibleGroups.map((group) => (
          <View key={group.id} style={styles.itemCard}>
            <Text style={styles.cardTitle}>{group.name}</Text>
            <Text style={styles.metaText}>{group.participantIds.length} member{group.participantIds.length === 1 ? "" : "s"}</Text>
            {editingGroupId === group.id ? (
              <>
                <TextInput placeholder="Group name" placeholderTextColor="#8e7d70" style={styles.input} value={editingGroupName} onChangeText={setEditingGroupName} />
                <TextInput multiline placeholder="Participant identifiers" placeholderTextColor="#8e7d70" style={[styles.input, styles.textareaSmall]} value={editingGroupParticipantText} onChangeText={setEditingGroupParticipantText} />
                <View style={styles.actionRow}>
                  <Pressable style={styles.primaryButton} onPress={() => handleSaveGroup(group.id)}><Text style={styles.primaryButtonText}>Save</Text></Pressable>
                  <Pressable style={styles.secondaryButton} onPress={() => setEditingGroupId(null)}><Text style={styles.secondaryButtonText}>Cancel</Text></Pressable>
                </View>
              </>
            ) : (
              <>
                {group.participantIds.map((participantId) => {
                  const participant = participants.find((entry) => entry.id === participantId);
                  return participant ? <Text key={participantId} style={styles.metaText}>{participant.identifier}</Text> : null;
                })}
                <View style={styles.actionRow}>
                  <Pressable style={styles.secondaryButton} onPress={() => handleStartEditingGroup(group.id)}><Text style={styles.secondaryButtonText}>Edit</Text></Pressable>
                  <Pressable style={styles.secondaryButton} onPress={() => deleteGroup(group.id)}><Text style={styles.secondaryButtonText}>Delete</Text></Pressable>
                </View>
              </>
            )}
          </View>
        )) : <Text style={styles.metaText}>No groups created yet.</Text>}
      </MobileCollapsibleSection>

      <MobileCollapsibleSection eyebrow="Test" isOpen={openSection === "schedule"} title="Schedule Test" onToggle={() => toggleSection("schedule")}>
        <TextInput placeholder="Question pool id" placeholderTextColor="#8e7d70" style={styles.input} value={schedulePoolId} onChangeText={setSchedulePoolId} />
        <TextInput placeholder="Duration in minutes" placeholderTextColor="#8e7d70" style={styles.input} keyboardType="number-pad" value={scheduleDurationMinutes} onChangeText={setScheduleDurationMinutes} />
        <TextInput placeholder="Number of questions" placeholderTextColor="#8e7d70" style={styles.input} keyboardType="number-pad" value={scheduleQuestionCount} onChangeText={setScheduleQuestionCount} />
        <Text style={styles.label}>Select groups</Text>
        <View style={styles.chipWrap}>{visibleGroups.map((group) => <Pressable key={group.id} style={[styles.selectionCard, scheduleGroupIds.includes(group.id) && styles.selectionCardActive]} onPress={() => setScheduleGroupIds((currentIds) => toggleArrayValue(currentIds, group.id))}><Text style={[styles.selectionTitle, scheduleGroupIds.includes(group.id) && styles.selectionTitleActive]}>{group.name}</Text></Pressable>)}</View>
        <View style={styles.toggleRow}>
          <Pressable style={[styles.pill, scheduleStartMode === "now" && styles.pillActive]} onPress={() => setScheduleStartMode("now")}><Text style={[styles.pillText, scheduleStartMode === "now" && styles.pillTextActive]}>Start now</Text></Pressable>
          <Pressable style={[styles.pill, scheduleStartMode === "later" && styles.pillActive]} onPress={() => setScheduleStartMode("later")}><Text style={[styles.pillText, scheduleStartMode === "later" && styles.pillTextActive]}>Schedule later</Text></Pressable>
        </View>
        {scheduleStartMode === "later" ? <TextInput placeholder="YYYY-MM-DDTHH:mm" placeholderTextColor="#8e7d70" style={styles.input} value={scheduleStartsAtInput} onChangeText={setScheduleStartsAtInput} /> : null}
        {scheduleFeedback ? <Text style={styles.metaText}>{scheduleFeedback}</Text> : null}
        <Pressable style={styles.primaryButton} onPress={handleScheduleTest}><Text style={styles.primaryButtonText}>Schedule test</Text></Pressable>
      </MobileCollapsibleSection>

      <MobileCollapsibleSection eyebrow="Test" isOpen={openSection === "self-test"} title="Self Test" onToggle={() => toggleSection("self-test")}>
        <TextInput placeholder="Question pool id" placeholderTextColor="#8e7d70" style={styles.input} value={selfTestPoolId} onChangeText={setSelfTestPoolId} />
        <TextInput placeholder="Duration in minutes" placeholderTextColor="#8e7d70" style={styles.input} keyboardType="number-pad" value={selfTestDurationMinutes} onChangeText={setSelfTestDurationMinutes} />
        <TextInput placeholder="Number of questions" placeholderTextColor="#8e7d70" style={styles.input} keyboardType="number-pad" value={selfTestQuestionCount} onChangeText={setSelfTestQuestionCount} />
        <View style={styles.toggleRow}>
          <Pressable style={[styles.pill, selfTestStartMode === "now" && styles.pillActive]} onPress={() => setSelfTestStartMode("now")}><Text style={[styles.pillText, selfTestStartMode === "now" && styles.pillTextActive]}>Start now</Text></Pressable>
          <Pressable style={[styles.pill, selfTestStartMode === "later" && styles.pillActive]} onPress={() => setSelfTestStartMode("later")}><Text style={[styles.pillText, selfTestStartMode === "later" && styles.pillTextActive]}>Schedule later</Text></Pressable>
        </View>
        {selfTestStartMode === "later" ? <TextInput placeholder="YYYY-MM-DDTHH:mm" placeholderTextColor="#8e7d70" style={styles.input} value={selfTestStartsAtInput} onChangeText={setSelfTestStartsAtInput} /> : null}
        {selfTestFeedback ? <Text style={styles.metaText}>{selfTestFeedback}</Text> : null}
        <Pressable style={styles.primaryButton} onPress={handleScheduleSelfTest}><Text style={styles.primaryButtonText}>Schedule self test</Text></Pressable>
      </MobileCollapsibleSection>

      <MobileCollapsibleSection eyebrow="Poll" isOpen={openSection === "poll-questions"} title="Add Poll Question" onToggle={() => toggleSection("poll-questions")}>
        {pollQuestionDrafts.map((draft, draftIndex) => (
          <View key={`poll-${draftIndex}`} style={styles.itemCard}>
            <Text style={styles.cardTitle}>Poll question {draftIndex + 1}</Text>
            <TextInput multiline placeholder="Question" placeholderTextColor="#8e7d70" style={[styles.input, styles.textarea]} value={draft.prompt} onChangeText={(value) => updatePollQuestionDraft(draftIndex, (currentDraft) => ({ ...currentDraft, prompt: value }))} />
            {draft.options.map((option, optionIndex) => (
              <TextInput key={`poll-option-${draftIndex}-${optionIndex}`} placeholder={`Option ${optionIndex + 1}`} placeholderTextColor="#8e7d70" style={styles.input} value={option} onChangeText={(value) => updatePollQuestionDraft(draftIndex, (currentDraft) => ({ ...currentDraft, options: currentDraft.options.map((currentOption, currentIndex) => currentIndex === optionIndex ? value : currentOption) }))} />
            ))}
            <View style={styles.actionRow}>
              <Pressable style={styles.secondaryButton} onPress={() => updatePollQuestionDraft(draftIndex, (currentDraft) => ({ ...currentDraft, options: [...currentDraft.options, ""] }))}><Text style={styles.secondaryButtonText}>Add option</Text></Pressable>
              {pollQuestionDrafts.length > 1 ? <Pressable style={styles.secondaryButton} onPress={() => setPollQuestionDrafts((currentDrafts) => currentDrafts.filter((_, currentIndex) => currentIndex !== draftIndex))}><Text style={styles.secondaryButtonText}>Remove question</Text></Pressable> : null}
            </View>
          </View>
        ))}
        {pollFeedback ? <Text style={styles.metaText}>{pollFeedback}</Text> : null}
        <View style={styles.actionRow}>
          <Pressable style={styles.secondaryButton} onPress={() => setPollQuestionDrafts((currentDrafts) => [...currentDrafts, createEmptyPollQuestionDraft()])}><Text style={styles.secondaryButtonText}>Add another question</Text></Pressable>
          <Pressable style={styles.primaryButton} onPress={handleSavePollQuestions}><Text style={styles.primaryButtonText}>Save poll questions</Text></Pressable>
        </View>
        {visiblePollQuestions.length ? visiblePollQuestions.map((question) => (
          <View key={question.id} style={styles.subCard}><Text style={styles.subCardTitle}>{question.prompt}</Text>{question.options.map((option, index) => <Text key={`${question.id}-${index}`} style={styles.metaText}>{index + 1}. {option}</Text>)}</View>
        )) : null}
      </MobileCollapsibleSection>

      <MobileCollapsibleSection eyebrow="Poll" isOpen={openSection === "poll-schedule"} title="Schedule Poll" onToggle={() => toggleSection("poll-schedule")}>
        <TextInput placeholder="Duration in minutes" placeholderTextColor="#8e7d70" style={styles.input} keyboardType="number-pad" value={pollScheduleDurationMinutes} onChangeText={setPollScheduleDurationMinutes} />
        <View style={styles.toggleRow}>
          <Pressable style={[styles.pill, pollScheduleStartMode === "now" && styles.pillActive]} onPress={() => setPollScheduleStartMode("now")}><Text style={[styles.pillText, pollScheduleStartMode === "now" && styles.pillTextActive]}>Start now</Text></Pressable>
          <Pressable style={[styles.pill, pollScheduleStartMode === "later" && styles.pillActive]} onPress={() => setPollScheduleStartMode("later")}><Text style={[styles.pillText, pollScheduleStartMode === "later" && styles.pillTextActive]}>Schedule later</Text></Pressable>
        </View>
        {pollScheduleStartMode === "later" ? <TextInput placeholder="YYYY-MM-DDTHH:mm" placeholderTextColor="#8e7d70" style={styles.input} value={pollScheduleStartsAtInput} onChangeText={setPollScheduleStartsAtInput} /> : null}
        <Text style={styles.label}>Select poll questions</Text>
        <View style={styles.chipWrap}>{visiblePollQuestions.map((question) => <Pressable key={question.id} style={[styles.selectionCard, pollScheduleQuestionIds.includes(question.id) && styles.selectionCardActive]} onPress={() => setPollScheduleQuestionIds((currentIds) => toggleArrayValue(currentIds, question.id))}><Text style={[styles.selectionTitle, pollScheduleQuestionIds.includes(question.id) && styles.selectionTitleActive]} numberOfLines={2}>{question.prompt}</Text></Pressable>)}</View>
        <View style={styles.toggleRow}>
          <Pressable style={[styles.pill, pollScheduleParticipantType === "registered" && styles.pillActive]} onPress={() => setPollScheduleParticipantType("registered")}><Text style={[styles.pillText, pollScheduleParticipantType === "registered" && styles.pillTextActive]}>Registered only</Text></Pressable>
          <Pressable style={[styles.pill, pollScheduleParticipantType === "open" && styles.pillActive]} onPress={() => setPollScheduleParticipantType("open")}><Text style={[styles.pillText, pollScheduleParticipantType === "open" && styles.pillTextActive]}>Open to all</Text></Pressable>
        </View>
        {pollScheduleParticipantType === "registered" ? <View style={styles.chipWrap}>{visibleGroups.map((group) => <Pressable key={group.id} style={[styles.selectionCard, pollScheduleGroupIds.includes(group.id) && styles.selectionCardActive]} onPress={() => setPollScheduleGroupIds((currentIds) => toggleArrayValue(currentIds, group.id))}><Text style={[styles.selectionTitle, pollScheduleGroupIds.includes(group.id) && styles.selectionTitleActive]}>{group.name}</Text></Pressable>)}</View> : null}
        <View style={styles.toggleRow}>
          <Pressable style={[styles.pill, pollScheduleAnonymous && styles.pillActive]} onPress={() => setPollScheduleAnonymous((currentValue) => !currentValue)}><Text style={[styles.pillText, pollScheduleAnonymous && styles.pillTextActive]}>Anonymous</Text></Pressable>
          <Pressable style={[styles.pill, pollScheduleGenerateQrCode && styles.pillActive]} onPress={() => setPollScheduleGenerateQrCode((currentValue) => !currentValue)}><Text style={[styles.pillText, pollScheduleGenerateQrCode && styles.pillTextActive]}>Generate code</Text></Pressable>
        </View>
        {pollFeedback ? <Text style={styles.metaText}>{pollFeedback}</Text> : null}
        <Pressable style={styles.primaryButton} onPress={handleSchedulePoll}><Text style={styles.primaryButtonText}>Schedule poll</Text></Pressable>
        {visibleScheduledPolls.length ? visibleScheduledPolls.map((poll) => <View key={poll.id} style={styles.subCard}><Text style={styles.subCardTitle}>{poll.title}</Text><Text style={styles.metaText}>Starts: {formatShortDateTime(poll.startsAt)}</Text><Text style={styles.metaText}>Status: {poll.status}</Text><Text style={styles.metaText}>Access code: {poll.shareCode ?? "Not generated"}</Text></View>) : null}
      </MobileCollapsibleSection>

      <MobileCollapsibleSection eyebrow="Groups" isOpen={openSection === "join-groups"} title="Join Groups" onToggle={() => toggleSection("join-groups")}>
        <TextInput placeholder="Admin phone or identifier" placeholderTextColor="#8e7d70" style={styles.input} value={groupSearchPhoneNumber} onChangeText={setGroupSearchPhoneNumber} />
        <Pressable style={styles.secondaryButton} onPress={handleSearchGroups}><Text style={styles.secondaryButtonText}>Search groups</Text></Pressable>
        {groupSearchFeedback ? <Text style={styles.metaText}>{groupSearchFeedback}</Text> : null}
        {searchResultGroups.length ? searchResultGroups.map((group) => {
          const latestRequest = groupJoinRequests.find((request) => request.adminGroupId === group.id && request.requesterId === currentAdminIdentifier);

          return (
            <View key={group.id} style={styles.itemCard}>
              <Text style={styles.cardTitle}>{group.name}</Text>
              <Text style={styles.metaText}>{group.participantIds.length} current member{group.participantIds.length === 1 ? "" : "s"}</Text>
              <Text style={styles.metaText}>Owner: {group.ownerIdentifier ?? "Unknown"}</Text>
              <Pressable style={styles.primaryButton} onPress={() => handleRequestGroup(group.id)} disabled={Boolean(latestRequest && latestRequest.status !== "rejected")}><Text style={styles.primaryButtonText}>{latestRequest ? latestRequest.status === "pending" ? "Request pending" : latestRequest.status === "accepted" ? "Request accepted" : "Request sent" : "Request access"}</Text></Pressable>
            </View>
          );
        }) : null}
      </MobileCollapsibleSection>
    </View>
  );
}

const styles = StyleSheet.create({
  actionRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  cardSubtitle: {
    color: "#231712",
    fontSize: 16,
    fontWeight: "700",
  },
  cardTitle: {
    color: "#231712",
    fontSize: 18,
    fontWeight: "700",
  },
  chipWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  eyebrow: {
    color: "#8e3f2c",
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 1.6,
    textTransform: "uppercase",
  },
  input: {
    backgroundColor: "#fffaf5",
    borderColor: "#d7c3af",
    borderRadius: 16,
    borderWidth: 1,
    color: "#231712",
    minHeight: 48,
    paddingHorizontal: 14,
  },
  itemCard: {
    backgroundColor: "rgba(255, 248, 240, 0.92)",
    borderRadius: 20,
    gap: 8,
    padding: 16,
  },
  itemHead: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 10,
  },
  label: {
    color: "#231712",
    fontSize: 14,
    fontWeight: "700",
  },
  menuButton: {
    backgroundColor: "#fffaf5",
    borderColor: "#d7c3af",
    borderRadius: 999,
    borderWidth: 1,
    minHeight: 42,
    justifyContent: "center",
    paddingHorizontal: 16,
  },
  menuButtonActive: {
    backgroundColor: "rgba(180, 76, 47, 0.12)",
    borderColor: "#b44c2f",
  },
  menuButtonText: {
    color: "#6d5a4e",
    fontWeight: "600",
  },
  menuButtonTextActive: {
    color: "#8e3f2c",
  },
  menuCard: {
    backgroundColor: "rgba(255, 248, 240, 0.92)",
    borderRadius: 24,
    gap: 8,
    padding: 18,
  },
  menuRow: {
    gap: 10,
    paddingVertical: 4,
  },
  menuTitle: {
    color: "#231712",
    fontSize: 22,
    fontWeight: "700",
  },
  metaText: {
    color: "#6d5a4e",
    fontSize: 14,
    lineHeight: 20,
  },
  metricCard: {
    backgroundColor: "#fffaf5",
    borderColor: "#d7c3af",
    borderRadius: 16,
    borderWidth: 1,
    minWidth: 96,
    padding: 12,
  },
  metricLabel: {
    color: "#6d5a4e",
    fontSize: 12,
  },
  metricValue: {
    color: "#231712",
    fontSize: 20,
    fontWeight: "700",
  },
  metricWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginTop: 12,
  },
  optionInput: {
    flex: 1,
  },
  optionRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
  },
  pill: {
    backgroundColor: "#fffaf5",
    borderColor: "#d7c3af",
    borderRadius: 999,
    borderWidth: 1,
    minHeight: 40,
    justifyContent: "center",
    paddingHorizontal: 14,
  },
  pillActive: {
    backgroundColor: "#b44c2f",
    borderColor: "#b44c2f",
  },
  pillText: {
    color: "#6d5a4e",
    fontSize: 13,
    fontWeight: "700",
  },
  pillTextActive: {
    color: "#ffffff",
  },
  primaryButton: {
    alignItems: "center",
    backgroundColor: "#b44c2f",
    borderRadius: 999,
    justifyContent: "center",
    minHeight: 46,
    paddingHorizontal: 16,
  },
  primaryButtonText: {
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "700",
  },
  secondaryButton: {
    alignItems: "center",
    backgroundColor: "#fffaf5",
    borderColor: "#d7c3af",
    borderRadius: 999,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 46,
    paddingHorizontal: 16,
  },
  secondaryButtonText: {
    color: "#6d5a4e",
    fontSize: 14,
    fontWeight: "700",
  },
  selectionCard: {
    backgroundColor: "#fffaf5",
    borderColor: "#d7c3af",
    borderRadius: 16,
    borderWidth: 1,
    minWidth: 110,
    padding: 12,
  },
  selectionCardActive: {
    backgroundColor: "rgba(180, 76, 47, 0.12)",
    borderColor: "#b44c2f",
  },
  selectionTitle: {
    color: "#231712",
    fontSize: 13,
    fontWeight: "700",
  },
  selectionTitleActive: {
    color: "#8e3f2c",
  },
  stack: {
    gap: 16,
    marginTop: 16,
  },
  statusText: {
    color: "#8e3f2c",
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
  },
  subCard: {
    backgroundColor: "#fffaf5",
    borderColor: "#d7c3af",
    borderRadius: 16,
    borderWidth: 1,
    gap: 6,
    padding: 12,
  },
  subCardTitle: {
    color: "#231712",
    fontSize: 15,
    fontWeight: "700",
  },
  subList: {
    gap: 10,
  },
  summaryCard: {
    backgroundColor: "rgba(255, 248, 240, 0.92)",
    borderRadius: 24,
    padding: 18,
  },
  summaryTitle: {
    color: "#231712",
    fontSize: 24,
    fontWeight: "700",
    marginTop: 4,
  },
  textarea: {
    minHeight: 120,
    paddingTop: 12,
    textAlignVertical: "top",
  },
  textareaSmall: {
    minHeight: 90,
    paddingTop: 12,
    textAlignVertical: "top",
  },
  toggleRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
});
