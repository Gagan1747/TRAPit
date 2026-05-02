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
  totalResponses: number;
};

const guestRegistrationMessage =
  "Register with www.TRAPit.in to see live results and to respond to upcoming instances of recurring poll";

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

type PublicPollWorkspaceProps = {
  shareCode: string;
};

export function PublicPollWorkspace({ shareCode }: PublicPollWorkspaceProps) {
  const [answers, setAnswers] = useState<Record<string, number | undefined>>({});
  const [feedback, setFeedback] = useState<string | null>(null);
  const [guestId, setGuestId] = useState<string>("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [participantName, setParticipantName] = useState("");
  const [payload, setPayload] = useState<PublicPollResponse | null>(null);
  const [startedAt, setStartedAt] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const storageKey = `trapit-public-poll:${shareCode}:guest-id`;
    const existingGuestId = window.localStorage.getItem(storageKey);

    if (existingGuestId) {
      setGuestId(existingGuestId);
      return;
    }

    const nextGuestId = createGuestId();
    window.localStorage.setItem(storageKey, nextGuestId);
    setGuestId(nextGuestId);
  }, [shareCode]);

  useEffect(() => {
    let isMounted = true;

    async function loadPoll() {
      setIsLoading(true);

      try {
        const nextPayload = await readJson<PublicPollResponse>(
          await fetch(`/api/public/polls/${encodeURIComponent(shareCode)}`),
        );

        if (!isMounted) {
          return;
        }

        setPayload(nextPayload);
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
  }, [shareCode]);

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

    if (!participantName.trim()) {
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
        await fetch(`/api/public/polls/${encodeURIComponent(shareCode)}/attempt`, {
          body: JSON.stringify({
            answers,
            completedAt: new Date().toISOString(),
            guestId,
            participantName,
            startedAt,
          }),
          headers: {
            "Content-Type": "application/json",
          },
          method: "POST",
        }),
      );

      setPayload(nextPayload);
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

  return (
    <main className="page-shell">
      <section className="panel hero-copy">
        <div className="compact-head">
          <div>
            <h1 className="hero-title">{payload?.poll.title ?? "Open poll"}</h1>
            <p className="hero-text">
              {payload?.actor.isRegistered
                ? `Signed in as ${payload.actor.displayName ?? payload.actor.identifier ?? "participant"}`
                : "Respond without registration, or sign in to see live results."}
            </p>
          </div>
        </div>

        {isLoading ? <p className="muted-text">Loading poll...</p> : null}
        {!isLoading && feedback ? <p className="muted-text">{feedback}</p> : null}

        {payload ? (
          <div className="form-stack">
            <div className="question-card">
              <div className="question-head">
                <strong>{payload.poll.title}</strong>
                <span className={`status-chip ${payload.poll.status === "live" ? "success" : "warning"}`}>
                  {payload.poll.status}
                </span>
              </div>
              <p className="muted-text">Starts: {formatShortDateTime(payload.poll.startsAt)}</p>
              <p className="muted-text">Ends: {formatShortDateTime(payload.poll.endsAt)}</p>
              <p className="muted-text">Questions: {payload.questions.length}</p>
              <p className="muted-text">Responses so far: {payload.totalResponses}</p>
            </div>

            {payload.poll.status === "live" && !payload.hasSubmitted ? (
              <div className="form-stack">
                <div className="field">
                  <label htmlFor="public-poll-name">Your name</label>
                  <input
                    id="public-poll-name"
                    value={participantName}
                    onChange={(event) => setParticipantName(event.target.value)}
                  />
                </div>

                <div className="question-list">
                  {payload.questions.map((question) => (
                    <article className="question-card" key={question.id}>
                      <div className="question-head">
                        <strong>{question.prompt}</strong>
                        {question.topic ? <span className="status-chip warning">{question.topic}</span> : null}
                      </div>
                      <div className="selection-grid">
                        {question.options.map((option, optionIndex) => (
                          <label className="role-option" key={`${question.id}-${optionIndex}`}>
                            <input
                              checked={answers[question.id] === optionIndex}
                              name={`poll-question-${question.id}`}
                              type="radio"
                              onChange={() =>
                                setAnswers((currentAnswers) => ({
                                  ...currentAnswers,
                                  [question.id]: optionIndex,
                                }))
                              }
                            />
                            <span>{option}</span>
                          </label>
                        ))}
                      </div>
                    </article>
                  ))}
                </div>

                <div className="inline-actions">
                  <button className="button" disabled={isSubmitting} type="button" onClick={() => void submitPoll()}>
                    {isSubmitting ? "Submitting..." : "Submit poll"}
                  </button>
                </div>
              </div>
            ) : payload.hasSubmitted ? (
              <p className="muted-text">Your response has already been recorded for this poll.</p>
            ) : payload.poll.status === "scheduled" ? (
              <p className="muted-text">This poll has not started yet.</p>
            ) : (
              <p className="muted-text">This poll is no longer accepting responses.</p>
            )}

            {payload.actor.isRegistered ? (
              <div className="question-list">
                {payload.summary.map((question) => (
                  <article className="question-card" key={`summary-${question.questionId}`}>
                    <div className="question-head">
                      <strong>{question.prompt}</strong>
                      {question.topic ? <span className="status-chip warning">{question.topic}</span> : null}
                    </div>
                    <p className="muted-text">Live responses: {question.totalResponses}</p>
                    <ol className="question-options compact-question-options">
                      {question.options.map((option, optionIndex) => {
                        const count = question.optionSelectionCounts[optionIndex] ?? 0;
                        const percentage = question.totalResponses
                          ? Math.round((count / question.totalResponses) * 100)
                          : 0;

                        return (
                          <li key={`${question.questionId}-summary-${optionIndex}`}>
                            {option} - {count} vote{count === 1 ? "" : "s"} ({percentage}%)
                          </li>
                        );
                      })}
                    </ol>
                  </article>
                ))}
              </div>
            ) : null}

            {!payload.actor.isRegistered ? (
              <p className="muted-text">
                Register with <a href="https://www.trapit.in" target="_blank" rel="noreferrer">www.TRAPit.in</a> to see live results and to respond to upcoming instances of recurring poll.
              </p>
            ) : null}
          </div>
        ) : null}
      </section>
    </main>
  );
}