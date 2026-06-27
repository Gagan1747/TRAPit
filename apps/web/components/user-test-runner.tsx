"use client";

import {
  createPresentedQuestions,
  formatElapsedTime,
  type GroupJoinRequest,
  type ObjectiveQuestion,
  type TestHistoryEntry,
  type TestResult,
  type WorkspaceBranding,
} from "@trapit/testing";
import { useEffect, useRef, useState } from "react";

import { formatShortDateTime } from "../lib/date-format";

type AvailableTest = {
  branding?: WorkspaceBranding | null;
  durationMinutes: number;
  hasAttempt: boolean;
  id: string;
  questionCount: number;
  questions: ObjectiveQuestion[];
  startsAt: string;
  status: "completed" | "live" | "scheduled";
  title: string;
};

type DashboardResponse = {
  availableTests: AvailableTest[];
  groupJoinRequests: GroupJoinRequest[];
  history: TestHistoryEntry[];
  identifier: string;
  usingFallbackIdentifier: boolean;
};

type AttemptResponse = {
  attempt: {
    result: TestResult;
  };
  resultReleaseAt: string | null;
  resultReleased: boolean;
};

type ShuffledQuestion = {
  displayOptions: string[];
  originalOptionIndexes: number[];
  question: ObjectiveQuestion;
};

type UserTestRunnerProps = {
  authConfigured: boolean;
  defaultParticipantIdentifier: string | null;
  initialParticipantName: string;
  testId: string;
};

async function readJson<T>(response: Response): Promise<T> {
  const payload = (await response.json()) as T & { error?: string };

  if (!response.ok) {
    throw new Error((payload as { error?: string }).error ?? "Request failed.");
  }

  return payload;
}

