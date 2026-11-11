"use client";

import { formatElapsedTime, shuffleOptionIndexesWithSeed, type GameAnswer, type GameCreatorRole, type GameLeaderboardEntry } from "@trapit/testing";
import { useEffect, useRef, useState } from "react";

import { formatShortDateTime } from "../lib/date-format";
import { readJsonResponse } from "../lib/read-json-response";
import { AnswerStatusIndicator } from "./answer-status-indicator";

type GameState = {
  acceptedCount: number;
  canStart: boolean;
  countdownDeadline: string | null;
  creatorRole: GameCreatorRole | null;
  currentQuestion: { id: string; imageDataUrl?: string | null; options: string[]; prompt: string } | null;
  currentQuestionIndex: number | null;
  displayName: string;
  isAccepted: boolean;
  isCreator: boolean;
  isMissed: boolean;
  leaderboard: Array<GameLeaderboardEntry & { isSelf?: boolean; maskedIdentifier?: string; correctCount?: number; incorrectUnansweredCount?: number; elapsedMs?: number }>;
  myReportedQuestionCount?: number;
  reportedQuestionIds?: string[];
  rulesVersion?: number;
  globalDeadline: string | null;
  questionStartedAt: string | null;
  overallGamePoints: number;
  ownAnswers: GameAnswer[];
  participantCount: number;
  participants: Array<{ acceptedAt: string; identifier: string; label: string }>;
  preparationDeadline: string | null;
  questionDeadline: string | null;
  recentDeltas: Array<{ answeredAt: string; participantIdentifier: string; points: number }>;
  resultMetadata: {
    creatorName: string;
    groupName: string;
    poolName: string;
    startedAt: string | null;
    completedAt: string | null;
    durationMinutes: number;
    submittedCount: number;
    sharedCount: number;
  };
  reviewQuestions: Array<{
    answer: GameAnswer | null;
    correctOptionIndex: number;
    id: string;
    imageDataUrl?: string | null;
    options: string[];
    prompt: string;
    questionIndex: number;
  }>;
  rules: {
    correctPoints: readonly number[];
    incorrectPoints: number;
    launchCountdownMs: number;
    questionCount: number;
    questionDurationMs: number;
  };
  status: "completed" | "countdown" | "ongoing" | "upcoming";
  title: string;
  viewerMode: "participant" | "spectator";
};

type GamePayload = { game: GameState; serverNow: string };

type UserGameRunnerProps = {
  autoAccept?: boolean;
  authConfigured: boolean;
  defaultParticipantIdentifier: string | null;
  gameId: string;
};

async function readJson<T>(response: Response) {
  return readJsonResponse<T>(response);
}

function formatOrdinal(value: number) {
  const remainder100 = value % 100;

  if (remainder100 >= 11 && remainder100 <= 13) {
    return `${value}th`;
  }

  return `${value}${value % 10 === 1 ? "st" : value % 10 === 2 ? "nd" : value % 10 === 3 ? "rd" : "th"}`;
}

