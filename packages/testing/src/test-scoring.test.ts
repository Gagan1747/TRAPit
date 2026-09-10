import { describe, expect, it } from "vitest";

import {
  buildTestLeaderboards,
  compareTestResults,
  getTestMarks,
  getUnansweredCount,
  type ScheduledTest,
  type TestAttempt,
  type TestResult,
} from "./quiz";

function createResult(overrides: Partial<TestResult> = {}): TestResult {
  return {
    attemptedCount: 4,
    correctCount: 2,
    elapsedMs: 60_000,
    incorrectCount: 2,
    totalCount: 4,
    ...overrides,
  };
}

function createAttempt(id: string, userId: string, result: TestResult): TestAttempt {
  return {
    answers: {},
    completedAt: `2026-09-11T10:00:0${id}.000Z`,
    id: `attempt-${id}`,
    participantName: userId,
    result,
    startedAt: "2026-09-11T09:55:00.000Z",
    testId: "test-1",
    userId,
  };
}

function createTest(): ScheduledTest {
  return {
    createdAt: "2026-09-10T10:00:00.000Z",
    createdBy: "creator-sub",
    durationMinutes: 10,
    id: "test-1",
    inviteJoinMode: "approval-required",
    participantGroupIds: [],
    participantIds: ["participant-1", "participant-2"],
    poolId: "pool-1",
    questionCount: 4,
    questionIds: ["q1", "q2", "q3", "q4"],
    resolvedParticipantIdentifiers: ["participant-1", "participant-2"],
    shareCode: null,
    startsAt: "2026-09-11T09:55:00.000Z",
    status: "completed",
    title: "Scoring test",
    updatedAt: "2026-09-11T10:10:00.000Z",
  };
}

describe("test marks and ranking", () => {
  it("awards four marks for correct answers and deducts one for incorrect and unanswered answers", () => {
    const result = createResult({ attemptedCount: 3, correctCount: 2, incorrectCount: 1 });

    expect(getUnansweredCount(result)).toBe(1);
    expect(getTestMarks(result)).toBe(6);
  });

  it("orders by marks, then penalty count, then elapsed time", () => {
    const highMarks = createResult({ attemptedCount: 4, correctCount: 3, incorrectCount: 1, elapsedMs: 80_000 });
    const lowMarks = createResult({ attemptedCount: 3, correctCount: 2, incorrectCount: 1, elapsedMs: 40_000 });
    const fewerPenalties = createResult({ attemptedCount: 3, correctCount: 1, incorrectCount: 2, totalCount: 3 });
    const morePenalties = createResult({ attemptedCount: 4, correctCount: 1, incorrectCount: 3, totalCount: 4 });
    const faster = createResult({ elapsedMs: 50_000 });
    const slower = createResult({ elapsedMs: 70_000 });

    expect(compareTestResults(highMarks, lowMarks)).toBeLessThan(0);
    expect(compareTestResults(fewerPenalties, morePenalties)).toBeLessThan(0);
    expect(compareTestResults(faster, slower)).toBeLessThan(0);
  });

  it("includes calculated marks and gives equal ranks only for equal ranking criteria", () => {
    const tiedResult = createResult({ attemptedCount: 3, correctCount: 2, elapsedMs: 50_000, incorrectCount: 1 });
    const slowerResult = createResult({ attemptedCount: 3, correctCount: 2, elapsedMs: 70_000, incorrectCount: 1 });
    const leaderboard = buildTestLeaderboards([
      createAttempt("1", "participant-1", tiedResult),
      createAttempt("2", "participant-2", tiedResult),
      createAttempt("3", "participant-3", slowerResult),
    ], [createTest()])[0];

    expect(leaderboard.entries.map((entry) => ({ marks: entry.marks, rank: entry.rank, unanswered: entry.unansweredCount }))).toEqual([
      { marks: 6, rank: 1, unanswered: 1 },
      { marks: 6, rank: 1, unanswered: 1 },
      { marks: 6, rank: 3, unanswered: 1 },
    ]);
  });
});