"use client";

import { type ScheduledPoll } from "@trapit/testing";
import { useEffect, useState } from "react";

import { formatShortDateTime } from "../lib/date-format";

type PublicPollResponse = {
  actor: {
    displayName: string | null;
    identifier: string | null;
    isRegistered: boolean;
  };
  canViewResults: boolean;
  creator: {
    displayName: string | null;
    maskedIdentifier: string | null;
  };
  hasSubmitted: boolean;
  poll: ScheduledPoll;
  questions: Array<{
    id: string;
    options: string[];
    prompt: string;
    topic: string;
  }>;
  summary: Array<{
    optionSelectionCounts: number[];
    options: string[];
    prompt: string;
    questionId: string;
    topic: string;
    totalResponses: number;
  }>;
  totalResponses: number | null;
};

const guestRegistrationMessage =
  "Register to see live results and to respond to upcoming instances.";

async function readJson<T>(response: Response): Promise<T> {
  const payload = (await response.json()) as T & { error?: string };

  if (!response.ok) {
    throw new Error((payload as { error?: string }).error ?? "Request failed.");
  }

  return payload;
}

function createGuestId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `guest-${crypto.randomUUID()}`;
  }

  return `guest-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

type PollWorkspaceProps = {
  loadPath: string;
  storageKey: string;
  submitPath: string;
};

type PublicPollWorkspaceProps = {
  shareCode: string;
};

type UserPollWorkspaceProps = {
  pollId: string;
};

function PollWorkspace({ loadPath, storageKey, submitPath }: PollWorkspaceProps) {
  const [answers, setAnswers] = useState<Record<string, number | undefined>>({});
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [isDetailsExpanded, setIsDetailsExpanded] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [guestId, setGuestId] = useState<string>("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [participantName, setParticipantName] = useState("");
  const [payload, setPayload] = useState<PublicPollResponse | null>(null);
  const [startedAt, setStartedAt] = useState<string | null>(null);
  const activeQuestion =
    payload && currentQuestionIndex < payload.questions.length
      ? payload.questions[currentQuestionIndex]
      : null;
  const answeredCount = payload
    ? payload.questions.filter((question) => typeof answers[question.id] === "number").length
    : 0;
  const pollTopicLabel = payload
    ? Array.from(
      new Set(
        payload.questions
          .map((question) => question.topic.trim())
          .filter(Boolean),
      ),
    ).join(", ")
    : "";

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const existingGuestId = window.localStorage.getItem(storageKey);

    if (existingGuestId) {
      setGuestId(existingGuestId);
      return;
    }

    const nextGuestId = createGuestId();
    window.localStorage.setItem(storageKey, nextGuestId);
    setGuestId(nextGuestId);
  }, [storageKey]);

  useEffect(() => {
    let isMounted = true;

    async function loadPoll() {
      setIsLoading(true);

      try {
        const nextPayload = await readJson<PublicPollResponse>(
          await fetch(loadPath),
        );

        if (!isMounted) {
          return;
        }

        setPayload(nextPayload);
        setCurrentQuestionIndex(0);
        setParticipantName(
          nextPayload.actor.displayName?.trim()
            || nextPayload.actor.identifier?.trim()
            || "",
        );
        setFeedback(null);
      } catch (error) {
        if (isMounted) {
          setFeedback(error instanceof Error ? error.message : "Unable to load this poll.");
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    void loadPoll();

    return () => {
      isMounted = false;
    };
  }, [loadPath]);

  useEffect(() => {
    if (!payload || startedAt) {
      return;
    }

    setStartedAt(new Date().toISOString());
  }, [payload, startedAt]);

  async function submitPoll() {
    if (!payload || !startedAt) {
      return;
    }

    if (payload.actor.isRegistered && !participantName.trim()) {
      setFeedback("Enter your name before responding to the poll.");
      return;
    }

    const unansweredQuestion = payload.questions.find(
      (question) => typeof answers[question.id] !== "number",
    );

    if (unansweredQuestion) {
      setFeedback("Answer every poll question before submitting.");
      return;
    }

    setIsSubmitting(true);

    try {
      const nextPayload = await readJson<PublicPollResponse>(
        await fetch(submitPath, {
          body: JSON.stringify({
            answers,
            completedAt: new Date().toISOString(),
            guestId,
            participantName: payload.actor.isRegistered ? participantName : undefined,
            startedAt,
          }),
          headers: {
            "Content-Type": "application/json",
          },
          method: "POST",
        }),
      );

      setPayload(nextPayload);
      setCurrentQuestionIndex(0);
      setFeedback("Poll submitted.");

      if (!nextPayload.actor.isRegistered && typeof window !== "undefined") {
        window.alert(guestRegistrationMessage);
      }
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Unable to submit this poll.");
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleSelectAnswer(questionId: string, optionIndex: number) {
    setAnswers((currentAnswers) => ({
      ...currentAnswers,
      [questionId]: optionIndex,
    }));
    setFeedback(null);
  }

  function goToPreviousQuestion() {
    setCurrentQuestionIndex((currentIndex) => Math.max(currentIndex - 1, 0));
    setFeedback(null);
  }

  function goToNextQuestion() {
    if (!payload) {
      return;
    }

    setCurrentQuestionIndex((currentIndex) => Math.min(currentIndex + 1, Math.max(payload.questions.length - 1, 0)));
    setFeedback(null);
  }

  return (
    <main className="page-shell">
      <section className="panel hero-copy">
        {isLoading ? <p className="muted-text">Loading poll...</p> : null}
        {!isLoading && feedback ? <p className="muted-text">{feedback}</p> : null}

        {payload ? (
          <div className="form-stack">
            {payload.poll.branding?.imageDataUrl || payload.poll.branding?.instituteName ? (
              <div className="assessment-branding">
                {payload.poll.branding.imageDataUrl ? (
                  <img alt="Institute branding" className="assessment-branding-image" src={payload.poll.branding.imageDataUrl} />
                ) : null}
                {payload.poll.branding.instituteName ? (
                  <div>
                    <p className="eyebrow">Institute</p>
                    <strong>{payload.poll.branding.instituteName}</strong>
                  </div>
                ) : null}
              </div>
            ) : null}

            {pollTopicLabel ? (
              <div className="question-head">
                <div>
                  <p className="eyebrow">Topic</p>
                  <strong>{pollTopicLabel}</strong>
                </div>
              </div>
            ) : null}

            {payload.poll.status === "live" && !payload.hasSubmitted ? (
              <div className="form-stack">
                {payload.actor.isRegistered ? (
                  <div className="field">
                    <label htmlFor="public-poll-name">Your name</label>
                    <input
                      id="public-poll-name"
                      value={participantName}
                      onChange={(event) => setParticipantName(event.target.value)}
                    />
                  </div>
                ) : null}

                <article className="question-card runner-summary-card">
                  {payload.poll.branding?.imageDataUrl || payload.poll.branding?.instituteName ? (
                    <div className="assessment-branding">
                      {payload.poll.branding.imageDataUrl ? (
                        <img alt="Institute branding" className="assessment-branding-image" src={payload.poll.branding.imageDataUrl} />
                      ) : null}
                      {payload.poll.branding.instituteName ? (
                        <div>
                          <p className="eyebrow">Institute</p>
                          <strong>{payload.poll.branding.instituteName}</strong>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                  <div className="question-head">
                    <strong>{payload.poll.title}</strong>
                    <span className="status-chip success">
                      Question {Math.min(currentQuestionIndex + 1, payload.questions.length)} of {payload.questions.length}
                    </span>
                  </div>
                  <p className="muted-text">Select an answer, then use the navigation buttons to move backward or forward before submitting.</p>
                  <p className="muted-text">Answered {answeredCount} of {payload.questions.length}</p>
                </article>

                {activeQuestion ? (
                  <article className="question-card" key={activeQuestion.id}>
                    <div className="question-head">
                      <strong>{activeQuestion.prompt}</strong>
                      {activeQuestion.topic ? <span className="status-chip warning">{activeQuestion.topic}</span> : null}
                    </div>
                    <p className="muted-text">
                      Question {currentQuestionIndex + 1} of {payload.questions.length}
                    </p>
                    <div className="selection-grid">
                      {activeQuestion.options.map((option, optionIndex) => (
                        <label className="role-option" key={`${activeQuestion.id}-${optionIndex}`}>
                          <input
                            checked={answers[activeQuestion.id] === optionIndex}
                            name={`poll-question-${activeQuestion.id}`}
                            type="radio"
                            onChange={() => handleSelectAnswer(activeQuestion.id, optionIndex)}
                          />
                          <span>{option}</span>
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
                      {currentQuestionIndex < payload.questions.length - 1 ? (
                        <button className="button-secondary" type="button" onClick={goToNextQuestion}>
                          Next question
                        </button>
                      ) : (
                        <button className="button" disabled={isSubmitting} type="button" onClick={() => void submitPoll()}>
                          {isSubmitting ? "Submitting..." : "Submit poll"}
                        </button>
                      )}
                    </div>
                  </article>
                ) : (
                  <article className="question-card">
                    <div className="question-head">
                      <strong>Ready to submit</strong>
                      <span className="status-chip success">{answeredCount}/{payload.questions.length} answered</span>
                    </div>
                    <p className="muted-text">Review earlier questions if needed, then submit your poll response.</p>
                    <div className="inline-actions">
                      <button
                        className="button-secondary"
                        disabled={payload.questions.length === 0}
                        type="button"
                        onClick={goToPreviousQuestion}
                      >
                        Review previous question
                      </button>
                      <button className="button" disabled={isSubmitting} type="button" onClick={() => void submitPoll()}>
                        {isSubmitting ? "Submitting..." : "Submit poll"}
                      </button>
                    </div>
                  </article>
                )}
              </div>
            ) : null}

            {isDetailsExpanded ? (
              <div className="form-stack">
                <div className="question-head">
                  <div>
                    <h1 className="hero-title">{payload.poll.title}</h1>
                    {payload.actor.isRegistered ? (
                      <p className="hero-text">
                        {`Signed in as ${payload.actor.displayName ?? payload.actor.identifier ?? "participant"}`}
                      </p>
                    ) : null}
                    {payload.creator.displayName || payload.creator.maskedIdentifier ? (
                      <p className="muted-text">
                        Poll by {payload.creator.displayName ?? "TRAPit admin"}
                        {payload.creator.maskedIdentifier ? ` (${payload.creator.maskedIdentifier})` : ""}
                      </p>
                    ) : null}
                  </div>
                  <button
                    aria-expanded={isDetailsExpanded}
                    className="button-secondary small-button"
                    type="button"
                    onClick={() => setIsDetailsExpanded(false)}
                  >
                    -
                  </button>
                </div>

                <div className="question-card">
                  <div className="question-head">
                    <strong>{payload.poll.title}</strong>
                    <span className={`status-chip ${payload.poll.status === "live" ? "success" : "warning"}`}>
                      {payload.poll.status}
                    </span>
                  </div>
                  <div className="form-stack">
                    {payload.actor.isRegistered ? (
                      <p className="muted-text">Starts: {formatShortDateTime(payload.poll.startsAt)}</p>
                    ) : null}
                    <p className="muted-text">Ends: {formatShortDateTime(payload.poll.endsAt)}</p>
                    <p className="muted-text">Questions: {payload.questions.length}</p>
                    <p className="muted-text">Response mode: {payload.poll.anonymous ? "Anonymous" : "Named"}</p>
                    {typeof payload.totalResponses === "number" ? (
                      <p className="muted-text">Responses so far: {payload.totalResponses}</p>
                    ) : null}
                  </div>
                </div>
                {payload.hasSubmitted ? <p className="muted-text">Your response has already been recorded for this poll.</p> : null}
                {!payload.hasSubmitted && payload.poll.status === "scheduled" ? (
                  <p className="muted-text">This poll has not started yet.</p>
                ) : null}
                {!payload.hasSubmitted && payload.poll.status === "completed" ? (
                  <p className="muted-text">This poll is no longer accepting responses.</p>
                ) : null}
              </div>
            ) : null}

            <div className="form-stack">
              <div className="question-head">
                <div>
                  <p className="eyebrow">Results</p>
                </div>
                <button
                  aria-expanded={isDetailsExpanded}
                  className="button-secondary small-button"
                  type="button"
                  onClick={() => setIsDetailsExpanded((currentValue) => !currentValue)}
                >
                  {isDetailsExpanded ? "-" : "+"}
                </button>
              </div>
              {!payload.canViewResults && payload.hasSubmitted && !payload.actor.isRegistered ? (
                <p className="muted-text">
                  Your anonymous response was recorded. Results are only shown to the poll creator and registered participants who responded.
                </p>
              ) : !payload.canViewResults && payload.actor.isRegistered ? (
                <p className="muted-text">
                  Results become visible here after you submit as a registered participant, or immediately if you are the poll creator.
                </p>
              ) : null}
              {payload.canViewResults ? (
                <div className="question-list">
                  {payload.summary.map((question) => (
                    <article className="question-card" key={`summary-${question.questionId}`}>
                      <div className="question-head">
                        <strong>{question.prompt}</strong>
                        {question.topic ? <span className="status-chip warning">{question.topic}</span> : null}
                      </div>
                      <p className="muted-text">Live responses: {question.totalResponses}</p>
                      <div className="poll-result-chart" role="list" aria-label={`${question.prompt} response distribution`}>
                        {question.options.map((option, optionIndex) => {
                          const count = question.optionSelectionCounts[optionIndex] ?? 0;
                          const percentage = question.totalResponses
                            ? Math.round((count / question.totalResponses) * 100)
                            : 0;

                          return (
                            <div className="poll-result-row" key={`${question.questionId}-summary-${optionIndex}`} role="listitem">
                              <div className="poll-result-row-head">
                                <span className="poll-result-option">{option}</span>
                                <span className="poll-result-meta">
                                  {count} vote{count === 1 ? "" : "s"} ({percentage}%)
                                </span>
                              </div>
                              <div className="poll-result-bar-track" aria-hidden="true">
                                <div className="poll-result-bar-fill" style={{ width: `${percentage}%` }} />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </article>
                  ))}
                </div>
              ) : null}
            </div>

            {!payload.actor.isRegistered ? (
              <div className="form-stack">
                <p className="muted-text">Register to see live results and to respond to upcoming instances.</p>
                <div aria-label="Guest authentication links" className="segmented-control segmented-control-wide" role="group">
                  <a className="segmented-control-item" href="/sign-in">
                    Sign in
                  </a>
                  <a className="segmented-control-item" href="/sign-up">
                    Sign up
                  </a>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </section>
    </main>
  );
}

export function PublicPollWorkspace({ shareCode }: PublicPollWorkspaceProps) {
  const encodedShareCode = encodeURIComponent(shareCode);

  return (
    <PollWorkspace
      loadPath={`/api/public/polls/${encodedShareCode}`}
      storageKey={`trapit-public-poll:${shareCode}:guest-id`}
      submitPath={`/api/public/polls/${encodedShareCode}/attempt`}
    />
  );
}

export function UserPollWorkspace({ pollId }: UserPollWorkspaceProps) {
  const encodedPollId = encodeURIComponent(pollId);

  return (
    <PollWorkspace
      loadPath={`/api/user/polls/${encodedPollId}`}
      storageKey={`trapit-user-poll:${pollId}:session`}
      submitPath={`/api/user/polls/${encodedPollId}/attempt`}
    />
  );
}