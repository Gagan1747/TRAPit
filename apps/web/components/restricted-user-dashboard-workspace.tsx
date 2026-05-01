"use client";

import {
  formatElapsedTime,
  type GroupJoinRequest,
  type ParticipantGroup,
  type ScheduledPoll,
  type TestHistoryEntry,
} from "@trapit/testing";
import { useEffect, useState } from "react";

import { formatShortDateTime } from "../lib/date-format";
import { CollapsibleWorkspaceSection } from "./collapsible-workspace-section";

type AvailableTest = {
  durationMinutes: number;
  hasAttempt: boolean;
  id: string;
  questionCount: number;
  startsAt: string;
  status: "completed" | "live" | "scheduled";
  title: string;
  topPerformer?: {
    correctCount: number;
    elapsedMs: number;
    participantName: string;
  };
};

type DashboardResponse = {
  availablePolls: ScheduledPoll[];
  availableTests: AvailableTest[];
  groupJoinRequests: GroupJoinRequest[];
  history: TestHistoryEntry[];
  identifier: string;
  usingFallbackIdentifier: boolean;
};

type GroupSearchResponse = {
  groupJoinRequests: GroupJoinRequest[];
  participantGroups: ParticipantGroup[];
};

type UserTestReviewResponse = {
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

type RestrictedUserDashboardWorkspaceProps = {
  authConfigured: boolean;
  defaultParticipantIdentifier: string | null;
};

type UserDashboardSection = "history" | "join-groups";
type RestrictedMenuGroup = "groups" | "poll" | "test";
type ResultsMode = "polls" | "tests";
type ResultsFilter = "admin" | "both" | "participant";

const statusPriority: Record<AvailableTest["status"], number> = {
  live: 0,
  scheduled: 1,
  completed: 2,
};

async function readJson<T>(response: Response): Promise<T> {
  const payload = (await response.json()) as T & { error?: string };

  if (!response.ok) {
    throw new Error((payload as { error?: string }).error ?? "Request failed.");
  }

  return payload;
}

export function RestrictedUserDashboardWorkspace({
  authConfigured,
  defaultParticipantIdentifier,
}: RestrictedUserDashboardWorkspaceProps) {
  const [availablePolls, setAvailablePolls] = useState<ScheduledPoll[]>([]);
  const [availableTests, setAvailableTests] = useState<AvailableTest[]>([]);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [groupJoinRequests, setGroupJoinRequests] = useState<GroupJoinRequest[]>([]);
  const [groupSearchFeedback, setGroupSearchFeedback] = useState<string | null>(null);
  const [groupSearchPhoneNumber, setGroupSearchPhoneNumber] = useState("");
  const [groupSearchResults, setGroupSearchResults] = useState<ParticipantGroup[]>([]);
  const [history, setHistory] = useState<TestHistoryEntry[]>([]);
  const [identifier, setIdentifier] = useState(defaultParticipantIdentifier ?? "");
  const [isLoading, setIsLoading] = useState(false);
  const [isSearchingGroups, setIsSearchingGroups] = useState(false);
  const [isSendingGroupRequest, setIsSendingGroupRequest] = useState<string | null>(null);
  const [lockedFeatureMessage, setLockedFeatureMessage] = useState<string | null>(null);
  const [openSection, setOpenSection] = useState<UserDashboardSection | null>("history");
  const [isMenuCollapsed, setIsMenuCollapsed] = useState(false);
  const [openMenuGroup, setOpenMenuGroup] = useState<RestrictedMenuGroup | null>(null);
  const [resultFilter, setResultFilter] = useState<ResultsFilter>("both");
  const [resultsMode, setResultsMode] = useState<ResultsMode>("tests");
  const [reviewByTestId, setReviewByTestId] = useState<Record<string, UserTestReviewResponse>>({});
  const [reviewLoadingByTestId, setReviewLoadingByTestId] = useState<Record<string, boolean>>({});
  const [visibleReviewTestIds, setVisibleReviewTestIds] = useState<string[]>([]);

  const historyByTestId = new Map(history.map((entry) => [entry.testId, entry]));
  const sortedAvailableTests = [...availableTests].sort((leftTest, rightTest) => {
    const priorityDifference = statusPriority[leftTest.status] - statusPriority[rightTest.status];

    if (priorityDifference !== 0) {
      return priorityDifference;
    }

    return new Date(rightTest.startsAt).getTime() - new Date(leftTest.startsAt).getTime();
  });
  const sortedAvailablePolls = [...availablePolls].sort((leftPoll, rightPoll) => {
    const priorityDifference = statusPriority[leftPoll.status] - statusPriority[rightPoll.status];

    if (priorityDifference !== 0) {
      return priorityDifference;
    }

    return new Date(rightPoll.startsAt).getTime() - new Date(leftPoll.startsAt).getTime();
  });
  const filteredAvailableTests = resultFilter === "admin" ? [] : sortedAvailableTests;
  const filteredAvailablePolls = resultFilter === "admin" ? [] : sortedAvailablePolls;
  const pendingGroupRequestsCount = groupJoinRequests.filter((request) => request.status === "pending").length;
  const completedTestsCount = sortedAvailableTests.filter((test) => test.status === "completed").length;
  const liveTestsCount = sortedAvailableTests.filter((test) => test.status === "live").length;

  async function loadDashboard(nextIdentifier?: string) {
    const participantIdentifier = (nextIdentifier ?? identifier).trim();

    if (!authConfigured && !participantIdentifier) {
      setAvailablePolls([]);
      setAvailableTests([]);
      setHistory([]);
      return;
    }

    setIsLoading(true);

    try {
      const query = !authConfigured
        ? `?participantId=${encodeURIComponent(participantIdentifier)}`
        : "";
      const payload = await readJson<DashboardResponse>(
        await fetch(`/api/user/dashboard${query}`),
      );

      setAvailablePolls(payload.availablePolls);
      setAvailableTests(payload.availableTests);
      setGroupJoinRequests(payload.groupJoinRequests);
      setHistory(payload.history);
      setIdentifier(payload.identifier);
      setFeedback(null);
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Unable to load your dashboard.");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    if (authConfigured && defaultParticipantIdentifier) {
      void loadDashboard(defaultParticipantIdentifier);
    }
  }, [authConfigured, defaultParticipantIdentifier]);

  function toggleSection(section: UserDashboardSection) {
    setOpenSection((currentSection) => (currentSection === section ? null : section));
  }

  function openLockedFeatureModal() {
    setLockedFeatureMessage("Get TRAPit Pro to access this feature");
  }

  function isMenuGroupActive(group: RestrictedMenuGroup) {
    return group === "groups" && openSection === "join-groups";
  }

  function renderMenuItem(label: string, section?: UserDashboardSection) {
    const isActive = Boolean(section && openSection === section);

    return (
      <button
        key={`${label}-${section ?? "disabled"}`}
        className={`admin-menu-item${isActive ? " is-active" : ""}${section ? "" : " is-disabled"}`}
        type="button"
        onClick={section ? () => setOpenSection(section) : openLockedFeatureModal}
      >
        {label}
      </button>
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
      <div className="admin-menu-group" key={group}>
        <button
          aria-expanded={isOpen}
          className={`admin-menu-group-toggle${isOpen || isActive ? " is-active" : ""}`}
          type="button"
          onClick={() => setOpenMenuGroup((currentGroup) => (currentGroup === group ? null : group))}
        >
          <span>{label}</span>
          <span className="admin-menu-group-toggle-symbol">{isOpen ? "-" : "+"}</span>
        </button>
        {isOpen ? <div className="admin-menu-substack">{items.map((item) => renderMenuItem(item.label, item.section))}</div> : null}
      </div>
    );
  }

  function getLatestGroupRequest(groupId: string) {
    return groupJoinRequests.find((request) => request.adminGroupId === groupId);
  }

  function toggleReviewVisibility(testId: string) {
    setVisibleReviewTestIds((currentIds) =>
      currentIds.includes(testId)
        ? currentIds.filter((currentId) => currentId !== testId)
        : [...currentIds, testId],
    );
  }

  async function handleLoadReview(testId: string) {
    if (reviewByTestId[testId]) {
      toggleReviewVisibility(testId);
      return;
    }

    setReviewLoadingByTestId((currentState) => ({
      ...currentState,
      [testId]: true,
    }));

    try {
      const payload = await readJson<UserTestReviewResponse>(
        await fetch(`/api/user/tests/${testId}/review`),
      );

      setReviewByTestId((currentReviews) => ({
        ...currentReviews,
        [testId]: payload,
      }));
      setVisibleReviewTestIds((currentIds) => [...new Set([...currentIds, testId])]);
      setFeedback(null);
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Unable to load the test review.");
    } finally {
      setReviewLoadingByTestId((currentState) => ({
        ...currentState,
        [testId]: false,
      }));
    }
  }

  async function handleSearchGroups() {
    if (!groupSearchPhoneNumber.trim()) {
      setGroupSearchFeedback("Enter the admin phone number to search for groups.");
      setGroupSearchResults([]);
      return;
    }

    setIsSearchingGroups(true);

    try {
      const payload = await readJson<GroupSearchResponse>(
        await fetch(`/api/user/groups?phone=${encodeURIComponent(groupSearchPhoneNumber.trim())}`),
      );

      setGroupSearchResults(payload.participantGroups);
      setGroupJoinRequests(payload.groupJoinRequests);
      setGroupSearchFeedback(
        payload.participantGroups.length
          ? null
          : "No groups were found for that admin phone number.",
      );
    } catch (error) {
      setGroupSearchResults([]);
      setGroupSearchFeedback(
        error instanceof Error ? error.message : "Unable to search for admin groups.",
      );
    } finally {
      setIsSearchingGroups(false);
    }
  }

  async function handleRequestGroup(groupId: string) {
    setIsSendingGroupRequest(groupId);

    try {
      const payload = await readJson<{ groupJoinRequests: GroupJoinRequest[] }>(
        await fetch("/api/user/groups", {
          body: JSON.stringify({ adminGroupId: groupId }),
          headers: {
            "Content-Type": "application/json",
          },
          method: "POST",
        }),
      );

      setGroupJoinRequests(payload.groupJoinRequests);
      setGroupSearchFeedback("Request sent to the admin for review.");
    } catch (error) {
      setGroupSearchFeedback(
        error instanceof Error ? error.message : "Unable to send the group request.",
      );
    } finally {
      setIsSendingGroupRequest(null);
    }
  }

  return (
    <div className="workspace-stack">
      <section className="panel workspace-card">
        <div className="section-head compact-head">
          <div>
            <p className="eyebrow">Web user rollout</p>
            <h2 className="section-title">Questions, Test, Results</h2>
          </div>
        </div>

        <div className="metric-row">
          <div className="metric-card">
            <strong>{availableTests.length}</strong>
            <span>tests</span>
          </div>
          <div className="metric-card">
            <strong>{availablePolls.length}</strong>
            <span>polls</span>
          </div>
          <div className="metric-card">
            <strong>{liveTestsCount}</strong>
            <span>test live</span>
          </div>
          <div className="metric-card">
            <strong>{groupJoinRequests.length}</strong>
            <span>group requests</span>
          </div>
          <div className="metric-card">
            <strong>{pendingGroupRequestsCount}</strong>
            <span>pending</span>
          </div>
          <div className="metric-card">
            <strong>{completedTestsCount}</strong>
            <span>test completed</span>
          </div>
        </div>
      </section>

      <div className={`admin-shell${isMenuCollapsed ? " is-menu-collapsed" : ""}`}>
        <aside className={`admin-menu panel workspace-card${isMenuCollapsed ? " is-collapsed" : ""}`}>
          <div className="section-head compact-head">
            <div>
              <p className="eyebrow">Workspace menu</p>
              <h2 className="section-title">User navigation</h2>
            </div>
            <button
              aria-expanded={!isMenuCollapsed}
              className="button-secondary small-button admin-menu-toggle"
              type="button"
              onClick={() => setIsMenuCollapsed((currentValue) => !currentValue)}
            >
              {isMenuCollapsed ? "Show menu" : "Hide menu"}
            </button>
          </div>

          {isMenuCollapsed ? (
            <p className="muted-text admin-menu-collapsed-copy">Navigation is hidden. Expand the menu to switch sections.</p>
          ) : (
          <div className="admin-menu-stack">
            <div className="admin-menu-group">
              {renderMenuItem("Home", "history")}
            </div>
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
          </div>
          )}
        </aside>

        <div className="admin-main-column">
          <CollapsibleWorkspaceSection
            eyebrow=""
            isOpen={openSection === "history"}
            sectionId="user-dashboard-results"
            title="Results"
            onToggle={() => toggleSection("history")}
          >
            <div className="form-stack">
              {!authConfigured ? (
                <div className="field-row align-end">
                  <div className="field grow-field">
                    <label htmlFor="restricted-user-participant-id">Your participant identifier</label>
                    <input
                      id="restricted-user-participant-id"
                      placeholder="Use the same phone number, username, or roll number the admin assigned"
                      value={identifier}
                      onChange={(event) => setIdentifier(event.target.value)}
                    />
                  </div>
                  <button className="button" type="button" onClick={() => void loadDashboard(identifier)}>
                    Load dashboard
                  </button>
                </div>
              ) : null}

              {feedback ? <p className="muted-text">{feedback}</p> : null}
              {isLoading ? <p className="muted-text">Loading your dashboard...</p> : null}

              <div aria-label="Results mode" className="segmented-control" role="group">
                <button
                  aria-pressed={resultsMode === "tests"}
                  className={`segmented-control-item${resultsMode === "tests" ? " is-active" : ""}`}
                  type="button"
                  onClick={() => setResultsMode("tests")}
                >
                  Test results
                </button>
                <button
                  aria-pressed={resultsMode === "polls"}
                  className={`segmented-control-item${resultsMode === "polls" ? " is-active" : ""}`}
                  type="button"
                  onClick={() => setResultsMode("polls")}
                >
                  Poll results
                </button>
              </div>

              <div aria-label="Results scope" className="segmented-control segmented-control-wide" role="group">
                <button
                  aria-pressed={resultFilter === "admin"}
                  className={`segmented-control-item${resultFilter === "admin" ? " is-active" : ""}`}
                  type="button"
                  onClick={() => setResultFilter("admin")}
                >
                  {resultsMode === "tests" ? "Scheduled as admin" : "Poll created as admin"}
                </button>
                <button
                  aria-pressed={resultFilter === "both"}
                  className={`segmented-control-item${resultFilter === "both" ? " is-active" : ""}`}
                  type="button"
                  onClick={() => setResultFilter("both")}
                >
                  Both
                </button>
                <button
                  aria-pressed={resultFilter === "participant"}
                  className={`segmented-control-item${resultFilter === "participant" ? " is-active" : ""}`}
                  type="button"
                  onClick={() => setResultFilter("participant")}
                >
                  {resultsMode === "tests" ? "Attended as participant" : "Poll responded as participant"}
                </button>
              </div>

              {resultsMode === "tests" ? (
                filteredAvailableTests.length ? (
                  <div className="question-list">
                    {filteredAvailableTests.map((test) => {
                      const historyEntry = historyByTestId.get(test.id);
                      const isCompleted = test.status === "completed";

                      return (
                        <article className="question-card" key={test.id}>
                          <div className="question-head">
                            <strong>{test.title}</strong>
                            <div className="inline-actions">
                              <span className="status-chip success">Participant</span>
                              <span className={`status-chip ${test.status === "live" ? "success" : "warning"}`}>
                                {isCompleted
                                  ? historyEntry?.status === "missed"
                                    ? "missed"
                                    : "completed"
                                  : test.status}
                              </span>
                            </div>
                          </div>
                          <p className="muted-text">Starts: {formatShortDateTime(test.startsAt)}</p>
                          <p className="muted-text">Duration: {test.durationMinutes} min</p>
                          <p className="muted-text">Questions: {test.questionCount}</p>

                          {isCompleted ? (
                            historyEntry?.status === "missed" ? (
                              <p className="muted-text">This test closed without a submission.</p>
                            ) : historyEntry ? (
                              <>
                                <p className="muted-text">
                                  Submitted as {historyEntry.participantName?.trim() || historyEntry.participantId}
                                </p>
                                <p className="muted-text">
                                  Score {historyEntry.correctCount}/{historyEntry.totalCount}
                                </p>
                                <p className="muted-text">Time taken {formatElapsedTime(historyEntry.elapsedMs)}</p>
                                {typeof historyEntry.rank === "number" ? (
                                  <p className="muted-text">Rank {historyEntry.rank}</p>
                                ) : null}
                              </>
                            ) : (
                              <p className="muted-text">No participant submission was recorded for this test.</p>
                            )
                          ) : test.status === "live" ? (
                            <p className="muted-text">This test is live now.</p>
                          ) : (
                            <p className="muted-text">This test has not started yet.</p>
                          )}

                          {test.topPerformer ? (
                            <p className="muted-text">
                              Topper {test.topPerformer.participantName}: {test.topPerformer.correctCount}/{test.questionCount} in {formatElapsedTime(test.topPerformer.elapsedMs)}
                            </p>
                          ) : null}

                          {isCompleted ? (
                            <div className="form-stack">
                              <div className="inline-actions">
                                <button
                                  className="button-secondary small-button"
                                  disabled={reviewLoadingByTestId[test.id]}
                                  type="button"
                                  onClick={() => void handleLoadReview(test.id)}
                                >
                                  {reviewLoadingByTestId[test.id]
                                    ? "Loading..."
                                    : visibleReviewTestIds.includes(test.id)
                                      ? "Hide review"
                                      : "Review questions"}
                                </button>
                              </div>

                              {visibleReviewTestIds.includes(test.id) && reviewByTestId[test.id] ? (
                                <div className="review-list">
                                  {reviewByTestId[test.id].review.map((question, questionIndex) => (
                                    <article className="question-card nested-card" key={`${test.id}-${question.questionId}`}>
                                      <div className="question-head">
                                        <strong>Question {questionIndex + 1}</strong>
                                        <span className="status-chip success">
                                          {question.selectedOptionIndex === question.correctOptionIndex ? "Correct" : "Review"}
                                        </span>
                                      </div>
                                      <p>{question.prompt}</p>
                                      <ol className="question-options compact-question-options">
                                        {question.options.map((option, optionIndex) => (
                                          <li key={`${question.questionId}-${optionIndex}`}>
                                            {option}
                                            {optionIndex === question.correctOptionIndex ? " (correct)" : ""}
                                            {optionIndex === question.selectedOptionIndex ? " (your answer)" : ""}
                                          </li>
                                        ))}
                                      </ol>
                                    </article>
                                  ))}
                                </div>
                              ) : null}
                            </div>
                          ) : null}
                        </article>
                      );
                    })}
                  </div>
                ) : (
                  <div className="empty-state">
                    <p className="muted-text">No tests match this view yet.</p>
                  </div>
                )
              ) : filteredAvailablePolls.length ? (
                <div className="question-list">
                  {filteredAvailablePolls.map((poll) => (
                    <article className="question-card" key={poll.id}>
                      <div className="question-head">
                        <strong>{poll.title}</strong>
                        <div className="inline-actions">
                          <span className="status-chip success">Participant</span>
                          <span className={`status-chip ${poll.status === "live" ? "success" : "warning"}`}>
                            {poll.status}
                          </span>
                        </div>
                      </div>
                      <p className="muted-text">Starts: {formatShortDateTime(poll.startsAt)}</p>
                      <p className="muted-text">Duration: {poll.durationMinutes} min</p>
                      <p className="muted-text">Questions: {poll.questionIds.length}</p>
                      <p className="muted-text">Participant type: {poll.participantType === "registered" ? "Registered only" : "Open to all"}</p>
                      <p className="muted-text">Anonymity: {poll.anonymous ? "Anonymous" : "Named"}</p>
                      {poll.shareCode ? <p className="muted-text">Access code: {poll.shareCode}</p> : null}
                      {poll.status === "completed" ? (
                        <p className="muted-text">Poll response summaries will appear here when participant poll submissions are recorded.</p>
                      ) : poll.status === "live" ? (
                        <p className="muted-text">This poll is live now.</p>
                      ) : (
                        <p className="muted-text">This poll has not started yet.</p>
                      )}
                    </article>
                  ))}
                </div>
              ) : (
                <div className="empty-state">
                  <p className="muted-text">No polls match this view yet.</p>
                </div>
              )}
            </div>
          </CollapsibleWorkspaceSection>

          <CollapsibleWorkspaceSection
            description="Search an admin by phone number and request access to their groups"
            eyebrow=""
            isOpen={openSection === "join-groups"}
            sectionId="restricted-user-group-requests"
            title="Join Groups"
            onToggle={() => toggleSection("join-groups")}
          >
            {authConfigured ? (
              <div className="form-stack">
                <div className="field-row align-end">
                  <div className="field grow-field">
                    <label htmlFor="restricted-admin-phone-search">Admin phone number</label>
                    <input
                      id="restricted-admin-phone-search"
                      placeholder="Search using the admin account phone number"
                      value={groupSearchPhoneNumber}
                      onChange={(event) => setGroupSearchPhoneNumber(event.target.value)}
                    />
                  </div>
                  <button className="button" disabled={isSearchingGroups} type="button" onClick={() => void handleSearchGroups()}>
                    {isSearchingGroups ? "Searching..." : "Search groups"}
                  </button>
                </div>

                {groupSearchFeedback ? <p className="muted-text">{groupSearchFeedback}</p> : null}

                {groupSearchResults.length ? (
                  <div className="question-list">
                    {groupSearchResults.map((group) => {
                      const latestRequest = getLatestGroupRequest(group.id);

                      return (
                        <article className="question-card nested-card" key={`restricted-group-search-${group.id}`}>
                          <div className="question-head">
                            <strong>{group.name}</strong>
                            {latestRequest ? (
                              <span className={`status-chip ${latestRequest.status === "accepted" ? "success" : latestRequest.status === "rejected" ? "warning" : ""}`}>
                                {latestRequest.status}
                              </span>
                            ) : null}
                          </div>
                          <p className="muted-text">{group.participantIds.length} current member{group.participantIds.length === 1 ? "" : "s"}</p>
                          <div className="inline-actions">
                            <button
                              className="button"
                              disabled={Boolean(latestRequest) || isSendingGroupRequest === group.id}
                              type="button"
                              onClick={() => void handleRequestGroup(group.id)}
                            >
                              {isSendingGroupRequest === group.id
                                ? "Sending..."
                                : latestRequest
                                  ? latestRequest.status === "pending"
                                    ? "Request pending"
                                    : latestRequest.status === "accepted"
                                      ? "Request accepted"
                                      : "Request sent"
                                  : "Request access"}
                            </button>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                ) : null}

                {groupJoinRequests.length ? (
                  <div className="question-card">
                    <div className="question-head">
                      <strong>Your latest group requests</strong>
                      <span className="status-chip success">{groupJoinRequests.length}</span>
                    </div>
                    <div className="request-list">
                      {groupJoinRequests.map((request) => (
                        <article className="request-card" key={request.id}>
                          <strong>{request.adminGroupName}</strong>
                          <p className="muted-text">Requested as {request.requesterLabel}</p>
                          <p className="muted-text">Requested {formatShortDateTime(request.requestedAt)}</p>
                          <span className={`status-chip ${request.status === "accepted" ? "success" : request.status === "rejected" ? "warning" : ""}`}>
                            {request.status}
                          </span>
                        </article>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="empty-state">
                <p className="muted-text">Group requests require a signed-in account.</p>
              </div>
            )}
          </CollapsibleWorkspaceSection>
        </div>
      </div>

      {lockedFeatureMessage ? (
        <div className="soft-modal-overlay" role="presentation" onClick={() => setLockedFeatureMessage(null)}>
          <div
            aria-modal="true"
            className="soft-modal-card panel"
            role="dialog"
            onClick={(event) => event.stopPropagation()}
          >
            <p className="eyebrow">Locked feature</p>
            <h2 className="section-title">TRAPit Pro</h2>
            <p className="muted-text">{lockedFeatureMessage}</p>
            <div className="inline-actions">
              <button className="button" type="button" onClick={() => setLockedFeatureMessage(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}