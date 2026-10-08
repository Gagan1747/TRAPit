import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { createEmptyTestingWorkspaceState, createParticipantGroup, createParticipantProfile, type ScheduledPoll } from "../src/index";

const backend = vi.hoisted(() => ({ enabled: false, polls: [] as ScheduledPoll[], list: vi.fn(), create: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("../../../apps/web/lib/poll-store", () => ({
  isDynamoDbPollStoreEnabled: () => backend.enabled,
  listAllScheduledPollsFromBackend: backend.list,
  createScheduledPollInBackend: backend.create,
}));
const directory = path.resolve(".browser-eligibility-test-data");
let testing: typeof import("../../../apps/web/lib/testing-store");
let notifications: typeof import("../../../apps/web/lib/notification-store");
let state = createEmptyTestingWorkspaceState();
const poll = (id: string, groupIds: string[]): ScheduledPoll => ({
  id, participantGroupIds: groupIds, anonymous: true, participantType: "open", openPollRequiresRegistration: false,
  createdAt: "2026-10-08T10:00:00Z", updatedAt: "2026-10-08T10:00:00Z", createdBy: "admin",
  startsAt: "2026-10-08T11:00:00Z", endsAt: "2026-10-08T12:00:00Z",
  shareCode: "PUBLIC", title: "Private poll name", status: "scheduled", questionIds: ["question"],
});
const persist = () => writeFile(path.join(directory, "workspace.json"), JSON.stringify(state), "utf8");
beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-08T10:00:00Z"));
  backend.enabled = false;
  backend.polls = [];
  backend.list.mockReset().mockImplementation(async () => backend.polls);
  backend.create.mockReset().mockImplementation(async () => backend.polls);
  await mkdir(directory, { recursive: true });
  vi.stubEnv("TRAPIT_DATA_FILE", path.join(directory, "workspace.json"));
  vi.stubEnv("TRAPIT_NOTIFICATION_FILE", path.join(directory, "notifications.json"));
  state = createEmptyTestingWorkspaceState();
  const member = createParticipantProfile({ identifier: "member@example.com" });
  const stranger = createParticipantProfile({ identifier: "public@example.com" });
  state.participants = [member, stranger];
  state.participantGroups = [createParticipantGroup({ name: "Assigned", participantIds: [member.id], ownerIdentifier: "admin@example.com" })];
  state.scheduledPolls = [poll("assigned", [state.participantGroups[0].id]), poll("public", [])];
  await persist();
  testing = await import("../../../apps/web/lib/testing-store");
  notifications = await import("../../../apps/web/lib/notification-store");
});
afterEach(async () => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  await rm(directory, { recursive: true, force: true });
});

describe("file and DynamoDB scheduling recipient recovery", () => {
  it("includes only explicit test invitees and current assigned group members, not public viewers", async () => {
    state.scheduledTests = [{
      id: "test", createdAt: "2026-10-08T10:00:00Z", updatedAt: "2026-10-08T10:00:00Z", createdBy: "admin",
      startsAt: "2026-10-08T11:00:00Z", durationMinutes: 60, status: "scheduled", title: "Test",
      inviteJoinMode: "approval-required", participantIds: ["invited@example.com"], participantGroupIds: [state.participantGroups[0].id],
      resolvedParticipantIdentifiers: ["stale@example.com"], poolId: "pool", questionIds: ["question"], questionCount: 1, shareCode: null,
    }];
    await persist();
    const schedules = await testing.listBrowserNotificationSchedules();
    expect(schedules.find((item) => item.id === "test")?.recipients).toEqual(["invited@example.com", "member@example.com"]);
    expect(schedules.find((item) => item.id === "assigned")?.recipients).toEqual(["member@example.com"]);
    expect(schedules.find((item) => item.id === "public")?.recipients).toEqual([]);
    state.participantGroups[0].participantIds = [];
    await persist();
    expect((await testing.listBrowserNotificationSchedules()).find((item) => item.id === "assigned")?.recipients).toEqual([]);
  });
  it("recovers current DynamoDB recurring instances with file-backed group membership and never falls back on read errors", async () => {
    backend.enabled = true;
    backend.polls = [poll("cycle-1", [state.participantGroups[0].id]), poll("cycle-2", [state.participantGroups[0].id])];
    expect((await testing.listBrowserNotificationSchedules()).map((item) => item.id)).toEqual(["cycle-1", "cycle-2"]);
    backend.list.mockRejectedValueOnce(new Error("DynamoDB unavailable"));
    await expect(testing.listBrowserNotificationSchedules()).rejects.toThrow("DynamoDB unavailable");
  });
  it("baselines before a backend mutation and recovers committed schedules even when post-mutation execution is interrupted", async () => {
    backend.enabled = true;
    backend.create.mockImplementation(async () => {
      backend.polls = [poll("new", [state.participantGroups[0].id])];
      throw new Error("Interrupted after backend commit");
    });
    await expect(testing.createScheduledPoll({
      anonymous: true, createdBy: "admin", participantType: "open", participantGroupIds: [state.participantGroups[0].id],
      questionIds: ["question"], startsAt: "2026-10-08T11:00:00Z", endsAt: "2026-10-08T12:00:00Z",
      generateQrCode: true, title: "New",
    })).rejects.toThrow("Interrupted");
    const intents = await notifications.reconcileBrowserNotificationIntents(await testing.listBrowserNotificationSchedules());
    expect(intents).toHaveLength(1);
    expect(intents[0]).toMatchObject({ phase: "confirmed", entityId: "new", recipientIdentifier: "member@example.com" });
    expect(JSON.parse(await readFile(path.join(directory, "notifications.json"), "utf8")).browserBaseline).toBe(true);
  });
});
