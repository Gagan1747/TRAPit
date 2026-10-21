import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { createEmptyTestingWorkspaceState, getTestMarks, type TestingWorkspaceState } from "../src/quiz";

vi.mock("server-only", () => ({}));
vi.mock("../../../apps/web/lib/poll-store", () => ({ isDynamoDbPollStoreEnabled: () => false }));
vi.mock("../../../apps/web/lib/notification-store", () => ({ reconcileBrowserNotificationIntents: async () => ({}) }));

let directory: string;
let file: string;
let store: typeof import("../../../apps/web/lib/testing-store");
let state: TestingWorkspaceState;
const owner = "+919111111111";
const members = [owner, "+919222222222", "+919333333333", "+919444444444", "+919555555555"];
const epoch = Date.parse("2026-11-01T10:00:00.000Z");

beforeAll(async () => {
  directory = await mkdtemp(path.join(process.cwd(), ".assessment-sessions-"));
  file = path.join(directory, "workspace.json");
  vi.stubEnv("TRAPIT_DATA_FILE", file);
  store = await import("../../../apps/web/lib/testing-store");
});
afterAll(async () => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  await rm(directory, { recursive: true, force: true });
});
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(epoch);
  state = createEmptyTestingWorkspaceState();
  const timestamp = new Date().toISOString();
  state.participants = members.map((identifier, index) => ({ id: `p${index}`, identifier, label: `User ${index}`, createdAt: timestamp, updatedAt: timestamp }));
  state.participantGroups = ["a", "b"].map((id) => ({
    id, name: id, ownerIdentifier: owner, description: "", inviteJoinMode: "automatic",
    participantIds: ["p0", "p1", "p2", "p3"], shareCode: null, createdAt: timestamp, updatedAt: timestamp,
  }));
  state.questions = Array.from({ length: 20 }, (_, index) => ({
    id: `q${index}`, prompt: `Question ${index}`, options: ["A", "B", "C", "D"], correctOptionIndex: 0,
    createdAt: timestamp, updatedAt: timestamp, createdBy: "owner", source: "manual", poolIds: ["pool"],
  }));
  state.pools = [{ id: "pool", name: "Pool", description: "", createdBy: "owner", createdAt: timestamp, updatedAt: timestamp, sharedWithIdentifiers: [], questionIds: state.questions.map((question) => question.id) }];
  await writeFile(file, JSON.stringify(state));
});

async function create(kind: "standard" | "instant" = "standard", overrides: Partial<Parameters<typeof store.createScheduledTest>[0]> = {}) {
  const tests = await store.createScheduledTest({
    actorIdentifier: owner, createdBy: "owner", assessmentKind: kind, title: "New test",
    participantGroupIds: ["a", "b"], participantIds: [], poolId: "pool", questionCount: 20,
    durationMinutes: 5, startsAt: new Date(epoch + 60_000).toISOString(), ...overrides,
  });
  return tests[0];
}
const persisted = async () => JSON.parse(await readFile(file, "utf8")) as TestingWorkspaceState;