export function UserTestRunner({
  authConfigured,
  defaultParticipantIdentifier,
  initialParticipantName,
  testId,
}: UserTestRunnerProps) {
  const [answers, setAnswers] = useState<Record<string, number | undefined>>({});
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [identifier, setIdentifier] = useState(defaultParticipantIdentifier ?? "");
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [participantName, setParticipantName] = useState(initialParticipantName);
  const [remainingMs, setRemainingMs] = useState<number | null>(null);
  const [result, setResult] = useState<TestResult | null>(null);
  const [resultReleaseAt, setResultReleaseAt] = useState<string | null>(null);
  const [resultReleased, setResultReleased] = useState(false);
  const [startedAt, setStartedAt] = useState<string | null>(null);
  const [test, setTest] = useState<AvailableTest | null>(null);
  const answersRef = useRef<Record<string, number | undefined>>({});
  const identifierRef = useRef(identifier);
  const isSubmittingRef = useRef(false);

  const shuffledQuestions = test
    ? createPresentedQuestions(
      test.questions,
      `${test.id}:${identifier || defaultParticipantIdentifier || "participant"}`,
    ).map(
      (presentedQuestion) =>
        ({
          displayOptions: presentedQuestion.displayOptions,
          originalOptionIndexes: presentedQuestion.originalOptionIndexes,
          question: presentedQuestion.question,
        }) satisfies ShuffledQuestion,
    )
    : [];
  const activeQuestion = test && currentQuestionIndex < shuffledQuestions.length
    ? shuffledQuestions[currentQuestionIndex]
    : null;
  const answeredCount = test
    ? test.questions.filter((question) => typeof answers[question.id] === "number").length
    : 0;

  useEffect(() => {
    answersRef.current = answers;
  }, [answers]);

  useEffect(() => {
    identifierRef.current = identifier;
  }, [identifier]);

  useEffect(() => {
    isSubmittingRef.current = isSubmitting;
  }, [isSubmitting]);

  useEffect(() => {
    let isMounted = true;

    async function loadTest() {
      setIsLoading(true);

      try {
        const query = !authConfigured && identifierRef.current
          ? `?participantId=${encodeURIComponent(identifierRef.current)}`
          : "";
        const payload = await readJson<DashboardResponse>(
          await fetch(`/api/user/dashboard${query}`),
        );
        const selectedTest = payload.availableTests.find((entry) => entry.id === testId) ?? null;

        if (!isMounted) {
          return;
        }

        setIdentifier(payload.identifier);
        setTest(selectedTest);
        setFeedback(
          !selectedTest
            ? "This test is not available for your account."
            : selectedTest.hasAttempt
              ? "This test has already been submitted."
              : selectedTest.status === "scheduled"
                ? "This test is not live yet."
                : selectedTest.status === "completed"
                  ? "This test is no longer accepting responses."
                  : null,
        );
        setStartedAt(
          selectedTest && selectedTest.status === "live" && !selectedTest.hasAttempt
            ? new Date().toISOString()
            : null,
        );
      } catch (error) {
        if (isMounted) {
          setFeedback(error instanceof Error ? error.message : "Unable to load this test.");
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    void loadTest();

    return () => {
      isMounted = false;
    };
  }, [authConfigured, testId]);

  async function submitTest(options?: { dueToTimer?: boolean }) {
    if (!test || !startedAt || isSubmittingRef.current) {
      return;
    }

    if (!participantName.trim()) {
      setFeedback("Enter your name before submitting the test.");
      return;
    }

    setIsSubmitting(true);
    isSubmittingRef.current = true;

    try {
      const query = !authConfigured
        ? `?participantId=${encodeURIComponent(identifierRef.current)}`
        : "";
      const payload = await readJson<AttemptResponse>(
        await fetch(`/api/user/tests/${test.id}/attempt${query}`, {
          body: JSON.stringify({
            answers: answersRef.current,
            completedAt: options?.dueToTimer
              ? new Date(
                new Date(test.startsAt).getTime() + test.durationMinutes * 60 * 1000,
              ).toISOString()
              : new Date().toISOString(),
            participantName,
            startedAt,
          }),
          headers: {
            "Content-Type": "application/json",
          },
          method: "POST",
        }),
      );

      setResult(payload.resultReleased ? payload.attempt.result : null);
      setResultReleased(payload.resultReleased);
      setResultReleaseAt(payload.resultReleaseAt);
      setStartedAt(null);
      setRemainingMs(null);
      setFeedback(
        payload.resultReleased
          ? options?.dueToTimer
            ? "Time is up. Your test was submitted automatically."
            : "Your test has been submitted."
          : `Your test has been submitted. Results will be released after ${formatShortDateTime(payload.resultReleaseAt ?? test.startsAt)}.`,
      );
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Unable to submit this test.");
    } finally {
      setIsSubmitting(false);
      isSubmittingRef.current = false;
    }
  }

  useEffect(() => {
    if (!test || !startedAt) {
      setRemainingMs(null);
      return;
    }

    const deadlineMs = new Date(test.startsAt).getTime() + test.durationMinutes * 60 * 1000;

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
  }, [startedAt, test]);

  function handleSelectAnswer(questionId: string, originalOptionIndex: number) {
    const nextAnswers = {
      ...answersRef.current,
      [questionId]: originalOptionIndex,
    };

    answersRef.current = nextAnswers;
    setAnswers(nextAnswers);
    setFeedback(null);
  }

  function goToPreviousQuestion() {
    setCurrentQuestionIndex((currentIndex) => Math.max(currentIndex - 1, 0));
    setFeedback(null);
  }

  function goToNextQuestion() {
    if (!test) {
      return;
    }

    setCurrentQuestionIndex((currentIndex) => Math.min(currentIndex + 1, Math.max(test.questions.length - 1, 0)));
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

  if (isLoading) {
    return (
      <div className="empty-state">
        <p className="muted-text">Loading test...</p>
      </div>
    );
  }

  if (!test || test.status !== "live" || test.hasAttempt || result || !startedAt) {
    return (
      <div className="workspace-card-stack">
        <section className="workspace-card">
          <p className="eyebrow">Test response</p>
          <h1>{test?.title ?? "Test unavailable"}</h1>
          {feedback ? <p className="muted-text">{feedback}</p> : null}
          {!resultReleased && resultReleaseAt ? (
            <p className="muted-text">Results release after {formatShortDateTime(resultReleaseAt)}.</p>
          ) : null}
          {result ? (
            <section className="result-panel">
              <h3>Result</h3>
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
          <div className="inline-actions">
            <a className="button" href="/user?view=tests">Back to tests</a>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="test-runner-shell">
      <div
        className={`test-runner-timer${remainingMs !== null && remainingMs <= 60_000 ? " warning" : " success"}`}
        aria-live="polite"
      >
        <span>Time left</span>
        <strong>{formatCountdown(remainingMs)}</strong>
      </div>

      <div className="question-list test-runner-content">
        <article className="question-card runner-summary-card">
          {test.branding?.imageDataUrl || test.branding?.instituteName ? (
            <div className="assessment-branding">
              {test.branding.imageDataUrl ? (
                <img alt="Institute branding" className="assessment-branding-image" src={test.branding.imageDataUrl} />
              ) : null}
              {test.branding.instituteName ? (
                <div>
                  <p className="eyebrow">Institute</p>
                  <strong>{test.branding.instituteName}</strong>
                </div>
              ) : null}
            </div>
          ) : null}
          <div className="question-head">
            <strong>{test.title}</strong>
            <span className="status-chip success">{test.durationMinutes} min</span>
          </div>
          <div className="runner-meta-row">
            <span className="status-chip success">
              Question {Math.min(currentQuestionIndex + 1, test.questions.length)} of {test.questions.length}
            </span>
            <span className="status-chip success">Answered {answeredCount} of {test.questions.length}</span>
          </div>
          <div className="field">
            <label htmlFor="test-runner-participant-name">Your name for this test</label>
            <input
              id="test-runner-participant-name"
              value={participantName}
              onChange={(event) => setParticipantName(event.target.value)}
            />
          </div>
          {feedback ? <p className="muted-text">{feedback}</p> : null}
        </article>

        {activeQuestion ? (
          <article className="question-card" key={activeQuestion.question.id}>
            <div className="question-head">
              <strong>Question {currentQuestionIndex + 1}</strong>
              <span className="muted-text">{test.questionCount - currentQuestionIndex - 1} remaining</span>
            </div>
            <p>{activeQuestion.question.prompt}</p>
            <div className="answer-grid">
              {activeQuestion.displayOptions.map((option, optionIndex) => (
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
            <div className="inline-actions">
              {currentQuestionIndex > 0 ? (
                <button
                  className="button-secondary"
                  type="button"
                  onClick={goToPreviousQuestion}
                >
                  Previous question
                </button>
              ) : null}
              {currentQuestionIndex < test.questions.length - 1 ? (
                <button className="button-secondary" type="button" onClick={goToNextQuestion}>
                  Next question
                </button>
              ) : (
                <button className="button" disabled={isSubmitting} type="button" onClick={() => void submitTest()}>
                  {isSubmitting ? "Submitting..." : "Submit test"}
                </button>
              )}
            </div>
          </article>
        ) : null}
      </div>
    </div>
  );
}