import { describe, expect, it } from "vitest";

import {
  buildGameLeaderboard,
  createPresentedQuestions,
  dedupeParticipantIdentifiers,
  GAME_QUESTION_DURATION_MS,
  getNextGameQuestionStartedAt,
  getGameQuestionDeadline,
  getGameQuestionIndex,
  getGameStatus,
  participantIdentifiersMatch,
  type ScheduledGame,
} from "./quiz";

function createGame(overrides: Partial<ScheduledGame> = {}): ScheduledGame {
  return {
    answers: [],
    completedAt: null,
    countdownStartedAt: null,
    createdAt: "2026-09-04T10:00:00.000Z",
    createdBy: "creator-sub",
    creatorIdentifier: "creator@example.com",
    creatorRole: null,
    id: "game-1",
    participantGroupId: "group-1",
    participants: [],
    poolId: "pool-1",
    questionIds: Array.from({ length: 20 }, (_, index) => `question-${index + 1}`),
    questionStartedAt: [],
    rulesVersion: 2,
    startedAt: null,
    title: "Lifecycle game",
    updatedAt: "2026-09-04T10:00:00.000Z",
    ...overrides,
  };
}

describe("versioned game lifecycle", () => {
  it("matches equivalent participant phone and email identifiers", () => {
    expect(participantIdentifiersMatch("+91 95823-72662", "9582372662")).toBe(true);
    expect(participantIdentifiersMatch("User@Example.com", "user@example.com")).toBe(true);
    expect(participantIdentifiersMatch("9582372662", "9582372663")).toBe(false);
  });

  it("counts equivalent phone formats as one participant identity", () => {
    expect(dedupeParticipantIdentifiers([
      "+919582372662",
      "9582372662",
      "+919876543210",
      "player@example.com",
    ])).toEqual(["+919582372662", "+919876543210", "player@example.com"]);
  });

  it("reports the synchronized countdown before question one launches", () => {
    const game = createGame({ countdownStartedAt: "2026-09-04T10:01:00.000Z" });

    expect(getGameStatus(game, Date.parse("2026-09-04T10:01:30.000Z"))).toBe("countdown");
    expect(getGameQuestionIndex(game, Date.parse("2026-09-04T10:01:30.000Z"))).toBeNull();
  });

  it("uses persisted transition times and a 30-second question deadline", () => {
    const game = createGame({
      countdownStartedAt: "2026-09-04T10:00:00.000Z",
      questionStartedAt: ["2026-09-04T10:01:00.000Z", "2026-09-04T10:01:12.000Z"],
      startedAt: "2026-09-04T10:01:00.000Z",
    });

    expect(GAME_QUESTION_DURATION_MS).toBe(30_000);
    expect(getGameQuestionIndex(game, Date.parse("2026-09-04T10:01:13.000Z"))).toBe(1);
    expect(getGameQuestionDeadline(game, 1)).toBe("2026-09-04T10:01:42.000Z");
  });

  it("starts the next question when a delayed transition is observed", () => {
    const startedAt = getNextGameQuestionStartedAt(
      Date.parse("2026-09-04T10:01:30.000Z"),
      Date.parse("2026-09-04T10:01:42.000Z"),
    );
    const game = createGame({
      countdownStartedAt: "2026-09-04T10:00:00.000Z",
      questionStartedAt: ["2026-09-04T10:01:00.000Z", startedAt],
      startedAt: "2026-09-04T10:01:00.000Z",
    });

    expect(startedAt).toBe("2026-09-04T10:01:42.000Z");
    expect(getGameQuestionDeadline(game, 1)).toBe("2026-09-04T10:02:12.000Z");
  });

  it("preserves the legacy 15-second schedule for historical games", () => {
    const game = createGame({
      questionStartedAt: undefined,
      rulesVersion: 1,
      startedAt: "2026-09-04T10:00:00.000Z",
    });

    expect(getGameQuestionIndex(game, Date.parse("2026-09-04T10:00:16.000Z"))).toBe(1);
    expect(getGameStatus(game, Date.parse("2026-09-04T10:05:00.000Z"))).toBe("completed");
  });

  it("scores timeout records once and excludes spectators from the leaderboard", () => {
    const game = createGame({
      answers: [{
        answeredAt: "2026-09-04T10:01:30.000Z",
        isCorrect: false,
        kind: "timeout",
        optionIndex: null,
        participantIdentifier: "player@example.com",
        points: -5,
        questionIndex: 0,
        responsePosition: null,
      }],
      participants: [
        { acceptedAt: "2026-09-04T10:00:10.000Z", identifier: "player@example.com", label: "Player" },
        { acceptedAt: null, identifier: "viewer@example.com", label: "Viewer" },
      ],
    });

    expect(buildGameLeaderboard(game)).toEqual([{
      participantIdentifier: "player@example.com",
      participantLabel: "Player",
      points: -5,
      rank: 1,
    }]);
  });

  it("creates a stable, balanced option presentation for a game", () => {
    const questions = Array.from({ length: 20 }, (_, index) => ({
      correctOptionIndex: 1,
      id: `question-${index + 1}`,
      options: ["Alpha", "Bravo", "Charlie", "Delta"],
      prompt: `Question ${index + 1}`,
    }));

    const first = createPresentedQuestions(questions, "game-1");
    const second = createPresentedQuestions(questions, "game-1");
    const correctPositionCounts = first.reduce<Record<number, number>>((counts, question) => ({
      ...counts,
      [question.correctOptionIndex]: (counts[question.correctOptionIndex] ?? 0) + 1,
    }), {});

    expect(second).toEqual(first);
    expect(correctPositionCounts).toEqual({ 0: 5, 1: 5, 2: 5, 3: 5 });
    expect(first.every((question) =>
      question.originalOptionIndexes[question.correctOptionIndex] === question.question.correctOptionIndex,
    )).toBe(true);
  });

  it("keeps semantic options at the end of the displayed choices", () => {
    const [presented] = createPresentedQuestions([{
      correctOptionIndex: 0,
      id: "semantic-question",
      options: ["Alpha", "Bravo", "Both A and B", "All of the above"],
      prompt: "Semantic options",
    }], "semantic-game");

    expect(presented.displayOptions.slice(-2)).toEqual(["Both A and B", "All of the above"]);
  });
});
