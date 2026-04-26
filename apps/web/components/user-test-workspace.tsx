"use client";

import {
  formatElapsedTime,
  type ObjectiveQuestion,
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
  history: TestHistoryEntry[];
  identifier: string;
  usingFallbackIdentifier: boolean;
};

type AttemptResponse = {
  attempt: {
    result: TestResult;
  };
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

type UserWorkspaceSection = "tests";

type ShuffledQuestion = {
  displayOptions: string[];
  originalOptionIndexes: number[];
  question: ObjectiveQuestion;
};

function hashSeed(input: string) {
  let hash = 0;

  for (let index = 0; index < input.length; index += 1) {
    hash = (hash * 31 + input.charCodeAt(index)) >>> 0;
  }

  return hash;
}

function createShuffledQuestion(
  question: ObjectiveQuestion,
  testId: string,
  participantIdentifier: string,
): ShuffledQuestion {
  const indexes = question.options.map((_, index) => index);
  let seed = hashSeed(`${testId}:${participantIdentifier}:${question.id}`);

  for (let currentIndex = indexes.length - 1; currentIndex > 0; currentIndex -= 1) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const swapIndex = seed % (currentIndex + 1);
    const nextIndexes = indexes[currentIndex];
    indexes[currentIndex] = indexes[swapIndex];
    indexes[swapIndex] = nextIndexes;
  }

  return {
    displayOptions: indexes.map((index) => question.options[index]),
    originalOptionIndexes: indexes,
    question,
  };
}

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
  const [history, setHistory] = useState<TestHistoryEntry[]>([]);
  const [identifier, setIdentifier] = useState(defaultParticipantIdentifier ?? "");
  const [isLoading, setIsLoading] = useState(false);
  const [openSection, setOpenSection] = useState<UserWorkspaceSection | null>("tests");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [participantNamesByTest, setParticipantNamesByTest] = useState<Record<string, string>>({});
  const [remainingMs, setRemainingMs] = useState<number | null>(null);
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
    ? activeTest.questions.map((question) =>
        createShuffledQuestion(question, activeTest.id, identifier || defaultParticipantIdentifier || "participant"),
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

  return (
    <div className="workspace-stack">
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
                <span className={`status-chip${remainingMs !== null && remainingMs <= 60_000 ? " warning" : " success"}`}>
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
                          {test.topPerformer ? (
                            <p className="muted-text">
                              Topper {test.topPerformer.participantName}: {test.topPerformer.correctCount}/{historyEntry.totalCount} in {formatElapsedTime(test.topPerformer.elapsedMs)}
                            </p>
                          ) : null}
                        </>
                      ) : (
                        <>
                          <p className="muted-text">This test is completed.</p>
                          {test.topPerformer ? (
                            <p className="muted-text">
                              Topper {test.topPerformer.participantName}: {test.topPerformer.correctCount}/{test.questionCount} in {formatElapsedTime(test.topPerformer.elapsedMs)}
                            </p>
                          ) : null}
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