export function UserGameRunner({ autoAccept = false, authConfigured, defaultParticipantIdentifier, gameId }: UserGameRunnerProps) {
  const [feedback, setFeedback] = useState<string | null>(null);
  const [game, setGame] = useState<GameState | null>(null);
  const [identifier, setIdentifier] = useState(defaultParticipantIdentifier ?? "");
  const [isLoading, setIsLoading] = useState(true);
  const [isMutating, setIsMutating] = useState(false);
  const [optimisticSubmittedQuestionIndex, setOptimisticSubmittedQuestionIndex] = useState<number | null>(null);
  const [participantName, setParticipantName] = useState("");
  const [remainingMs, setRemainingMs] = useState(0);
  const [selectedOptionIndex, setSelectedOptionIndex] = useState<number | null>(null);
  const [reviewingQuestionId, setReviewingQuestionId] = useState<string | null>(null);
  const [reviewReason, setReviewReason] = useState("");
  const [isReviewing, setIsReviewing] = useState(false);
  const [reviewFeedback, setReviewFeedback] = useState<string | null>(null);
  const [localReviewedIds, setLocalReviewedIds] = useState<string[]>([]);
  const [localReviewCountDelta, setLocalReviewCountDelta] = useState(0);
  const clockOffsetRef = useRef(0);
  const deadlineRefreshRef = useRef(false);
  const readyQuestionRef = useRef<string | null>(null);

  function getQuery() {
    return !authConfigured && identifier.trim()
      ? `?participantId=${encodeURIComponent(identifier.trim())}`
      : "";
  }

  async function loadGame(options?: { silent?: boolean }) {
    if (!options?.silent) {
      setIsLoading(true);
    }

    try {
      const payload = await readJson<GamePayload>(
        await fetch(`/api/user/games/${encodeURIComponent(gameId)}${getQuery()}`, { cache: "no-store" }),
      );
      clockOffsetRef.current = new Date(payload.serverNow).getTime() - Date.now();
      setGame(payload.game);
      setParticipantName((currentName) => currentName || (payload.game.rulesVersion === 4 && !payload.game.isAccepted ? "" : payload.game.displayName));
      if (!options?.silent) {
        setFeedback(null);
      }
      deadlineRefreshRef.current = false;
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Unable to load the game.");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    if (game?.rulesVersion !== 4 || (game.status !== "ongoing" && game.status !== "countdown")) return;
    const interval = window.setInterval(() => void loadGame({ silent: true }), 2000);
    const refresh = () => { if (!document.hidden) void loadGame({ silent: true }); };
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [game?.rulesVersion, game?.status, gameId, identifier]);

  useEffect(() => {
    async function initializeGame() {
      await loadGame();
    }

    void initializeGame();
  }, [gameId, autoAccept]);

  useEffect(() => {
    let source: EventSource | null = null;
    try {
      source = new EventSource("/api/internal/events");
      source.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data) as { scope?: string };
          if (payload.scope === "all" || payload.scope === "game") {
            void loadGame({ silent: true });
          }
        } catch {
          // Ignore malformed event payloads
        }
      };
    } catch {
      // Ignore EventSource initialization failures
    }

    return () => source?.close();
  }, [gameId, identifier]);

  useEffect(() => {
    setSelectedOptionIndex(null);
    setOptimisticSubmittedQuestionIndex(null);
  }, [game?.currentQuestion?.id, game?.currentQuestionIndex]);

  useEffect(() => {
    if (
      game?.status !== "ongoing"
      || game.viewerMode !== "participant"
      || !game.currentQuestion
      || game.currentQuestionIndex === null
      || game.questionDeadline
    ) {
      return;
    }

    const readyKey = `${game.currentQuestionIndex}:${game.currentQuestion.id}`;
    if (readyQuestionRef.current === readyKey) {
      return;
    }
    readyQuestionRef.current = readyKey;

    let secondFrame = 0;
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(async () => {
        try {
          const payload = await readJson<{ game?: GameState; serverNow?: string }>(await fetch(`/api/user/games/${encodeURIComponent(gameId)}/ready${getQuery()}`, {
            body: JSON.stringify({ questionIndex: game.currentQuestionIndex }),
            headers: { "Content-Type": "application/json" },
            method: "POST",
          }));
          if (payload.game && payload.serverNow) {
            clockOffsetRef.current = new Date(payload.serverNow).getTime() - Date.now();
            setGame(payload.game);
            deadlineRefreshRef.current = false;
          } else {
            await loadGame({ silent: true });
          }
        } catch (error) {
          readyQuestionRef.current = null;
          setFeedback(error instanceof Error ? error.message : "Unable to start the question timer.");
        }
      });
    });

    return () => {
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(secondFrame);
    };
  }, [game?.currentQuestion?.id, game?.currentQuestionIndex, game?.questionDeadline, game?.status, game?.viewerMode, gameId]);

  useEffect(() => {
    const activeDeadline = game?.countdownDeadline ?? game?.questionDeadline ?? game?.preparationDeadline ?? game?.globalDeadline;

    if (!activeDeadline) {
      setRemainingMs(0);
      return;
    }

    const tick = () => {
      const nextRemaining = Math.max(
        0,
        new Date(activeDeadline).getTime() - (Date.now() + clockOffsetRef.current),
      );
      setRemainingMs(nextRemaining);

      if (nextRemaining === 0 && !deadlineRefreshRef.current) {
        deadlineRefreshRef.current = true;
        void loadGame({ silent: true });
      }
    };

    tick();
    const intervalId = window.setInterval(tick, 250);
    return () => window.clearInterval(intervalId);
  }, [game?.countdownDeadline, game?.preparationDeadline, game?.questionDeadline, game?.globalDeadline]);

  async function runAction(action: "accept" | "start") {
    setIsMutating(true);
    try {
      await readJson(await fetch(`/api/user/games/${encodeURIComponent(gameId)}/${action}${getQuery()}`, {
        body: action === "accept" ? JSON.stringify({ participantName }) : undefined,
        headers: action === "accept" ? { "Content-Type": "application/json" } : undefined,
        method: "POST",
      }));
      await loadGame({ silent: true });
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : `Unable to ${action} the game.`);
    } finally {
      setIsMutating(false);
    }
  }

  async function chooseCreatorRole(role: GameCreatorRole) {
    setIsMutating(true);
    try {
      await readJson(await fetch(`/api/user/games/${encodeURIComponent(gameId)}/role${getQuery()}`, {
        body: JSON.stringify({ participantName, role }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      }));
      await loadGame({ silent: true });
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Unable to choose your game role.");
    } finally {
      setIsMutating(false);
    }
  }

  async function submitAnswer() {
    if (selectedOptionIndex === null || game?.currentQuestionIndex === null || !game) {
      return;
    }

    const submittedQuestionIndex = game.currentQuestionIndex;
    setOptimisticSubmittedQuestionIndex(submittedQuestionIndex);
    setIsMutating(true);
    try {
      const payload = await readJson<{ answer: Partial<GameAnswer>; game?: GameState; serverNow?: string }>(
        await fetch(`/api/user/games/${encodeURIComponent(gameId)}/answer${getQuery()}`, {
          body: JSON.stringify({
            optionIndex: selectedOptionIndex, questionIndex: submittedQuestionIndex,
            elapsedMs: game.rulesVersion === 4 && game.questionStartedAt
              ? Math.max(0, Math.floor(Date.now() + clockOffsetRef.current - Date.parse(game.questionStartedAt)))
              : undefined,
          }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        }),
      );
      setFeedback(game.rulesVersion === 4 || payload.answer.points === undefined
        ? "Answer submitted."
        : `Answered (${payload.answer.points >= 0 ? "+" : ""}${payload.answer.points})`);
      if (payload.game && payload.serverNow) {
        clockOffsetRef.current = new Date(payload.serverNow).getTime() - Date.now();
        setGame(payload.game);
        deadlineRefreshRef.current = false;
      } else {
        await loadGame({ silent: true });
      }
    } catch (error) {
      setOptimisticSubmittedQuestionIndex((current) => current === submittedQuestionIndex ? null : current);
      setFeedback(error instanceof Error ? error.message : "Unable to submit the answer.");
    } finally {
      setIsMutating(false);
    }
  }

  if (isLoading && !game) {
    return <p className="muted-text">Loading game...</p>;
  }

  if (!game) {
    return (
      <section className="workspace-card">
        <h1>Game unavailable</h1>
        {!authConfigured ? (
          <div className="field-row align-end">
            <div className="field grow-field">
              <label htmlFor="game-participant-id">Participant identifier</label>
              <input id="game-participant-id" value={identifier} onChange={(event) => setIdentifier(event.target.value)} />
            </div>
            <button className="button" type="button" onClick={() => void loadGame()}>Load game</button>
          </div>
        ) : null}
        {feedback ? <p className="muted-text">{feedback}</p> : null}
      </section>
    );
  }

  const userBanner = (
    <header className="game-user-banner">
      <div>
        <span className="eyebrow">Participant</span>
        <strong>{game.displayName}</strong>
      </div>
      <div className="game-user-points">
        <span className="eyebrow">Overall points</span>
        <strong>{game.overallGamePoints}</strong>
      </div>
    </header>
  );

  if (game.status === "upcoming" || game.status === "countdown") {
    return (
      <div className="game-page-stack">
        {userBanner}
        {game.status === "countdown" ? (
          <section className="workspace-card game-launch-countdown" aria-live="polite">
            <p className="eyebrow">Game starts in</p>
            <strong>{Math.ceil(remainingMs / 1000)}</strong>
            <p>{game.viewerMode === "participant" ? "Get ready to play" : "You are watching as a spectator"}</p>
          </section>
        ) : null}
        <div className="game-runner-layout">
          <section className="workspace-card game-question-panel pre-test-unified-card">
            <h1 className="pre-test-centered-title">{game.title}</h1>
            <div className="pre-test-guidance-rules-row">
              <div className="pre-test-guidance-column">
                <h2>For best outcome</h2>
                <ul>
                  <li>Avoid cheating or taking help from others or doing guess work</li>
                  <li>Respond purely based on your knowledge</li>
                </ul>
              </div>
              <div className="pre-test-rules-column">
                <h2>Rules</h2>
                <ul>
                  <li>{game.rules.questionCount} questions, {game.rules.questionDurationMs / 1000} seconds each</li>
                  <li>Points based on fastest response: {game.rules.correctPoints.join(", ")}.</li>
                  <li>Incorrect or unanswered: {game.rules.incorrectPoints} points.</li>
                </ul>
              </div>
            </div>
            {game.isCreator && game.status === "upcoming" ? (
              <div className="form-stack">
                <h2>Choose your role</h2>
                {game.creatorRole !== "spectator" && !game.isAccepted ? (
                  <div className="field">
                    <label htmlFor="game-participant-name">Participant name</label>
                    <input
                      autoFocus={autoAccept}
                      id="game-participant-name"
                      maxLength={80}
                      placeholder="Enter your name"
                      value={participantName}
                      onChange={(event) => setParticipantName(event.target.value)}
                    />
                  </div>
                ) : null}
                <div className="game-role-selector" role="group" aria-label="Creator game role">
                  <button aria-pressed={game.creatorRole === "participant"} className="button-secondary" disabled={isMutating || !participantName.trim()} type="button" onClick={() => void chooseCreatorRole("participant")}>Join Game</button>
                  <button aria-pressed={game.creatorRole === "spectator"} className="button-secondary" disabled={isMutating} type="button" onClick={() => void chooseCreatorRole("spectator")}>Watch Game</button>
                </div>
              </div>
            ) : null}
            {!game.isCreator && !game.isAccepted && game.status === "upcoming" ? (
              <div className="field">
                <label htmlFor="game-participant-name">Participant name</label>
                <input
                  autoFocus={autoAccept}
                  id="game-participant-name"
                  maxLength={80}
                  placeholder="Enter your name"
                  value={participantName}
                  onChange={(event) => setParticipantName(event.target.value)}
                />
              </div>
            ) : null}
            <div className="inline-actions">
              {!game.isCreator && !game.isAccepted && game.status === "upcoming" ? <button className="button" disabled={isMutating || !participantName.trim()} type="button" onClick={() => void runAction("accept")}>Accept Game</button> : null}
              {game.isCreator && game.status === "upcoming" ? <button className="button" disabled={isMutating || !game.canStart} type="button" onClick={() => void runAction("start")}>Start Game</button> : null}
            </div>
          </section>
          <aside className="workspace-card game-leaderboard-panel">
            <p className="eyebrow">Test Waiting Room</p>
            <h2>{game.acceptedCount} ready</h2>
            <div className="game-lobby-roster">
              {game.participants.map((participant, index) => (
                <div className="game-lobby-participant" key={participant.identifier}>
                  <strong>#{index + 1} {participant.label}</strong>
                  <span className="status-chip success">Accepted</span>
                </div>
              ))}
            </div>
          </aside>
        </div>
        {feedback ? <p className="muted-text">{feedback}</p> : null}
      </div>
    );
  }

  async function handleSubmitGameQuestionReview(questionId: string) {
    if (isReviewing || !game) return;
    setIsReviewing(true);
    setReviewFeedback(null);
    try {
      await readJson(
        await fetch(`/api/user/games/${encodeURIComponent(gameId)}${getQuery()}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            questionId,
            reason: reviewReason.trim(),
          }),
        }),
      );
      setLocalReviewedIds((current) => [...new Set([...current, questionId])]);
      setLocalReviewCountDelta((current) => current + 1);
      setReviewingQuestionId(null);
      setReviewReason("");
      setReviewFeedback("Question submitted for review.");
      await loadGame({ silent: true });
    } catch (error) {
      setReviewFeedback(error instanceof Error ? error.message : "Unable to submit question for review.");
    } finally {
      setIsReviewing(false);
    }
  }

  if (game.status === "completed") {
    const reviewedSet = new Set([...(game.reportedQuestionIds ?? []), ...localReviewedIds]);
    const myReviewCount = (game.myReportedQuestionCount ?? 0) + localReviewCountDelta;
    const hasReachedUserReviewLimit = myReviewCount >= 2;

    return (
      <div className="game-page-stack">
        {userBanner}
        <div className="leaderboard-table-wrap test-results-summary-wrap">
          <table className="leaderboard-table test-results-summary-table">
            <thead><tr><th>Scheduled date</th><th>Question Pool</th><th>Groups</th><th>Test creator name</th></tr></thead>
            <tbody><tr>
              <td>{game.resultMetadata.startedAt ? formatShortDateTime(game.resultMetadata.startedAt) : "Not started"}</td>
              <td>{game.resultMetadata.poolName}</td>
              <td>{game.resultMetadata.groupName}</td>
              <td>{game.resultMetadata.creatorName}</td>
            </tr></tbody>
          </table>
        </div>
        {reviewFeedback ? <p className="muted-text" role="status">{reviewFeedback}</p> : null}
        <div className="game-runner-layout">
          <section className="workspace-card game-question-panel">
            <p className="eyebrow">{game.isMissed ? game.rulesVersion === 4 ? "Absent" : "Missed game" : "Completed game"}</p>
            <h1>{game.title} ({game.rules.questionCount})</h1>
            {game.isMissed ? <p>You did not accept before the game started. Final results are available below.</p> : null}
            {game.reviewQuestions.length ? (
              <div className="review-list game-question-review-list">
                {game.reviewQuestions.map((question) => {
                  const pointsValue = question.answer ? question.answer.points : game.rules.incorrectPoints;
                  const isQuestionReviewed = reviewedSet.has(question.id);
                  return (
                  <article className="game-question-review" key={question.id}>
                    <div className="question-head">
                      <h2>{question.questionIndex + 1}. {question.prompt}</h2>
                      <div className="inline-actions">
                        <strong>{pointsValue >= 0 ? "+" : ""}{pointsValue}</strong>
                        <button
                          className={isQuestionReviewed ? "button small-button" : "button-secondary small-button"}
                          disabled={isReviewing || isQuestionReviewed || hasReachedUserReviewLimit}
                          type="button"
                          onClick={() => {
                            if (reviewingQuestionId === question.id) {
                              setReviewingQuestionId(null);
                              setReviewReason("");
                            } else {
                              setReviewingQuestionId(question.id);
                              setReviewReason("");
                            }
                          }}
                        >
                          {isQuestionReviewed ? "Reviewed" : "Review"}
                        </button>
                      </div>
                    </div>
                    {question.imageDataUrl ? (
                      <div className="question-image-container">
                        <img alt={`Question ${question.questionIndex + 1} illustration`} className="question-illustration-image" loading="lazy" src={question.imageDataUrl} />
                      </div>
                    ) : null}
                    {reviewingQuestionId === question.id && !isQuestionReviewed && !hasReachedUserReviewLimit ? (
                      <div className="field-row align-end test-results-report-box">
                        <div className="field grow-field">
                          <label htmlFor={`game-review-reason-${question.id}`}>Description (max 20 characters)</label>
                          <input
                            id={`game-review-reason-${question.id}`}
                            maxLength={20}
                            placeholder="Max 20 chars"
                            value={reviewReason}
                            onChange={(event) => setReviewReason(event.target.value.slice(0, 20))}
                          />
                        </div>
                        <button
                          className="button small-button"
                          disabled={isReviewing}
                          type="button"
                          onClick={() => void handleSubmitGameQuestionReview(question.id)}
                        >
                          {isReviewing ? "Submitting..." : "Submit review"}
                        </button>
                        <button
                          className="button-secondary small-button"
                          disabled={isReviewing}
                          type="button"
                          onClick={() => {
                            setReviewingQuestionId(null);
                            setReviewReason("");
                          }}
                        >
                          Cancel
                        </button>
                      </div>
                    ) : null}
                    <div className="game-review-options">
                      {question.options.map((option, optionIndex) => {
                        const isCorrect = optionIndex === question.correctOptionIndex;
                        const isChosen = question.answer?.optionIndex === optionIndex;
                        return (
                          <div className={`game-review-option${isCorrect ? " is-correct" : ""}${isChosen && !isCorrect ? " is-incorrect" : ""}`} key={`${question.id}-${optionIndex}`}>
                            <span>{option}</span>
                            <AnswerStatusIndicator isCorrect={isCorrect} isSelected={isChosen} />
                          </div>
                        );
                      })}
                    </div>
                    <p className="muted-text">
                      {question.answer?.kind === "timeout"
                        ? "Timed out"
                        : question.answer?.responsePosition
                          ? `${formatOrdinal(question.answer.responsePosition)} to answer`
                          : "No response"}
                    </p>
                  </article>
                  );
                })}
              </div>
            ) : <p className="muted-text">Spectator view: no personal responses were recorded.</p>}
          </section>
          <GameLeaderboard game={game} />
        </div>
        <p className="apportion-identity-mark">www.TRAPit.in</p>
      </div>
    );
  }

  const hasAnswered = game.currentQuestionIndex !== null && game.ownAnswers.some(
    (answer) => answer.questionIndex === game.currentQuestionIndex,
  );
  const isSubmitted = hasAnswered || optimisticSubmittedQuestionIndex === game.currentQuestionIndex;
  const isLastQuestion = game.currentQuestionIndex === game.rules.questionCount - 1;
  const latestOwnAnswer = game.ownAnswers[game.ownAnswers.length - 1];

  return (
    <div className="game-page-stack">
      {userBanner}
      <div className="game-runner-layout">
        <section className="workspace-card game-question-panel">
        <div className="question-head">
          <div>
            <p className="eyebrow">Question {(game.currentQuestionIndex ?? 0) + 1} of {game.rules.questionCount}</p>
            <h1>{game.title} ({game.rules.questionCount})</h1>
          </div>
        </div>
        {game.currentQuestion ? (
          <div className="form-stack">
            <h2>{game.currentQuestion.prompt}</h2>
            {game.currentQuestion.imageDataUrl ? (
              <div className="question-image-container">
                <img alt="Question illustration" className="question-illustration-image" src={game.currentQuestion.imageDataUrl} />
              </div>
            ) : null}
            <div className="game-answer-grid">
              {shuffleOptionIndexesWithSeed(
                game.currentQuestion.options,
                `${gameId}:${identifier || game.displayName}:${game.currentQuestion.id}`,
              ).map((optionIndex) => {
                const option = game.currentQuestion!.options[optionIndex];
                return (
                <button
                  aria-pressed={selectedOptionIndex === optionIndex}
                  className={`role-option game-answer-option${selectedOptionIndex === optionIndex ? " is-selected" : ""}`}
                  disabled={game.viewerMode === "spectator" || isSubmitted || isMutating}
                  key={`${game.currentQuestion?.id}-${optionIndex}`}
                  type="button"
                  onClick={() => setSelectedOptionIndex(optionIndex)}
                >
                  {option}
                </button>
                );
              })}
            </div>
            {game.viewerMode === "participant" ? (
              <div className="game-answer-action-bar">
                <strong className={`game-countdown${game.questionDeadline ? "" : " is-preparing"}`} aria-live="polite">
                  {game.questionDeadline ? `${Math.ceil(remainingMs / 1000)}s` : "Preparing timer..."}
                </strong>
                <button className="button game-submit-button" disabled={selectedOptionIndex === null || isSubmitted || isMutating || !game.questionDeadline} type="button" onClick={() => void submitAnswer()}>
                  {isSubmitted ? "Submitted" : isLastQuestion ? "Submit Test" : "Submit"}
                </button>
              </div>
            ) : (
              <div className="game-answer-action-bar">
                <strong className={`game-countdown${game.questionDeadline ? "" : " is-preparing"}`}>{game.questionDeadline ? `${Math.ceil(remainingMs / 1000)}s` : "Preparing timer..."}</strong>
                <p className="status-chip warning">Watching as spectator</p>
              </div>
            )}
          </div>
        ) : <p className="muted-text">{game.rulesVersion === 4 ? "Waiting for all participants to finish or the 10-minute deadline. Results will appear automatically." : "Preparing the next question..."}</p>}
          {feedback ? <p className="muted-text">{feedback}</p> : latestOwnAnswer?.kind === "timeout" ? <p className="muted-text">Previous question timed out{game.rulesVersion === 4 ? "." : ` (${latestOwnAnswer.points})`}</p> : null}
        </section>
        <GameLeaderboard game={game} />
      </div>
    </div>
  );
}

function GameLeaderboard({ game }: { game: GameState }) {
  const durationLabel = `${game.resultMetadata.durationMinutes} min`;
  const isCompleted = game.status === "completed";
  return (
    <aside className="workspace-card game-leaderboard-panel test-results-leaderboard">
      <p className="eyebrow">Leaderboard</p>
      <h2>
        {isCompleted
          ? `Final standings (${game.resultMetadata.submittedCount}/${game.resultMetadata.sharedCount})`
          : "Live leaderboard"}
      </h2>
      <div className="game-leaderboard-list">
        {game.leaderboard.map((entry) => {
          const recentDelta = [...game.recentDeltas].reverse().find((delta) =>
            delta.participantIdentifier === entry.participantIdentifier
            && Date.now() - new Date(delta.answeredAt).getTime() < 5000,
          );
          const correctCount = entry.correctCount ?? 0;
          const incorrectUnansweredCount = entry.incorrectUnansweredCount ?? 0;
          return (
            <div className={`game-leaderboard-row test-results-leaderboard-row${entry.isSelf ? " is-self is-current-participant" : ""}`} aria-current={entry.isSelf ? "true" : undefined} style={entry.isSelf ? { background: "var(--surface-soft, #eef6ff)", border: "2px solid currentColor" } : undefined} key={entry.participantIdentifier}>
              <div className="test-results-leaderboard-left">
                <strong>#{entry.rank} {entry.participantLabel}{entry.isSelf ? " (You)" : ""}</strong>
                {isCompleted ? (
                  <>
                    <span className="test-results-leaderboard-meta">{entry.maskedIdentifier || "—"}</span>
                    <span className="test-results-leaderboard-time">{formatElapsedTime(entry.elapsedMs ?? 0)} ({durationLabel})</span>
                  </>
                ) : null}
              </div>
              <div className="test-results-leaderboard-right">
                <strong>{entry.points} pts</strong>
                {isCompleted ? (
                  <span className="test-results-leaderboard-meta">(+{correctCount} / -{incorrectUnansweredCount})</span>
                ) : null}
              </div>
              {recentDelta ? (
                <span className="game-score-flash">
                  {`Answered (${recentDelta.points >= 0 ? "+" : ""}${recentDelta.points})`}
                </span>
              ) : null}
            </div>
          );
        })}
      </div>
    </aside>
  );
}
