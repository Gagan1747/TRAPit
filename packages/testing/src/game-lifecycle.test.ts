import { describe, expect, it } from "vitest";

import {
  buildGameLeaderboard,
  createPresentedQuestions,
  dedupeParticipantIdentifiers,
  GAME_QUESTION_DURATION_MS,
  getNextGameQuestionStartedAt,
  getGameQuestionDeadline,
  getGameQuestionIndex,
  getGamePresentedQuestionIndex,
  getGameStatus,
  getRapidGameDeadline,
  getRapidParticipantQuestionIndex,
  reconcileRapidGame,
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

  describe("Rapid version 4 independent lifecycle", () => {
    const launch = Date.parse("2026-09-04T10:01:00.000Z");
    const iso = (milliseconds: number) => new Date(milliseconds).toISOString();
    function rapid() {
      return createGame({
        rulesVersion: 4, countdownStartedAt: iso(launch - 60_000),
        participants: ["a", "b", "c", "d", "e", "f"].map((name) => ({
          identifier: `${name}@example.com`, label: name, acceptedAt: iso(launch - 70_000),
          questionStartedAt: [],
        })),
      });
    }

    it("launches at exactly 60 seconds and closes exactly ten minutes later", () => {
      const game = rapid();
      expect(getGameStatus(game, launch - 1)).toBe("countdown");
      reconcileRapidGame(game, launch);
      expect(game.startedAt).toBe(iso(launch));
      expect(getGameStatus(game, launch)).toBe("ongoing");
      expect(getRapidGameDeadline(game)).toBe(launch + 600_000);
      reconcileRapidGame(game, launch + 600_000);
      expect(game.completedAt).toBe(iso(launch + 600_000));
      expect(game.answers).toHaveLength(120);
      expect(game.answers.every((answer) => answer.points === -5 && answer.kind === "timeout")).toBe(true);
    });

    it("keeps a fast answer on its question until the participant's persisted window ends", () => {
      const game = rapid();
      game.participants[0].questionStartedAt = [iso(launch)];
      game.answers.push({
        answeredAt: iso(launch + 100), elapsedMs: 100, isCorrect: true, kind: "submitted",
        optionIndex: 0, participantIdentifier: game.participants[0].identifier, points: 0, questionIndex: 0,
      });
      reconcileRapidGame(game, launch + 100);
      expect(getRapidParticipantQuestionIndex(game, game.participants[0], launch + 29_999)).toBe(0);
      expect(getRapidParticipantQuestionIndex(game, game.participants[0], launch + 30_000)).toBe(1);
      expect(getRapidParticipantQuestionIndex(game, game.participants[1], launch + 30_000)).toBe(0);
      expect(game.completedAt).toBeNull();
    });

    it("does not reset a background participant or wait for the slowest", () => {
      const game = rapid();
      game.participants[0].questionStartedAt = [iso(launch)];
      game.participants[1].questionStartedAt = [iso(launch + 10_000)];
      reconcileRapidGame(game, launch + 35_000);
      const restored = JSON.parse(JSON.stringify(game)) as ScheduledGame;
      expect(getRapidParticipantQuestionIndex(restored, restored.participants[0], launch + 35_000)).toBe(1);
      expect(getRapidParticipantQuestionIndex(restored, restored.participants[1], launch + 35_000)).toBe(0);
      expect(restored.participants[0].questionStartedAt?.[0]).toBe(iso(launch));
      reconcileRapidGame(restored, launch + 35_000);
      expect(restored.answers).toHaveLength(1);
    });

    it("clips a late displayed question at the global deadline and resolves undisplayed questions once", () => {
      const game = rapid();
      game.participants[0].questionStartedAt = [iso(launch + 599_000)];
      reconcileRapidGame(game, launch + 600_000);
      expect(game.answers[0].elapsedMs).toBe(1000);
      expect(game.answers[0].answeredAt).toBe(iso(launch + 600_000));
      const count = game.answers.length;
      reconcileRapidGame(game, launch + 900_000);
      expect(game.answers).toHaveLength(count);
      expect(game.completedAt).toBe(iso(launch + 600_000));
    });

    it("recomputes speed positions regardless of answer arrival and preserves shared overall ranks", () => {
      const game = rapid();
      game.participants.forEach((participant, index) => {
        game.answers.push({
          answeredAt: iso(launch + 10_000 + index), elapsedMs: (6 - index) * 1000,
          isCorrect: true, kind: "submitted", optionIndex: 0, participantIdentifier: participant.identifier,
          points: 0, questionIndex: 0,
        });
      });
      reconcileRapidGame(game, launch + 20_000);
      expect(game.answers.map((answer) => answer.points)).toEqual([0, 5, 5, 10, 30, 50]);
      expect(buildGameLeaderboard(game).filter((entry) => entry.points === 5).map((entry) => entry.rank)).toEqual([4, 4]);
      expect(game.completedAt).toBeNull();
    });
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

  it("presents a version-3 question before its timer starts", () => {
    const game = createGame({
      countdownStartedAt: "2026-09-04T10:00:00.000Z",
      questionPreparedAt: ["2026-09-04T10:01:00.000Z"],
      questionReadyParticipantIdentifiers: [[]],
      rulesVersion: 3,
    });
    const now = Date.parse("2026-09-04T10:01:01.000Z");

    expect(getGameStatus(game, now)).toBe("ongoing");
    expect(getGamePresentedQuestionIndex(game, now)).toBe(0);
    expect(getGameQuestionIndex(game, now)).toBeNull();
    expect(getGameQuestionDeadline(game, 0)).toBeNull();
  });

  it("starts a version-3 deadline only from the persisted timer start", () => {
    const game = createGame({
      countdownStartedAt: "2026-09-04T10:00:00.000Z",
      questionPreparedAt: ["2026-09-04T10:01:00.000Z"],
      questionReadyParticipantIdentifiers: [["player@example.com"]],
      questionStartedAt: ["2026-09-04T10:01:03.000Z"],
      rulesVersion: 3,
      startedAt: "2026-09-04T10:01:03.000Z",
    });

    expect(getGamePresentedQuestionIndex(game, Date.parse("2026-09-04T10:01:04.000Z"))).toBe(0);
    expect(getGameQuestionIndex(game, Date.parse("2026-09-04T10:01:04.000Z"))).toBe(0);
    expect(getGameQuestionDeadline(game, 0)).toBe("2026-09-04T10:01:33.000Z");
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
