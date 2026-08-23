"use client";

import type { GameAnswer, GameLeaderboardEntry } from "@trapit/testing";
import { useEffect, useRef, useState } from "react";

type GameState = {
  acceptedCount: number;
  canStart: boolean;
  currentQuestion: { id: string; options: string[]; prompt: string } | null;
  currentQuestionIndex: number | null;
  isAccepted: boolean;
  isCreator: boolean;
  leaderboard: GameLeaderboardEntry[];
  ownAnswers: GameAnswer[];
  participantCount: number;
  participants: Array<{ accepted: boolean; identifier: string; label: string }>;
  questionDeadline: string | null;
  recentDeltas: Array<{ answeredAt: string; participantIdentifier: string; points: number }>;
  status: "completed" | "ongoing" | "upcoming";
  title: string;
};

type GamePayload = { game: GameState; serverNow: string };

type UserGameRunnerProps = {
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

export function UserGameRunner({ authConfigured, defaultParticipantIdentifier, gameId }: UserGameRunnerProps) {
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
      setFeedback(null);
      deadlineRefreshRef.current = false;
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Unable to load the game.");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void loadGame();
  }, [gameId]);

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
    if (!game?.questionDeadline) {
      setRemainingMs(0);
      return;
    }

    const tick = () => {
      const nextRemaining = Math.max(
        0,
        new Date(game.questionDeadline as string).getTime() - (Date.now() + clockOffsetRef.current),
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
  }, [game?.questionDeadline]);

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

  if (game.status === "upcoming") {
    return (
      <section className="workspace-card game-lobby">
        <p className="eyebrow">Game lobby</p>
        <h1>{game.title}</h1>
        <p className="muted-text">Accepted {game.acceptedCount}/{game.participantCount}. At least 4 participants are required.</p>
        <div className="game-lobby-roster">
          {game.participants.map((participant) => (
            <div className="game-lobby-participant" key={participant.identifier}>
              <span>{participant.label}</span>
              <span className={`status-chip ${participant.accepted ? "success" : "warning"}`}>
                {participant.accepted ? "Accepted" : "Pending"}
              </span>
            </div>
          ))}
        </div>
        <div className="inline-actions">
          {!game.isAccepted ? <button className="button" disabled={isMutating} type="button" onClick={() => void runAction("accept")}>Accept</button> : null}
          {game.isCreator ? <button className="button" disabled={isMutating || !game.canStart} type="button" onClick={() => void runAction("start")}>Start</button> : null}
        </div>
        {feedback ? <p className="muted-text">{feedback}</p> : null}
      </section>
    );
  }

  if (game.status === "completed") {
    const ownAnswerMap = new Map(game.ownAnswers.map((answer) => [answer.questionIndex, answer]));
    return (
      <div className="game-runner-layout">
        <section className="workspace-card">
          <p className="eyebrow">Completed game</p>
          <h1>{game.title}</h1>
          <div className="review-list">
            {Array.from({ length: 20 }, (_, questionIndex) => {
              const answer = ownAnswerMap.get(questionIndex);
              return (
                <div className="game-breakdown-row" key={questionIndex}>
                  <span>Question {questionIndex + 1}</span>
                  <strong>{answer ? `${answer.points >= 0 ? "+" : ""}${answer.points}` : "0"}</strong>
                </div>
              );
            })}
          </div>
        </section>
        <GameLeaderboard game={game} />
      </div>
    );
  }

  const hasAnswered = game.currentQuestionIndex !== null && game.ownAnswers.some(
    (answer) => answer.questionIndex === game.currentQuestionIndex,
  );

  return (
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
                  disabled={hasAnswered || isMutating}
                  key={`${game.currentQuestion?.id}-${optionIndex}`}
                  type="button"
                  onClick={() => setSelectedOptionIndex(optionIndex)}
                >
                  {option}
                </button>
              ))}
            </div>
            <button className="button" disabled={selectedOptionIndex === null || hasAnswered || isMutating} type="button" onClick={() => void submitAnswer()}>
              {hasAnswered ? "Answer submitted" : "Submit answer"}
            </button>
          </div>
        ) : <p className="muted-text">Preparing the next question...</p>}
        {feedback ? <p className="muted-text">{feedback}</p> : null}
      </section>
      <GameLeaderboard game={game} />
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