describe("versioned test sessions", () => {
  it("opens Standard entry at T-1 minute but withholds questions until a named participant reaches T", async () => {
    const test = await create();
    expect((await store.listAvailableTestsForParticipant(owner))[0]).toMatchObject({ status: "live", questions: [] });
    expect((await store.getTestParticipantSession(test.id, owner)).test.questions).toEqual([]);
    await expect(store.saveTestParticipantSession({ testId: test.id, identifier: owner, participantName: " " })).rejects.toThrow("name");
    await store.saveTestParticipantSession({ testId: test.id, identifier: owner, participantName: "Owner" });
    expect((await store.getTestParticipantSession(test.id, owner)).test.questions).toEqual([]);
    vi.setSystemTime(epoch + 60_000);
    const payload = await store.getTestParticipantSession(test.id, owner);
    expect(payload.test.questions).toHaveLength(20);
    expect(payload.test.questions[0]).not.toHaveProperty("correctOptionIndex");
    expect((await store.getTestParticipantSession(test.id, members[1])).test.questions).toEqual([]);
  });

  it("rejects early entry, saves invalid questions/options explicitly, and preserves newest revision", async () => {
    const test = await create("standard", { startsAt: new Date(epoch + 120_000).toISOString() });
    await expect(store.saveTestParticipantSession({ testId: test.id, identifier: owner, participantName: "Owner" })).rejects.toThrow("one minute");
    vi.setSystemTime(epoch + 120_000);
    await store.saveTestParticipantSession({ testId: test.id, identifier: owner, participantName: "Owner" });
    await store.saveTestParticipantSession({ testId: test.id, identifier: owner, answers: { q0: 0 }, revision: 2 });
    await expect(store.saveTestParticipantSession({ testId: test.id, identifier: owner, answers: { q0: 3 }, revision: 1 })).rejects.toThrow("newer answer revision");
    expect((await store.getTestParticipantSession(test.id, owner)).session?.answers).toEqual({ q0: 0 });
    await expect(store.saveTestParticipantSession({ testId: test.id, identifier: owner, answers: { foreign: 0 }, revision: 3 })).rejects.toThrow("invalid");
    await expect(store.saveTestParticipantSession({ testId: test.id, identifier: owner, answers: { q0: 8 }, revision: 3 })).rejects.toThrow("invalid");
  });

  it("auto-finalizes saved Standard answers once at expiry without an open client", async () => {
    const test = await create();
    vi.setSystemTime(epoch + 60_000);
    await store.saveTestParticipantSession({ testId: test.id, identifier: owner, participantName: "Owner", answers: { q0: 0, q1: 3 }, revision: 1 });
    vi.setSystemTime(epoch + 360_000);
    await Promise.all([store.reconcileExpiredTestSessions(), store.reconcileExpiredTestSessions()]);
    const attempts = (await persisted()).attempts;
    expect(attempts).toHaveLength(1);
    expect(attempts[0].result.correctMarks).toBe(1);
    expect(getTestMarks(attempts[0].result)).toBe(-18);
    expect((await store.getTestParticipantSession(test.id, members[1])).session).toBeNull();
    await expect(store.saveTestParticipantSession({ testId: test.id, identifier: owner, answers: { q0: 0 }, revision: 2 })).rejects.toThrow("ended");
  });

  it("starts Instant only after four accept, includes a 60s countdown, and locks new entry", async () => {
    state.participantGroups[1].participantIds.push("p4");
    await writeFile(file, JSON.stringify(state));
    const test = await create("instant");
    await expect(store.startInstantTest(test.id, members[1])).rejects.toThrow("creator");
    await expect(store.startInstantTest(test.id, owner)).rejects.toThrow("4 participants");
    for (const identifier of members.slice(0, 4)) {
      await store.saveTestParticipantSession({ testId: test.id, identifier, participantName: identifier });
    }
    const start = await store.startInstantTest(test.id, owner);
    expect(Date.parse(start.test.startsAt)).toBe(epoch + 60_000);
    expect(start.test.questions).toEqual([]);
    await expect(store.saveTestParticipantSession({ testId: test.id, identifier: members[4], participantName: "Late" })).rejects.toThrow("launched");
    vi.setSystemTime(epoch + 60_000);
    await store.saveTestParticipantSession({ testId: test.id, identifier: owner, answers: { q0: 0 }, revision: 1 });
    const response = await store.submitVersionedTest(test.id, owner);
    expect(response.resultReleased).toBe(false);
    await store.submitVersionedTest(test.id, owner);
    expect((await persisted()).attempts).toHaveLength(1);
    expect(getTestMarks((await persisted()).attempts[0].result)).toBe(-15);
  });

  it("validates unique audience, group ownership, configuration and future link restrictions", async () => {
    await expect(create("instant", { participantGroupIds: [] })).rejects.toThrow("group");
    await expect(create("standard", { actorIdentifier: members[1] })).rejects.toThrow("created by you");
    await expect(create("standard", { durationMinutes: 7 })).rejects.toThrow("duration");
    await expect(create("standard", { questionCount: 10 })).rejects.toThrow("question count");
    await expect(create("standard", { generateInviteLink: true })).rejects.toThrow("group links");
    await expect(create("standard", { title: "x".repeat(31) })).rejects.toThrow("30");
    state.participantGroups.forEach((group) => { group.participantIds = ["p0", "p1", "p2"]; });
    await writeFile(file, JSON.stringify(state));
    await expect(create("instant")).rejects.toThrow("4 unique");
  });

  it("preserves legacy records and permits current-member counts without deleting recorded sessions", async () => {
    const legacy = await create();
    state = await persisted();
    delete state.scheduledTests[0].rulesVersion;
    delete state.scheduledTests[0].assessmentKind;
    state.scheduledTests[0].shareCode = "OLD-LINK";
    await writeFile(file, JSON.stringify(state));
    await store.reconcileExpiredTestSessions();
    const saved = (await persisted()).scheduledTests[0];
    expect(saved.id).toBe(legacy.id);
    expect(saved.shareCode).toBe("OLD-LINK");
    expect(saved.rulesVersion).toBeUndefined();
  });
});
