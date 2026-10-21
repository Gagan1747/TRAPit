import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { createEmptyTestingWorkspaceState, type ScheduledTest, type TestingWorkspaceState } from "../src/quiz";

vi.mock("server-only", () => ({}));
vi.mock("../../../apps/web/lib/poll-store", () => ({}));

const directory = path.resolve(`.test-results-${process.pid}`);
const storePath = path.join(directory, "workspace.json");
const timestamp = "2026-01-01T00:00:00.000Z";
const identifier = (index: number) => `+91900000${String(index).padStart(4, "0")}`;
let store: typeof import("../../../apps/web/lib/testing-store");
let state: TestingWorkspaceState;

beforeAll(async () => {
  await mkdir(directory, { recursive: true });
  vi.stubEnv("TRAPIT_DATA_FILE", storePath);
  vi.stubEnv("TRAPIT_DATA_DIR", directory);
  store = await import("../../../apps/web/lib/testing-store");
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await rm(directory, { recursive: true, force: true });
});

beforeEach(async () => {
  state = createEmptyTestingWorkspaceState();
  state.participants = Array.from({ length: 14 }, (_, index) => ({
    id: `participant-${index}`, identifier: identifier(index), label: `Person ${index}`,
    createdAt: timestamp, updatedAt: timestamp,
  }));
  state.participants.push({ ...state.participants[0], id: "phone-alias", identifier: "9000000000" });
  state.participantGroups = ["group-1", "group-2"].map((id) => ({
    id, name: id, description: "", createdAt: timestamp, updatedAt: timestamp,
    inviteJoinMode: "automatic", ownerIdentifier: identifier(0), shareCode: null,
    participantIds: state.participants.map((participant) => participant.id),
  }));
  state.questions = ["q1", "q2"].map((id) => ({
    id, prompt: id, options: ["A", "B", "C", "D"], correctOptionIndex: 0,
    createdAt: timestamp, updatedAt: timestamp, createdBy: "creator", poolIds: [], source: "manual",
  }));
  const test: ScheduledTest = {
    id: "test-1", createdAt: timestamp, updatedAt: timestamp, createdBy: "creator",
    durationMinutes: 10, participantGroupIds: ["group-1", "group-2"], participantIds: [],
    poolId: "pool-1", questionCount: 2, questionIds: ["q1", "q2"],
    resolvedParticipantIdentifiers: [], shareCode: null, startsAt: timestamp,
    status: "completed", title: "Results test", inviteJoinMode: "automatic",
  };
  state.scheduledTests = [test];
  state.attempts = Array.from({ length: 12 }, (_, index) => ({
    id: `attempt-${index}`, testId: test.id, userId: identifier(index),
    participantName: index === 0 ? identifier(0) : `Person ${index}`,
    answers: index === 11 ? { q1: 0 } : { q1: 0, q2: 3 },
    startedAt: timestamp, completedAt: "2026-01-01T00:01:00.000Z",
    result: { attemptedCount: 1, correctCount: 1, incorrectCount: 0, totalCount: 2, elapsedMs: (index + 1) * 1000 },
  }));
  await writeFile(storePath, JSON.stringify(state));
});

const results = (index: number, actorId = `actor-${index}`) => store.getTestResults({
  actorId, participantIdentifier: identifier(index), testId: "test-1",
});

describe("completed test results privacy and standings", () => {
  it("returns the first ten rows and exact own rank outside the top ten, masking contacts before serialization", async () => {
    const payload = await results(11);
    expect(payload.participants.map((entry) => entry.rank)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12]);
    expect(payload.participants.filter((entry) => entry.isCurrentParticipant).map((entry) => entry.rank)).toEqual([12]);
    expect(payload.participants[0]).toMatchObject({ maskedIdentifier: "+********0000", manualName: "+********0000", marks: 3 });
    expect(JSON.stringify(payload)).not.toContain(identifier(0));
    expect(payload.summary).toMatchObject({ submittedCount: 12, sharedCount: 14 });
  });

  it("highlights the exact own row in the top ten without adding an extra row", async () => {
    const payload = await results(3);
    expect(payload.participants).toHaveLength(10);
    expect(payload.participants.filter((entry) => entry.isCurrentParticipant).map((entry) => entry.rank)).toEqual([4]);
  });

  it("gives creators every standing even when they also participated", async () => {
    const payload = await results(11, "creator");
    expect(payload.hasCreatorScope).toBe(true);
    expect(payload.hasParticipantScope).toBe(true);
    expect(payload.participants).toHaveLength(12);
  });

  it("exposes only own selected options and never another participant's individual answers", async () => {
    const payload = await results(11);
    expect(payload.questions.map((question) => question.selectedOptionIndex)).toEqual([0, null]);
    expect(payload.participants.every((entry) => !("answers" in entry) && !("participantId" in entry))).toBe(true);
    expect(payload.questions[1].optionSelectionCounts).toEqual([0, 0, 0, 11]);
    const creator = await store.getTestResults({ actorId: "creator", participantIdentifier: "+919999999999", testId: "test-1" });
    expect(creator.questions.every((question) => question.selectedOptionIndex === null)).toBe(true);
  });

  it("preserves legacy marks and respects new Standard and Instant result scoring", async () => {
    state.attempts[0].result.correctMarks = 1;
    state.attempts[1].result.correctMarks = 4;
    await writeFile(storePath, JSON.stringify(state));
    const payload = await results(0, "creator");
    expect(payload.participants.find((entry) => entry.isCurrentParticipant)?.marks).toBe(0);
    expect(payload.participants.find((entry) => entry.manualName === "Person 1")?.marks).toBe(3);
    expect(payload.participants.find((entry) => entry.manualName === "Person 2")?.marks).toBe(3);
  });

  it("denies actors outside the shared audience", async () => {
    await expect(results(99)).rejects.toThrow("access");
  });

  it("includes expired joined sessions with unanswered questions in the submitted count", async () => {
    state.scheduledTests[0].rulesVersion = 2;
    state.scheduledTests[0].assessmentKind = "standard";
    state.scheduledTests[0].participantSessions = [{
      identifier: identifier(12), participantName: "Joined only", joinedAt: timestamp,
      startedAt: timestamp, answers: {}, revision: 0, submittedAt: null,
    }];
    await writeFile(storePath, JSON.stringify(state));
    const payload = await results(12, "creator");
    expect(payload.summary.submittedCount).toBe(13);
    expect(payload.participants.find((entry) => entry.isCurrentParticipant)).toMatchObject({
      marks: -2, incorrectCount: 0, unansweredCount: 2,
    });
  });
});
