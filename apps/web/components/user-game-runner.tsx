"use client";

import type { GameAnswer, GameCreatorRole, GameLeaderboardEntry } from "@trapit/testing";
import { useEffect, useRef, useState } from "react";

import { AnswerStatusIndicator } from "./answer-status-indicator";

type GameState = {
  acceptedCount: number;
  canStart: boolean;
  countdownDeadline: string | null;
  creatorRole: GameCreatorRole | null;
  currentQuestion: { id: string; options: string[]; prompt: string } | null;
  currentQuestionIndex: number | null;
  displayName: string;
  isAccepted: boolean;
  isCreator: boolean;
  isMissed: boolean;
  leaderboard: GameLeaderboardEntry[];
  overallGamePoints: number;
  ownAnswers: GameAnswer[];
  participantCount: number;
  participants: Array<{ acceptedAt: string; identifier: string; label: string }>;
  questionDeadline: string | null;
  recentDeltas: Array<{ answeredAt: string; participantIdentifier: string; points: number }>;
  reviewQuestions: Array<{
    answer: GameAnswer | null;
    correctOptionIndex: number;
    id: string;
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
  const payload = (await response.json()) as T & { error?: string };

  if (!response.ok) {
    throw new Error(payload.error ?? "Request failed.");
  }

  return payload;
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
  const [remainingMs, setRemainingMs] = useState(0);
  const [selectedOptionIndex, setSelectedOptionIndex] = useState<number | null>(null);
  const clockOffsetRef = useRef(0);
  const deadlineRefreshRef = useRef(false);

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
      setSelectedOptionIndex(null);
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
    async function initializeGame() {
      let acceptanceError: string | null = null;

      if (autoAccept) {
        try {
          await readJson(await fetch(`/api/user/games/${encodeURIComponent(gameId)}/accept${getQuery()}`, { method: "POST" }));
        } catch (error) {
          acceptanceError = error instanceof Error ? error.message : "Unable to accept the game.";
        }
      }

      await loadGame();
      if (acceptanceError) {
        setFeedback(acceptanceError);
      }
    }

    void initializeGame();
  }, [gameId, autoAccept]);

  useEffect(() => {
    const source = new EventSource("/api/internal/events");

    source.onmessage = (event) => {
      const payload = JSON.parse(event.data) as { scope?: string };
      if (payload.scope === "all" || payload.scope === "game") {
        void loadGame({ silent: true });
      }
    };

    return () => source.close();
  }, [gameId, identifier]);

  useEffect(() => {
    const activeDeadline = game?.countdownDeadline ?? game?.questionDeadline;

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
  }, [game?.countdownDeadline, game?.questionDeadline]);

  async function runAction(action: "accept" | "start") {
    setIsMutating(true);
    try {
      await readJson(await fetch(`/api/user/games/${encodeURIComponent(gameId)}/${action}${getQuery()}`, { method: "POST" }));
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
        body: JSON.stringify({ role }),
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

    setIsMutating(true);
    try {
      const payload = await readJson<{ answer: GameAnswer }>(
        await fetch(`/api/user/games/${encodeURIComponent(gameId)}/answer${getQuery()}`, {
          body: JSON.stringify({ optionIndex: selectedOptionIndex, questionIndex: game.currentQuestionIndex }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        }),
      );
      setFeedback(`Answered (${payload.answer.points >= 0 ? "+" : ""}${payload.answer.points})`);
      await loadGame({ silent: true });
    } catch (error) {
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
        <span className="eyebrow">Player</span>
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
          <section className="workspace-card game-question-panel">
            <p className="eyebrow">Game waiting room</p>
            <h1>{game.title}</h1>
            <div className="game-rules-list">
              <h2>Game rules</h2>
              <p>{game.rules.questionCount} questions, {game.rules.questionDurationMs / 1000} seconds each.</p>
              <p>Correct answer points by order: {game.rules.correctPoints.join(", ")}.</p>
              <p>Incorrect or unanswered: {game.rules.incorrectPoints} points.</p>
              <p>The next question starts early when every competitor answers.</p>
            </div>
            {game.isCreator && game.status === "upcoming" ? (
              <div className="form-stack">
                <h2>Choose your role</h2>
                <div className="game-role-selector" role="group" aria-label="Creator game role">
                  <button aria-pressed={game.creatorRole === "participant"} className="button-secondary" disabled={isMutating} type="button" onClick={() => void chooseCreatorRole("participant")}>Join Game</button>
                  <button aria-pressed={game.creatorRole === "spectator"} className="button-secondary" disabled={isMutating} type="button" onClick={() => void chooseCreatorRole("spectator")}>Watch Game</button>
                </div>
              </div>
            ) : null}
            <div className="inline-actions">
              {!game.isCreator && !game.isAccepted && game.status === "upcoming" ? <button className="button" disabled={isMutating} type="button" onClick={() => void runAction("accept")}>Accept</button> : null}
              {game.isCreator && game.status === "upcoming" ? <button className="button" disabled={isMutating || !game.canStart} type="button" onClick={() => void runAction("start")}>Start Game</button> : null}
            </div>
            {game.isCreator && game.status === "upcoming" && !game.creatorRole ? <p className="muted-text">Choose Join Game or Watch Game before starting.</p> : null}
          </section>
          <aside className="workspace-card game-leaderboard-panel">
            <p className="eyebrow">Accepted competitors</p>
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

  if (game.status === "completed") {
    return (
      <div className="game-page-stack">
        {userBanner}
        <div className="game-runner-layout">
          <section className="workspace-card game-question-panel">
            <p className="eyebrow">{game.isMissed ? "Missed game" : "Completed game"}</p>
            <h1>{game.title}</h1>
            {game.isMissed ? <p>You did not accept before the game started. Final results are available below.</p> : null}
            {game.reviewQuestions.length ? (
              <div className="review-list game-question-review-list">
                {game.reviewQuestions.map((question) => (
                  <article className="game-question-review" key={question.id}>
                    <div className="question-head">
                      <h2>{question.questionIndex + 1}. {question.prompt}</h2>
                      {question.answer ? <strong>{question.answer.points >= 0 ? "+" : ""}{question.answer.points}</strong> : null}
                    </div>
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
                ))}
              </div>
            ) : <p className="muted-text">Spectator view: no personal responses were recorded.</p>}
          </section>
          <GameLeaderboard game={game} />
        </div>
      </div>
    );
  }

  const hasAnswered = game.currentQuestionIndex !== null && game.ownAnswers.some(
    (answer) => answer.questionIndex === game.currentQuestionIndex,
  );
  const latestOwnAnswer = game.ownAnswers[game.ownAnswers.length - 1];

  return (
    <div className="game-page-stack">
      {userBanner}
      <div className="game-runner-layout">
        <section className="workspace-card game-question-panel">
        <div className="question-head">
          <div>
            <p className="eyebrow">Question {(game.currentQuestionIndex ?? 0) + 1} of 20</p>
            <h1>{game.title}</h1>
          </div>
          <strong className="game-countdown">{Math.ceil(remainingMs / 1000)}s</strong>
        </div>
        {game.currentQuestion ? (
          <div className="form-stack">
            <h2>{game.currentQuestion.prompt}</h2>
            <div className="game-answer-grid">
              {game.currentQuestion.options.map((option, optionIndex) => (
                <button
                  aria-pressed={selectedOptionIndex === optionIndex}
                  className={`role-option game-answer-option${selectedOptionIndex === optionIndex ? " is-selected" : ""}`}
                  disabled={game.viewerMode === "spectator" || hasAnswered || isMutating}
                  key={`${game.currentQuestion?.id}-${optionIndex}`}
                  type="button"
                  onClick={() => setSelectedOptionIndex(optionIndex)}
                >
                  {option}
                </button>
              ))}
            </div>
            {game.viewerMode === "participant" ? (
              <button className="button" disabled={selectedOptionIndex === null || hasAnswered || isMutating} type="button" onClick={() => void submitAnswer()}>
                {hasAnswered ? "Answer submitted" : "Submit answer"}
              </button>
            ) : <p className="status-chip warning">Watching as spectator</p>}
          </div>
        ) : <p className="muted-text">Preparing the next question...</p>}
          {feedback ? <p className="muted-text">{feedback}</p> : latestOwnAnswer?.kind === "timeout" ? <p className="muted-text">Previous question timed out ({latestOwnAnswer.points})</p> : null}
        </section>
        <GameLeaderboard game={game} />
      </div>
    </div>
  );
}

function GameLeaderboard({ game }: { game: GameState }) {
  return (
    <aside className="workspace-card game-leaderboard-panel">
      <p className="eyebrow">Live leaderboard</p>
      <div className="game-leaderboard-list">
        {game.leaderboard.map((entry) => {
          const recentDelta = [...game.recentDeltas].reverse().find((delta) =>
            delta.participantIdentifier === entry.participantIdentifier
            && Date.now() - new Date(delta.answeredAt).getTime() < 5000,
          );
          return (
            <div className="game-leaderboard-row" key={entry.participantIdentifier}>
              <strong>#{entry.rank} {entry.participantLabel}</strong>
              <span>{entry.points} pts</span>
              <span className="game-score-flash">
                {recentDelta ? `Answered (${recentDelta.points >= 0 ? "+" : ""}${recentDelta.points})` : ""}
              </span>
            </div>
          );
        })}
      </div>
    </aside>
  );
}
