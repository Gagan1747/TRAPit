import { formatElapsedTime, type ScheduledPoll, type ScheduledTest } from "@trapit/testing";
import { useMemo, useState } from "react";
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { useQuestionBank } from "../testing/question-bank-context";
import { MobileCollapsibleSection } from "./mobile-collapsible-section";

function formatShortDateTime(value: string) {
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

type UserDashboardSection = "history" | "join-groups";
type ResultsMode = "polls" | "tests";
type ResultsFilter = "admin" | "both" | "participant";
type RestrictedMenuGroup = "groups" | "poll" | "test";

type MobileRestrictedUserDashboardWorkspaceProps = {
  currentUserIdentifier: string | null;
};

const statusPriority: Record<ScheduledTest["status"], number> = {
  live: 0,
  scheduled: 1,
  completed: 2,
};

export function MobileRestrictedUserDashboardWorkspace({ currentUserIdentifier }: MobileRestrictedUserDashboardWorkspaceProps) {
  const { getAvailablePollsForParticipant, getAvailableTestsForParticipant, getUserHistory, groupJoinRequests, requestGroupJoin, searchGroupsByAdminIdentifier } = useQuestionBank();
  const [groupSearchFeedback, setGroupSearchFeedback] = useState<string | null>(null);
  const [groupSearchPhoneNumber, setGroupSearchPhoneNumber] = useState("");
  const [groupSearchResultIds, setGroupSearchResultIds] = useState<string[]>([]);
  const [isMenuCollapsed, setIsMenuCollapsed] = useState(false);
  const [lockedFeatureOpen, setLockedFeatureOpen] = useState(false);
  const [openMenuGroup, setOpenMenuGroup] = useState<RestrictedMenuGroup | null>(null);
  const [openSection, setOpenSection] = useState<UserDashboardSection | null>("history");
  const [resultsFilter, setResultsFilter] = useState<ResultsFilter>("both");
  const [resultsMode, setResultsMode] = useState<ResultsMode>("tests");

  const availableTests = currentUserIdentifier ? getAvailableTestsForParticipant(currentUserIdentifier) : [];
  const availablePolls = currentUserIdentifier ? getAvailablePollsForParticipant(currentUserIdentifier) : [];
  const history = currentUserIdentifier ? getUserHistory(currentUserIdentifier) : [];
  const historyByTestId = new Map(history.map((entry) => [entry.testId, entry]));
  const searchResults = useMemo(
    () => searchGroupsByAdminIdentifier(groupSearchPhoneNumber).filter((group) => groupSearchResultIds.includes(group.id)),
    [groupSearchPhoneNumber, groupSearchResultIds, searchGroupsByAdminIdentifier],
  );
  const filteredTests = (resultsFilter === "admin" ? [] : availableTests).sort((left, right) => {
    const priorityDifference = statusPriority[left.status] - statusPriority[right.status];

    if (priorityDifference !== 0) {
      return priorityDifference;
    }

    return new Date(right.startsAt).getTime() - new Date(left.startsAt).getTime();
  });
  const filteredPolls = (resultsFilter === "admin" ? [] : availablePolls).sort(
    (left, right) => new Date(right.startsAt).getTime() - new Date(left.startsAt).getTime(),
  );
  const pendingGroupRequests = groupJoinRequests.filter((request) => request.status === "pending").length;

  function toggleSection(section: UserDashboardSection) {
    setOpenSection((currentSection) => (currentSection === section ? null : section));
  }

  function handleLockedFeature() {
    setLockedFeatureOpen(true);
  }

  function handleSearchGroups() {
    const nextResults = searchGroupsByAdminIdentifier(groupSearchPhoneNumber.trim());

    setGroupSearchResultIds(nextResults.map((group) => group.id));
    setGroupSearchFeedback(nextResults.length ? null : "No groups were found for that admin identifier.");
  }

  function handleRequestGroup(groupId: string) {
    if (!currentUserIdentifier) {
      setGroupSearchFeedback("Your account needs an identifier before you can request a group.");
      return;
    }

    try {
      requestGroupJoin({
        adminGroupId: groupId,
        requesterId: currentUserIdentifier,
        requesterLabel: currentUserIdentifier,
      });
      setGroupSearchFeedback("Request sent to the admin for review.");
    } catch (error) {
      setGroupSearchFeedback(error instanceof Error ? error.message : "Unable to send the group request.");
    }
  }

  function isMenuGroupActive(group: RestrictedMenuGroup) {
    return group === "groups" && openSection === "join-groups";
  }

  function renderMenuItem(label: string, section?: UserDashboardSection) {
    const isActive = Boolean(section && openSection === section);
    const isDisabled = !section;

    return (
      <Pressable
        key={`${label}-${section ?? "disabled"}`}
        style={[styles.menuItem, isDisabled && styles.menuItemDisabled, isActive && styles.menuItemActive]}
        onPress={section ? () => setOpenSection(section) : handleLockedFeature}
      >
        <Text style={[styles.menuItemText, isDisabled && styles.menuItemTextDisabled, isActive && styles.menuItemTextActive]}>{label}</Text>
      </Pressable>
    );
  }

  function renderMenuGroup(
    label: string,
    group: RestrictedMenuGroup,
    items: Array<{ label: string; section?: UserDashboardSection }>,
  ) {
    const isOpen = openMenuGroup === group;
    const isActive = isMenuGroupActive(group);

    return (
      <View key={group} style={styles.menuGroupCard}>
        <Pressable
          style={[styles.menuGroupTrigger, (isOpen || isActive) && styles.menuGroupTriggerActive]}
          onPress={() => setOpenMenuGroup((currentGroup) => (currentGroup === group ? null : group))}
        >
          <Text style={[styles.menuGroupTriggerText, (isOpen || isActive) && styles.menuGroupTriggerTextActive]}>{label}</Text>
          <Text style={[styles.menuGroupChevron, (isOpen || isActive) && styles.menuGroupChevronActive]}>{isOpen ? "-" : "+"}</Text>
        </Pressable>
        {isOpen ? <View style={styles.menuGroupItems}>{items.map((item) => renderMenuItem(item.label, item.section))}</View> : null}
      </View>
    );
  }

  return (
    <View style={styles.stack}>
      <View style={styles.summaryCard}>
        <Text style={styles.eyebrow}>Mobile user rollout</Text>
        <Text style={styles.summaryTitle}>Questions, Test, Results</Text>
        <View style={styles.metricWrap}>
          <View style={styles.metricCard}><Text style={styles.metricValue}>{availableTests.length}</Text><Text style={styles.metricLabel}>tests</Text></View>
          <View style={styles.metricCard}><Text style={styles.metricValue}>{availablePolls.length}</Text><Text style={styles.metricLabel}>polls</Text></View>
          <View style={styles.metricCard}><Text style={styles.metricValue}>{history.length}</Text><Text style={styles.metricLabel}>results</Text></View>
          <View style={styles.metricCard}><Text style={styles.metricValue}>{pendingGroupRequests}</Text><Text style={styles.metricLabel}>pending</Text></View>
        </View>
      </View>

      <View style={styles.menuCard}>
        <View style={styles.menuHeaderRow}>
          <View>
            <Text style={styles.eyebrow}>Workspace menu</Text>
            <Text style={styles.menuTitle}>User navigation</Text>
          </View>
          <Pressable style={styles.menuToggleButton} onPress={() => setIsMenuCollapsed((currentValue) => !currentValue)}>
            <Text style={styles.menuToggleButtonText}>{isMenuCollapsed ? "Show menu" : "Hide menu"}</Text>
          </Pressable>
        </View>
        {isMenuCollapsed ? (
          <Text style={styles.metaText}>Navigation is hidden. Expand the menu to switch sections.</Text>
        ) : (
          <View style={styles.menuStack}>
            {renderMenuItem("Home", "history")}
            {renderMenuGroup("Test", "test", [
              { label: "Add Questions" },
              { label: "Question Pools" },
              { label: "Schedule" },
              { label: "Self Test" },
            ])}
            {renderMenuGroup("Poll", "poll", [
              { label: "Add Questions" },
              { label: "Schedule" },
            ])}
            {renderMenuGroup("Groups", "groups", [
              { label: "Create" },
              { label: "Manage" },
              { label: "Join", section: "join-groups" },
            ])}
          </View>
        )}
      </View>

      <MobileCollapsibleSection eyebrow="" isOpen={openSection === "history"} title="Results" onToggle={() => toggleSection("history")}>
        <View style={styles.segmentedControl}>
          <Pressable style={[styles.segmentedControlItem, resultsMode === "tests" && styles.segmentedControlItemActive]} onPress={() => setResultsMode("tests")}><Text style={[styles.segmentedControlText, resultsMode === "tests" && styles.segmentedControlTextActive]}>Test results</Text></Pressable>
          <Pressable style={[styles.segmentedControlItem, resultsMode === "polls" && styles.segmentedControlItemActive]} onPress={() => setResultsMode("polls")}><Text style={[styles.segmentedControlText, resultsMode === "polls" && styles.segmentedControlTextActive]}>Poll results</Text></Pressable>
        </View>
        <View style={[styles.segmentedControl, styles.segmentedControlWide]}>
          <Pressable style={[styles.segmentedControlItem, resultsFilter === "admin" && styles.segmentedControlItemActive]} onPress={() => setResultsFilter("admin")}><Text style={[styles.segmentedControlText, resultsFilter === "admin" && styles.segmentedControlTextActive]}>{resultsMode === "tests" ? "Scheduled as admin" : "Poll created as admin"}</Text></Pressable>
          <Pressable style={[styles.segmentedControlItem, resultsFilter === "both" && styles.segmentedControlItemActive]} onPress={() => setResultsFilter("both")}><Text style={[styles.segmentedControlText, resultsFilter === "both" && styles.segmentedControlTextActive]}>Both</Text></Pressable>
          <Pressable style={[styles.segmentedControlItem, resultsFilter === "participant" && styles.segmentedControlItemActive]} onPress={() => setResultsFilter("participant")}><Text style={[styles.segmentedControlText, resultsFilter === "participant" && styles.segmentedControlTextActive]}>{resultsMode === "tests" ? "Attended as participant" : "Poll responded as participant"}</Text></Pressable>
        </View>

        {resultsMode === "tests" ? (
          filteredTests.length ? filteredTests.map((test) => {
            const historyEntry = historyByTestId.get(test.id);

            return (
              <View key={test.id} style={styles.itemCard}>
                <View style={styles.itemHead}><Text style={styles.cardTitle}>{test.title}</Text><Text style={styles.statusText}>{historyEntry?.status === "missed" ? "missed" : test.status}</Text></View>
                <Text style={styles.metaText}>Starts: {formatShortDateTime(test.startsAt)}</Text>
                <Text style={styles.metaText}>Duration: {test.durationMinutes} min</Text>
                <Text style={styles.metaText}>Questions: {test.questionCount}</Text>
                {historyEntry ? (
                  <>
                    <Text style={styles.metaText}>Score {historyEntry.correctCount}/{historyEntry.totalCount}</Text>
                    <Text style={styles.metaText}>Time taken {formatElapsedTime(historyEntry.elapsedMs)}</Text>
                  </>
                ) : test.status === "completed" ? (
                  <Text style={styles.metaText}>No participant submission was recorded for this test.</Text>
                ) : test.status === "live" ? (
                  <Text style={styles.metaText}>This test is live now.</Text>
                ) : (
                  <Text style={styles.metaText}>This test has not started yet.</Text>
                )}
              </View>
            );
          }) : <Text style={styles.metaText}>No tests match this view yet.</Text>
        ) : (
          filteredPolls.length ? filteredPolls.map((poll) => (
            <View key={poll.id} style={styles.itemCard}>
              <View style={styles.itemHead}><Text style={styles.cardTitle}>{poll.title}</Text><Text style={styles.statusText}>{poll.status}</Text></View>
              <Text style={styles.metaText}>Starts: {formatShortDateTime(poll.startsAt)}</Text>
              <Text style={styles.metaText}>Duration: {poll.durationMinutes} min</Text>
              <Text style={styles.metaText}>Questions: {poll.questionIds.length}</Text>
              <Text style={styles.metaText}>Participant type: {poll.participantType === "registered" ? "Registered only" : "Open to all"}</Text>
              <Text style={styles.metaText}>Poll response summaries will appear here when participation is recorded.</Text>
            </View>
          )) : <Text style={styles.metaText}>No polls match this view yet.</Text>
        )}
      </MobileCollapsibleSection>

      <MobileCollapsibleSection eyebrow="" isOpen={openSection === "join-groups"} title="Join Groups" onToggle={() => toggleSection("join-groups")}>
        <TextInput placeholder="Admin phone or identifier" placeholderTextColor="#8e7d70" style={styles.input} value={groupSearchPhoneNumber} onChangeText={setGroupSearchPhoneNumber} />
        <Pressable style={styles.secondaryButton} onPress={handleSearchGroups}><Text style={styles.secondaryButtonText}>Search groups</Text></Pressable>
        {groupSearchFeedback ? <Text style={styles.metaText}>{groupSearchFeedback}</Text> : null}
        {searchResults.length ? searchResults.map((group) => {
          const latestRequest = groupJoinRequests.find((request) => request.adminGroupId === group.id && request.requesterId === currentUserIdentifier);

          return (
            <View key={group.id} style={styles.itemCard}>
              <Text style={styles.cardTitle}>{group.name}</Text>
              <Text style={styles.metaText}>{group.participantIds.length} current member{group.participantIds.length === 1 ? "" : "s"}</Text>
              <Text style={styles.metaText}>Owner: {group.ownerIdentifier ?? "Unknown"}</Text>
              <Pressable style={styles.primaryButton} onPress={() => handleRequestGroup(group.id)} disabled={Boolean(latestRequest && latestRequest.status !== "rejected")}>
                <Text style={styles.primaryButtonText}>{latestRequest ? latestRequest.status === "pending" ? "Request pending" : latestRequest.status === "accepted" ? "Request accepted" : "Request sent" : "Request access"}</Text>
              </Pressable>
            </View>
          );
        }) : null}
      </MobileCollapsibleSection>

      <Modal animationType="fade" transparent visible={lockedFeatureOpen} onRequestClose={() => setLockedFeatureOpen(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.eyebrow}>Locked feature</Text>
            <Text style={styles.summaryTitle}>TRAPit Pro</Text>
            <Text style={styles.metaText}>Get TRAPit Pro to access this feature</Text>
            <Pressable style={styles.primaryButton} onPress={() => setLockedFeatureOpen(false)}><Text style={styles.primaryButtonText}>Close</Text></Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  cardTitle: { color: "#231712", fontSize: 18, fontWeight: "700" },
  eyebrow: { color: "#8e3f2c", fontSize: 12, fontWeight: "700", letterSpacing: 1.6, textTransform: "uppercase" },
  input: { backgroundColor: "#fffaf5", borderColor: "#d7c3af", borderRadius: 16, borderWidth: 1, color: "#231712", minHeight: 48, paddingHorizontal: 14 },
  itemCard: { backgroundColor: "rgba(255, 248, 240, 0.92)", borderRadius: 20, gap: 8, padding: 16 },
  itemHead: { alignItems: "center", flexDirection: "row", gap: 10, justifyContent: "space-between" },
  menuButton: { backgroundColor: "#fffaf5", borderColor: "#d7c3af", borderRadius: 999, borderWidth: 1, justifyContent: "center", minHeight: 42, paddingHorizontal: 14 },
  menuButtonActive: { backgroundColor: "rgba(180, 76, 47, 0.12)", borderColor: "#b44c2f" },
  menuButtonDisabled: { opacity: 0.6 },
  menuButtonText: { color: "#6d5a4e", fontWeight: "600" },
  menuButtonTextActive: { color: "#8e3f2c" },
  menuButtonTextDisabled: { color: "#8f8075" },
  menuGroupCard: { gap: 8 },
  menuGroupChevron: { color: "#8f8075", fontSize: 20, fontWeight: "700", lineHeight: 20 },
  menuGroupChevronActive: { color: "#8e3f2c" },
  menuGroupItems: { gap: 8, paddingLeft: 14 },
  menuGroupTrigger: { alignItems: "center", backgroundColor: "#fffaf5", borderColor: "#d7c3af", borderRadius: 18, borderWidth: 1, flexDirection: "row", justifyContent: "space-between", minHeight: 48, paddingHorizontal: 16 },
  menuGroupTriggerActive: { backgroundColor: "rgba(180, 76, 47, 0.12)", borderColor: "#b44c2f" },
  menuGroupTriggerText: { color: "#231712", fontSize: 15, fontWeight: "700" },
  menuGroupTriggerTextActive: { color: "#8e3f2c" },
  menuHeaderRow: { alignItems: "flex-start", flexDirection: "row", gap: 12, justifyContent: "space-between" },
  menuCard: { backgroundColor: "rgba(255, 248, 240, 0.92)", borderRadius: 24, gap: 8, padding: 18 },
  menuItem: { alignItems: "center", backgroundColor: "#fffaf5", borderColor: "#d7c3af", borderRadius: 16, borderWidth: 1, flexDirection: "row", minHeight: 46, paddingHorizontal: 16 },
  menuItemActive: { backgroundColor: "rgba(180, 76, 47, 0.12)", borderColor: "#b44c2f" },
  menuItemDisabled: { opacity: 0.6 },
  menuItemText: { color: "#231712", fontSize: 14, fontWeight: "700" },
  menuItemTextActive: { color: "#8e3f2c" },
  menuItemTextDisabled: { color: "#8f8075" },
  menuGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  menuStack: { gap: 12, marginTop: 12 },
  menuToggleButton: { alignItems: "center", backgroundColor: "#fffaf5", borderColor: "#d7c3af", borderRadius: 999, borderWidth: 1, justifyContent: "center", minHeight: 42, paddingHorizontal: 14 },
  menuToggleButtonText: { color: "#6d5a4e", fontSize: 13, fontWeight: "700" },
  menuTitle: { color: "#231712", fontSize: 22, fontWeight: "700" },
  metaText: { color: "#6d5a4e", fontSize: 14, lineHeight: 20 },
  metricCard: { backgroundColor: "#fffaf5", borderColor: "#d7c3af", borderRadius: 16, borderWidth: 1, minWidth: 96, padding: 12 },
  metricLabel: { color: "#6d5a4e", fontSize: 12 },
  metricValue: { color: "#231712", fontSize: 20, fontWeight: "700" },
  metricWrap: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 12 },
  modalCard: { backgroundColor: "rgba(255, 248, 240, 0.98)", borderRadius: 24, gap: 12, padding: 20, width: "86%" },
  modalOverlay: { alignItems: "center", backgroundColor: "rgba(28, 20, 15, 0.28)", flex: 1, justifyContent: "center", padding: 24 },
  segmentedControl: { backgroundColor: "rgba(255, 250, 245, 0.94)", borderColor: "#d7c3af", borderRadius: 999, borderWidth: 1, flexDirection: "row", flexWrap: "wrap", gap: 6, padding: 6 },
  segmentedControlItem: { alignItems: "center", borderRadius: 999, flexGrow: 1, justifyContent: "center", minHeight: 44, minWidth: 94, paddingHorizontal: 14 },
  segmentedControlItemActive: { backgroundColor: "#b44c2f" },
  segmentedControlText: { color: "#6d5a4e", fontSize: 13, fontWeight: "700", textAlign: "center" },
  segmentedControlTextActive: { color: "#ffffff" },
  segmentedControlWide: { width: "100%" },
  pill: { backgroundColor: "#fffaf5", borderColor: "#d7c3af", borderRadius: 999, borderWidth: 1, minHeight: 40, justifyContent: "center", paddingHorizontal: 14 },
  pillActive: { backgroundColor: "#b44c2f", borderColor: "#b44c2f" },
  pillText: { color: "#6d5a4e", fontSize: 13, fontWeight: "700" },
  pillTextActive: { color: "#ffffff" },
  primaryButton: { alignItems: "center", backgroundColor: "#b44c2f", borderRadius: 999, justifyContent: "center", minHeight: 46, paddingHorizontal: 16 },
  primaryButtonText: { color: "#ffffff", fontSize: 14, fontWeight: "700" },
  secondaryButton: { alignItems: "center", backgroundColor: "#fffaf5", borderColor: "#d7c3af", borderRadius: 999, borderWidth: 1, justifyContent: "center", minHeight: 46, paddingHorizontal: 16 },
  secondaryButtonText: { color: "#6d5a4e", fontSize: 14, fontWeight: "700" },
  stack: { gap: 16, marginTop: 16 },
  statusText: { color: "#8e3f2c", fontSize: 12, fontWeight: "700", textTransform: "uppercase" },
  summaryCard: { backgroundColor: "rgba(255, 248, 240, 0.92)", borderRadius: 24, padding: 18 },
  summaryTitle: { color: "#231712", fontSize: 24, fontWeight: "700", marginTop: 4 },
  toggleRow: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
});
