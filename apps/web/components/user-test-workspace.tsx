"use client";

import {
  createPresentedQuestions,
  formatElapsedTime,
  type GroupJoinRequest,
  type ObjectiveQuestion,
  type ParticipantGroup,
  type TestHistoryEntry,
  type TestResult,
} from "@trapit/testing";
import { useEffect, useRef, useState } from "react";

import { formatShortDateTime } from "../lib/date-format";
import { CollapsibleWorkspaceSection } from "./collapsible-workspace-section";

type AvailableTest = {
  durationMinutes: number;
  hasAttempt: boolean;
  id: string;
  questionCount: number;
  questions: ObjectiveQuestion[];
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

type AttemptResponse = {
  attempt: {
    result: TestResult;
  };
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

const statusPriority: Record<AvailableTest["status"], number> = {
  live: 0,
  scheduled: 1,
  completed: 2,
};

type UserTestWorkspaceProps = {
  authConfigured: boolean;
  defaultParticipantIdentifier: string | null;
};

type UserWorkspaceSection = "groups" | "tests";

type ShuffledQuestion = {
  displayOptions: string[];
  originalOptionIndexes: number[];
  question: ObjectiveQuestion;
};

async function readJson<T>(response: Response): Promise<T> {
  const payload = (await response.json()) as T & { error?: string };

  if (!response.ok) {
    throw new Error((payload as { error?: string }).error ?? "Request failed.");
  }

  return payload;
}

export function UserTestWorkspace({
  authConfigured,
  defaultParticipantIdentifier,
}: UserTestWorkspaceProps) {
  const [activeTestId, setActiveTestId] = useState<string | null>(null);
  const [activeParticipantName, setActiveParticipantName] = useState("");
  const [answers, setAnswers] = useState<Record<string, number | undefined>>({});
  const [availableTests, setAvailableTests] = useState<AvailableTest[]>([]);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
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
  const [openSection, setOpenSection] = useState<UserWorkspaceSection | null>("tests");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [participantNamesByTest, setParticipantNamesByTest] = useState<Record<string, string>>({});
  const [remainingMs, setRemainingMs] = useState<number | null>(null);
  const [reviewByTestId, setReviewByTestId] = useState<Record<string, UserTestReviewResponse>>({});
  const [reviewLoadingByTestId, setReviewLoadingByTestId] = useState<Record<string, boolean>>({});
  const [visibleReviewTestIds, setVisibleReviewTestIds] = useState<string[]>([]);
  const [result, setResult] = useState<TestResult | null>(null);
  const [startedAt, setStartedAt] = useState<string | null>(null);
  const answersRef = useRef<Record<string, number | undefined>>({});
  const identifierRef = useRef(identifier);
  const isSubmittingRef = useRef(false);

  const activeTest = availableTests.find((test) => test.id === activeTestId) ?? null;
  const historyByTestId = new Map(history.map((entry) => [entry.testId, entry]));
  const sortedAvailableTests = [...availableTests].sort(
    (leftTest, rightTest) => {
      const priorityDifference =
        statusPriority[leftTest.status] - statusPriority[rightTest.status];

      if (priorityDifference !== 0) {
        return priorityDifference;
      }

      return new Date(rightTest.startsAt).getTime() - new Date(leftTest.startsAt).getTime();
    },
  );
  const shuffledQuestions = activeTest
    ? createPresentedQuestions(
        activeTest.questions,
        `${activeTest.id}:${identifier || defaultParticipantIdentifier || "participant"}`,
      ).map(
        (presentedQuestion) =>
          ({
            displayOptions: presentedQuestion.displayOptions,
            originalOptionIndexes: presentedQuestion.originalOptionIndexes,
            question: presentedQuestion.question,
          }) satisfies ShuffledQuestion,
      )
    : [];
  const activeQuestion =
    activeTest && currentQuestionIndex < shuffledQuestions.length
      ? shuffledQuestions[currentQuestionIndex]
      : null;

  useEffect(() => {
    answersRef.current = answers;
  }, [answers]);

  useEffect(() => {
    identifierRef.current = identifier;
  }, [identifier]);

  useEffect(() => {
    isSubmittingRef.current = isSubmitting;
  }, [isSubmitting]);

  async function loadDashboard(nextIdentifier?: string) {
    const participantIdentifier = (nextIdentifier ?? identifier).trim();

    if (!authConfigured && !participantIdentifier) {
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

      setAvailableTests(payload.availableTests);
      setGroupJoinRequests(payload.groupJoinRequests);
      setHistory(payload.history);
      setIdentifier(payload.identifier);
      setFeedback(null);
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Unable to load your assigned tests.");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    if (authConfigured && defaultParticipantIdentifier) {
      void loadDashboard(defaultParticipantIdentifier);
    }
  }, [authConfigured, defaultParticipantIdentifier]);

  function startTest(testId: string) {
    const participantName = participantNamesByTest[testId]?.trim() ?? "";

    if (!participantName) {
      setFeedback("Enter your name before starting the test.");
      return;
    }

    setActiveTestId(testId);
    setActiveParticipantName(participantName);
    setAnswers({});
    answersRef.current = {};
    setCurrentQuestionIndex(0);
    setResult(null);
    setStartedAt(new Date().toISOString());
    setRemainingMs(null);
    setFeedback(null);
    setOpenSection("tests");
  }

  function toggleSection(section: UserWorkspaceSection) {
    setOpenSection((currentSection) =>
      currentSection === section ? null : section,
    );
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

  async function submitTest(options?: { dueToTimer?: boolean }) {
    if (!activeTest || !startedAt || isSubmittingRef.current) {
      return;
    }

    setIsSubmitting(true);
    isSubmittingRef.current = true;

    try {
      const query = !authConfigured
        ? `?participantId=${encodeURIComponent(identifierRef.current)}`
        : "";
      const payload = await readJson<AttemptResponse>(
        await fetch(`/api/user/tests/${activeTest.id}/attempt${query}`, {
          body: JSON.stringify({
            answers: answersRef.current,
            completedAt: options?.dueToTimer
              ? new Date(
                  new Date(activeTest.startsAt).getTime() + activeTest.durationMinutes * 60 * 1000,
                ).toISOString()
              : new Date().toISOString(),
            participantName: activeParticipantName,
            startedAt,
          }),
          headers: {
            "Content-Type": "application/json",
          },
          method: "POST",
        }),
      );

      setResult(payload.attempt.result);
      setActiveTestId(null);
      setCurrentQuestionIndex(0);
      setActiveParticipantName("");
      setStartedAt(null);
      setRemainingMs(null);
      setAnswers({});
      answersRef.current = {};
      setFeedback(options?.dueToTimer ? "Time is up. Your test was submitted automatically." : null);
      await loadDashboard(identifierRef.current);
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Unable to submit this test.");
    } finally {
      setIsSubmitting(false);
      isSubmittingRef.current = false;
    }
  }

  useEffect(() => {
    if (!activeTest || !startedAt) {
      setRemainingMs(null);
      return;
    }

    const deadlineMs =
      new Date(activeTest.startsAt).getTime() + activeTest.durationMinutes * 60 * 1000;

    const tick = () => {
      const nextRemainingMs = Math.max(0, deadlineMs - Date.now());
      setRemainingMs(nextRemainingMs);

      if (nextRemainingMs === 0 && !isSubmittingRef.current) {
        void submitTest({ dueToTimer: true });
      }
    };

    tick();
    const intervalId = window.setInterval(tick, 1000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [activeTest, startedAt]);

  function handleSelectAnswer(questionId: string, originalOptionIndex: number) {
    const nextAnswers = {
      ...answersRef.current,
      [questionId]: originalOptionIndex,
    };

    answersRef.current = nextAnswers;
    setAnswers(nextAnswers);
    setFeedback(null);

    if (!activeTest) {
      return;
    }

    if (currentQuestionIndex >= activeTest.questions.length - 1) {
      setCurrentQuestionIndex(activeTest.questions.length);
      return;
    }

    setCurrentQuestionIndex((currentIndex) => currentIndex + 1);
  }

  function cancelActiveTest() {
    setActiveTestId(null);
    setAnswers({});
    answersRef.current = {};
    setActiveParticipantName("");
    setCurrentQuestionIndex(0);
    setStartedAt(null);
    setRemainingMs(null);
    setFeedback(null);
  }

  function formatCountdown(value: number | null) {
    if (value === null) {
      return "--:--";
    }

    const totalSeconds = Math.max(0, Math.ceil(value / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;

    return `${minutes}:${seconds.toString().padStart(2, "0")}`;
  }

  function getLatestGroupRequest(groupId: string) {
    return groupJoinRequests.find((request) => request.adminGroupId === groupId);
  }

  function formatAnswerLabel(optionIndex: number | undefined, options: string[]) {
    if (typeof optionIndex !== "number" || optionIndex < 0 || optionIndex >= options.length) {
      return "Not answered";
    }

    return `Option ${optionIndex + 1}: ${options[optionIndex]}`;
  }

  return (
    <div className="workspace-stack">
      <CollapsibleWorkspaceSection
        description="Search an admin by phone number and request access to their groups"
        eyebrow=""
        isOpen={openSection === "groups"}
        sectionId="user-group-requests"
        title="Join Groups"
        onToggle={() => toggleSection("groups")}
      >
        {authConfigured ? (
          <div className="form-stack">
            <div className="field-row align-end">
              <div className="field grow-field">
                <label htmlFor="admin-phone-search">Admin phone number</label>
                <input
                  id="admin-phone-search"
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
                    <article className="question-card nested-card" key={`group-search-${group.id}`}>
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

      <CollapsibleWorkspaceSection
        description="Live, Scheduled and Upcoming"
        eyebrow=""
        isOpen={openSection === "tests"}
        sectionId="user-assigned-tests"
        title="Assigned Tests"
        onToggle={() => toggleSection("tests")}
      >
        {!authConfigured ? (
          <div className="field-row align-end">
            <div className="field grow-field">
              <label htmlFor="participant-id">Your participant identifier</label>
              <input
                id="participant-id"
                placeholder="Use the same phone number, username, or roll number the admin assigned"
                value={identifier}
                onChange={(event) => setIdentifier(event.target.value)}
              />
            </div>
            <button className="button" type="button" onClick={() => void loadDashboard(identifier)}>
              Load my tests
            </button>
          </div>
        ) : null}

        {feedback ? <p className="muted-text">{feedback}</p> : null}

        {activeTest ? (
          <div className="question-list">
            <article className="question-card runner-summary-card">
              <div className="question-head">
                <strong>{activeTest.title}</strong>
                <span className="status-chip success">{activeTest.durationMinutes} min</span>
              </div>
              <div className="runner-meta-row">
                <span className="status-chip success">
                  Question {Math.min(currentQuestionIndex + 1, activeTest.questions.length)} of {activeTest.questions.length}
                </span>
                <span
                  className={`status-chip runner-countdown${remainingMs !== null && remainingMs <= 60_000 ? " warning" : " success"}`}
                >
                  Time left {formatCountdown(remainingMs)}
                </span>
              </div>
              <p className="muted-text">Each answer moves you straight to the next question.</p>
            </article>

            {activeQuestion ? (
              <article className="question-card" key={activeQuestion.question.id}>
                <div className="question-head">
                  <strong>Question {currentQuestionIndex + 1}</strong>
                  <span className="muted-text">{activeTest.questionCount - currentQuestionIndex - 1} remaining</span>
                </div>
                <p>{activeQuestion.question.prompt}</p>
                <div className="answer-grid">
                  {activeQuestion.displayOptions.map((option: string, optionIndex: number) => (
                    <label className="role-option" key={`${activeQuestion.question.id}-${optionIndex}`}>
                      <input
                        checked={answers[activeQuestion.question.id] === activeQuestion.originalOptionIndexes[optionIndex]}
                        name={activeQuestion.question.id}
                        type="radio"
                        onChange={() =>
                          handleSelectAnswer(
                            activeQuestion.question.id,
                            activeQuestion.originalOptionIndexes[optionIndex],
                          )
                        }
                      />
                      {option}
                    </label>
                  ))}
                </div>
              </article>
            ) : (
              <article className="question-card">
                <div className="question-head">
                  <strong>Ready to submit</strong>
                  <span className="status-chip success">{Object.keys(answers).length}/{activeTest.questionCount} answered</span>
                </div>
                <p className="muted-text">
                  You have answered all questions. Submit now to see your score and ranking.
                </p>
                <div className="inline-actions">
                  <button className="button" disabled={isSubmitting} type="button" onClick={() => void submitTest()}>
                    Submit test
                  </button>
                </div>
              </article>
            )}

            <div className="inline-actions">
              <button
                className="button-secondary"
                disabled={isSubmitting}
                type="button"
                onClick={cancelActiveTest}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : sortedAvailableTests.length ? (
          <div className="question-list">
            {sortedAvailableTests.map((test) => (
              (() => {
                const historyEntry = historyByTestId.get(test.id);
                const isCompleted = test.status === "completed";

                return (
                  <article className="question-card" key={test.id}>
                    <div className="question-head">
                      <strong>{test.title}</strong>
                      <span className={`status-chip ${test.status === "live" ? "success" : "warning"}`}>
                        {isCompleted
                          ? historyEntry?.status === "missed"
                            ? "missed"
                            : "completed"
                          : test.status}
                      </span>
                    </div>
                    <p className="muted-text">Starts {formatShortDateTime(test.startsAt)}</p>
                    <p className="muted-text">
                      {test.questionCount} questions, {test.durationMinutes} minutes
                    </p>

                    {isCompleted ? (
                      historyEntry?.status === "missed" ? (
                        <>
                          <p className="muted-text">This test closed without a submission.</p>
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
                        </>
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
                          {test.topPerformer ? (
                            <p className="muted-text">
                              Topper {test.topPerformer.participantName}: {test.topPerformer.correctCount}/{historyEntry.totalCount} in {formatElapsedTime(test.topPerformer.elapsedMs)}
                            </p>
                          ) : null}
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
                        </>
                      ) : (
                        <>
                          <p className="muted-text">This test is completed.</p>
                          {test.topPerformer ? (
                            <p className="muted-text">
                              Topper {test.topPerformer.participantName}: {test.topPerformer.correctCount}/{test.questionCount} in {formatElapsedTime(test.topPerformer.elapsedMs)}
                            </p>
                          ) : null}
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
                        </>
                      )
                    ) : (
                      <>
                        <div className="field">
                          <label htmlFor={`participant-name-${test.id}`}>Your name for this test</label>
                          <input
                            id={`participant-name-${test.id}`}
                            placeholder="Enter your name before starting"
                            value={participantNamesByTest[test.id] ?? ""}
                            onChange={(event) =>
                              setParticipantNamesByTest((current) => ({
                                ...current,
                                [test.id]: event.target.value,
                              }))
                            }
                          />
                        </div>
                        <div className="inline-actions">
                          <button
                            className="button"
                            disabled={test.status !== "live" || test.hasAttempt || !(participantNamesByTest[test.id] ?? "").trim()}
                            type="button"
                            onClick={() => startTest(test.id)}
                          >
                            {test.hasAttempt
                              ? "Already submitted"
                              : test.status === "scheduled"
                                ? "Not live yet"
                                : "Start test"}
                          </button>
                        </div>
                      </>
                    )}

                    {visibleReviewTestIds.includes(test.id) && reviewByTestId[test.id] ? (
                      <div className="review-list">
                        {reviewByTestId[test.id].review.map((question, reviewIndex) => (
                          <article className="question-card nested-card" key={`${test.id}-review-${question.questionId}`}>
                            <div className="question-head">
                              <strong>Question {reviewIndex + 1}</strong>
                              <span className="status-chip success">
                                Correct option {question.correctOptionIndex + 1}
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
                            <p className="muted-text">
                              Your response: {formatAnswerLabel(question.selectedOptionIndex, question.options)}
                            </p>
                          </article>
                        ))}
                      </div>
                    ) : null}
                  </article>
                );
              })()
            ))}
          </div>
        ) : isLoading ? (
          <div className="empty-state">
            <p className="muted-text">Loading your assigned tests...</p>
          </div>
        ) : (
          <div className="empty-state">
            <p className="muted-text">No assigned tests are available for this user yet.</p>
          </div>
        )}

        {result ? (
          <section className="result-panel">
            <h3>Latest result</h3>
            <p className="muted-text">
              Correct answers: <strong>{result.correctCount}</strong> out of {result.totalCount}
            </p>
            <p className="muted-text">
              Attempted: <strong>{result.attemptedCount}</strong>
            </p>
            <p className="muted-text">
              Time taken: <strong>{formatElapsedTime(result.elapsedMs)}</strong>
            </p>
            {typeof result.rank === "number" ? (
              <p className="muted-text">
                Rank: <strong>{result.rank}</strong>
                {typeof result.rankedParticipantCount === "number"
                  ? ` of ${result.rankedParticipantCount} submitted`
                  : ""}
                {typeof result.assignedParticipantCount === "number"
                  ? ` (${result.assignedParticipantCount} assigned)`
                  : ""}
              </p>
            ) : null}
          </section>
        ) : null}
      </CollapsibleWorkspaceSection>
    </div>
  );
}