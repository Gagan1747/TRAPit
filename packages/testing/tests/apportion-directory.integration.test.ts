import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createEmptyTestingWorkspaceState, normalizeWorkspaceBranding, type TestingWorkspaceState, type WorkspaceBranding } from "../src/quiz";
import type { WorkspaceActor } from "../../../apps/web/lib/workspace-actor";

vi.mock("server-only", () => ({}));
vi.mock("../../../apps/web/lib/auth-config", () => ({ isWebAuthConfigured: () => true }));
vi.mock("../../../apps/web/lib/poll-store", () => ({}));
const leaveFixtures = vi.hoisted(() => ({ apply: vi.fn() }));
vi.mock("../../../apps/web/lib/apportion-store", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../../apps/web/lib/apportion-store")>(),
  applyApportionProviderLeave: leaveFixtures.apply,
}));
const fixtures = vi.hoisted(() => ({ users: [] as Array<{ identifier: string; label: string; sub: string | null }>, assignments: [] as Array<{ userIdentifier: string | null; userSub: string | null; category: string; assignedAt: string; expiresAt: string | null }>, actorIdentifier: "+919111111111", readGate: null as (() => Promise<void>) | null, lookupGate: null as (() => Promise<void>) | null, directoryError: null as Error | null }));
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, readFile: async (...args: Parameters<typeof actual.readFile>) => {
    const content = await actual.readFile(...args);
    const gate = fixtures.readGate;
    if (gate) {
      fixtures.readGate = null;
      await gate();
    }
    return content;
  } };
});
vi.mock("../../../apps/web/lib/cognito", () => ({ listRegisteredDirectoryUsers: async () => {
  if (fixtures.directoryError) throw fixtures.directoryError;
  const gate = fixtures.lookupGate;
  fixtures.lookupGate = null;
  if (gate) await gate();
  return fixtures.users;
} }));
vi.mock("../../../apps/web/lib/user-category-store", () => ({ listUserCategoryManagementState: async () => ({ activeAssignments: fixtures.assignments }) }));
vi.mock("../../../apps/web/lib/workspace-actor", () => ({ getWorkspaceActor: async () => ({ identifier: fixtures.actorIdentifier, phoneNumber: fixtures.actorIdentifier }) }));

const OWNER = "+919111111111";
const STAFF = "+919222222222";
const ADMIN = "+919333333333";
const OTHER = "+919444444444";
let temporaryDirectory: string;
let storePath: string;
let directory: typeof import("../../../apps/web/lib/apportion-directory");
let store: typeof import("../../../apps/web/lib/testing-store");
let businessApi: typeof import("../../../apps/web/app/api/user/apportion/business/route");

function actor(identifier: string): WorkspaceActor {
  return { identifier, phoneNumber: identifier, sub: identifier, displayName: identifier, role: "user", isSuperAdmin: false, userCategory: "trapit-normal" };
}

function branding(start = "9:00 AM", end = "12:00 PM", id = "location-1"): WorkspaceBranding {
  return normalizeWorkspaceBranding({ instituteName: "Clinic", address: "Main Street", appointmentShareCode: "EXISTING-LINK", appointmentsPerSlot: 1, slotDurationMinutes: 10, justAddToList: true, imageDataUrl: "data:image/png;base64,logo", appointmentLocations: [{ id, name: "Main", address: "Main Street", workingDays: "Monday", workingHours: `${start} - ${end}`, workingHoursSecondWindow: "" }] } as WorkspaceBranding)!;
}

function assignment(owner: string, category = "trapit-pro") {
  return { userIdentifier: owner, userSub: null, category, assignedAt: "2026-01-01T00:00:00Z", expiresAt: null };
}

function service(id: string, provider: string | null = null, active = true, locationIds = ["location-1"]) {
  return { id, name: id, active, assignedIdentifier: provider, locationIds };
}

async function seed(profiles: Record<string, WorkspaceBranding> = { [OWNER]: branding() }) {
  const state = createEmptyTestingWorkspaceState();
  state.workspaceBrandingByActor = profiles;
  await writeFile(storePath, JSON.stringify(state));
}

async function persisted() {
  return JSON.parse(await readFile(storePath, "utf8")) as TestingWorkspaceState;
}

beforeAll(async () => {
  temporaryDirectory = await mkdtemp(path.join(tmpdir(), "trapit-apportion-directory-"));
  storePath = path.join(temporaryDirectory, "testing-workspace.json");
  vi.stubEnv("TRAPIT_DATA_FILE", storePath);
  vi.stubEnv("TRAPIT_DATA_DIR", temporaryDirectory);
  directory = await import("../../../apps/web/lib/apportion-directory");
  store = await import("../../../apps/web/lib/testing-store");
  businessApi = await import("../../../apps/web/app/api/user/apportion/business/route");
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await rm(temporaryDirectory, { recursive: true, force: true });
});

beforeEach(async () => {
  leaveFixtures.apply.mockReset().mockResolvedValue([]);
  fixtures.directoryError = null;
  fixtures.actorIdentifier = OWNER;
  fixtures.users = [OWNER, STAFF, ADMIN, OTHER].map((identifier) => ({ identifier, label: identifier, sub: identifier }));
  fixtures.assignments = [assignment(OWNER)];
  await seed();
});

describe("persistent Apportion directory", () => {
  it("searches service names and full owner/staff phones without disclosing staff phones", async () => {
    await directory.updateApportionPanel(actor(OWNER), { operation: "set-service", service: { ...service("staff", STAFF), name: "Paediatrician" } });
    for (const query of ["clinic", "paediatric", OWNER, STAFF, "9222222222", "+91 92222 22222"]) {
      const results = await store.listWorkspaceAppointmentBusinesses(query);
      expect(results).toHaveLength(1);
      expect(results[0].ownerIdentifier).toBe(OWNER);
      expect(JSON.stringify(results)).not.toContain(STAFF);
    }
    for (const query of ["92222", "+449222222222", "unrelated"]) {
      expect(await store.listWorkspaceAppointmentBusinesses(query)).toEqual([]);
    }
  });

  it("persists only newly added future personal leave intents before applying without the testing lock", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2026-10-04T18:31:00.000Z"));
      leaveFixtures.apply.mockImplementationOnce(async (providerIdentifier, closedDateKeys, leaveDateKey, leaveAt) => {
        const intent = (await persisted()).apportionDirectory!.pendingProviderLeaves![0];
        expect(intent).toMatchObject({ id: expect.any(String), providerIdentifier, closedDateKeys, leaveDateKey, leaveAt });
        await store.withSerializedTestingMutation((state) => { state.apportionDirectory!.scheduleNotifications = []; });
        return [];
      });
      await directory.updateApportionPanel(actor(OWNER), { operation: "set-leaves", closedDateKeys: ["2026-10-04", "2026-10-05", "2026-10-06", "2026-10-06"] });
      expect(leaveFixtures.apply).toHaveBeenCalledExactlyOnceWith(OWNER, ["2026-10-06"], "2026-10-05", "2026-10-04T18:31:00.000Z");
      expect((await persisted()).apportionDirectory!.pendingProviderLeaves).toEqual([]);
      await directory.updateApportionPanel(actor(OWNER), { operation: "set-leaves", closedDateKeys: ["2026-10-05", "2026-10-06"] });
      expect(leaveFixtures.apply).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("recovers personal leave after midnight using its original cutoff and timestamp", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2026-10-04T18:29:00.000Z"));
      leaveFixtures.apply.mockRejectedValueOnce(new Error("Temporary leave recovery failure"));
      await expect(directory.updateApportionPanel(actor(OWNER), { operation: "set-leaves", closedDateKeys: ["2026-10-05"] })).rejects.toThrow("Temporary leave recovery failure");
      const intent = (await persisted()).apportionDirectory!.pendingProviderLeaves![0];
      expect(intent).toMatchObject({ leaveDateKey: "2026-10-04", leaveAt: "2026-10-04T18:29:00.000Z" });
      expect((await store.readApportionWorkspaceState()).apportionDirectory!.pendingProviderLeaves).toEqual([intent]);
      vi.setSystemTime(new Date("2026-10-05T18:31:00.000Z"));
      expect(await directory.reconcileApportionProviderLeaves()).toBeUndefined();
      expect(leaveFixtures.apply).toHaveBeenLastCalledWith(OWNER, ["2026-10-05"], intent.leaveDateKey, intent.leaveAt);
      expect((await persisted()).apportionDirectory!.pendingProviderLeaves).toEqual([]);
      await directory.getApportionPanel(actor(OWNER));
      expect(leaveFixtures.apply).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("saves same-IST-day leave without requesting any appointment cancellation", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2026-10-04T18:31:00.000Z"));
      const panel = await directory.updateApportionPanel(actor(OWNER), { operation: "set-leaves", closedDateKeys: ["2026-10-05"] });
      expect(panel.providerClosedDateKeys).toEqual(["2026-10-05"]);
      expect((await persisted()).apportionDirectory!.pendingProviderLeaves ?? []).toEqual([]);
      expect(leaveFixtures.apply).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("reopening pending leave dates prevents their not-yet-applied cancellation", async () => {
    leaveFixtures.apply.mockRejectedValueOnce(new Error("Leave recovery unavailable"));
    await expect(directory.updateApportionPanel(actor(OWNER), { operation: "set-leaves", closedDateKeys: ["2099-10-05", "2099-10-06"] })).rejects.toThrow("Leave recovery unavailable");
    const intent = (await persisted()).apportionDirectory!.pendingProviderLeaves![0];
    await directory.updateApportionPanel(actor(OWNER), { operation: "set-leaves", closedDateKeys: ["2099-10-06"] });
    expect(leaveFixtures.apply).toHaveBeenLastCalledWith(OWNER, ["2099-10-06"], intent.leaveDateKey, intent.leaveAt);
    expect((await persisted()).apportionDirectory!.pendingProviderLeaves).toEqual([]);

    leaveFixtures.apply.mockRejectedValueOnce(new Error("Leave recovery unavailable"));
    await expect(directory.updateApportionPanel(actor(OWNER), { operation: "set-leaves", closedDateKeys: ["2099-10-05", "2099-10-06"] })).rejects.toThrow("Leave recovery unavailable");
    leaveFixtures.apply.mockClear();
    await directory.updateApportionPanel(actor(OWNER), { operation: "set-leaves", closedDateKeys: [] });
    expect(leaveFixtures.apply).not.toHaveBeenCalled();
    expect((await persisted()).apportionDirectory!.pendingProviderLeaves).toEqual([]);
  });

  it("checks the latest closed dates for each pending leave and only acknowledges that intent ID", async () => {
    const operation = { id: "old-leave", providerIdentifier: "9111111111", closedDateKeys: ["2099-10-05"], leaveDateKey: "2026-10-05", leaveAt: "2026-10-05T04:00:00.000Z" };
    const reopenedOperation = { ...operation, id: "reopened-leave", closedDateKeys: ["2099-10-06"] };
    const newerOperation = { ...operation, id: "newer-leave", closedDateKeys: ["2099-10-07"] };
    await store.withSerializedTestingMutation((state) => {
      state.apportionDirectory!.providerClosedDateKeys = { [OWNER]: ["2099-10-05", "2099-10-06"] };
      state.apportionDirectory!.pendingProviderLeaves = [operation, reopenedOperation];
    });
    leaveFixtures.apply.mockImplementationOnce(async () => {
      await store.withSerializedTestingMutation((state) => {
        state.apportionDirectory!.providerClosedDateKeys = { [OWNER]: ["2099-10-05", "2099-10-07"] };
        state.apportionDirectory!.pendingProviderLeaves!.push(newerOperation);
      });
      return [];
    });
    await directory.reconcileApportionProviderLeaves();
    expect(leaveFixtures.apply).toHaveBeenCalledExactlyOnceWith(operation.providerIdentifier, operation.closedDateKeys, operation.leaveDateKey, operation.leaveAt);
    expect((await persisted()).apportionDirectory!.pendingProviderLeaves).toEqual([newerOperation]);
    await directory.reconcileApportionProviderLeaves();
    expect(leaveFixtures.apply).toHaveBeenLastCalledWith(newerOperation.providerIdentifier, newerOperation.closedDateKeys, newerOperation.leaveDateKey, newerOperation.leaveAt);
    expect((await persisted()).apportionDirectory!.pendingProviderLeaves).toEqual([]);
  });

  it.each(["read", "update"])("retries durable provider leave on panel %s without duplicating intents", async (entryPoint) => {
    await directory.updateApportionPanel(actor(OWNER), { operation: "set-service", service: service("staff", STAFF) });
    leaveFixtures.apply.mockRejectedValueOnce(new Error("Leave recovery unavailable"));
    await expect(directory.updateApportionPanel(actor(STAFF), { operation: "set-leaves", closedDateKeys: ["2099-10-05"] })).rejects.toThrow("Leave recovery unavailable");
    const intent = (await persisted()).apportionDirectory!.pendingProviderLeaves![0];
    if (entryPoint === "read") await directory.getApportionPanel(actor(STAFF));
    else await directory.updateApportionPanel(actor(STAFF), { operation: "set-settings", settings: { appointmentsPerSlot: 1, justAddToList: true, slotDurationMinutes: 10 } });
    expect(leaveFixtures.apply).toHaveBeenLastCalledWith(STAFF, ["2099-10-05"], intent.leaveDateKey, intent.leaveAt);
    expect(leaveFixtures.apply).toHaveBeenCalledTimes(2);
    expect((await persisted()).apportionDirectory!.pendingProviderLeaves).toEqual([]);
  });

  it("creates a single provider-wide intent across assigned businesses without changing their closures", async () => {
    await seed({ [OWNER]: branding(), [OTHER]: branding("1:00 PM", "3:00 PM") });
    fixtures.assignments.push(assignment(OTHER));
    await directory.updateApportionPanel(actor(OWNER), { operation: "set-service", service: service("staff", STAFF) });
    await directory.updateApportionPanel(actor(OTHER), { operation: "set-service", service: service("staff", STAFF) });
    await directory.updateApportionPanel(actor(STAFF), { operation: "set-leaves", closedDateKeys: ["2099-10-05"] });
    expect(leaveFixtures.apply).toHaveBeenCalledExactlyOnceWith(STAFF, ["2099-10-05"], expect.any(String), expect.any(String));
    const state = await persisted();
    expect(state.apportionDirectory!.providerClosedDateKeys).toEqual({ [STAFF]: ["2099-10-05"] });
    expect(state.workspaceBrandingByActor[OWNER].appointmentDateOverrides?.closedDateKeys).toEqual([]);
    expect(state.workspaceBrandingByActor[OTHER].appointmentDateOverrides?.closedDateKeys).toEqual([]);
  });

  it.each([null, "2099-10-05", [null], [123], ["2099-02-30"], ["2099-2-03"], ["invalid"]])("rejects malformed personal leave input %j without durable changes", async (closedDateKeys) => {
    const before = await persisted();
    await expect(directory.updateApportionPanel(actor(OWNER), { operation: "set-leaves", closedDateKeys: closedDateKeys as unknown as string[] })).rejects.toMatchObject({ status: 400 });
    expect(await persisted()).toEqual(before);
    expect(leaveFixtures.apply).not.toHaveBeenCalled();
  });

  it("rejects delegate and unassigned-provider personal leave without creating cancellation intents", async () => {
    await directory.updateApportionPanel(actor(OWNER), { operation: "set-delegate", delegateIdentifier: ADMIN });
    await directory.updateApportionPanel(actor(OWNER), { operation: "set-service", service: service("unassigned") });
    const before = await persisted();
    for (const identifier of [ADMIN, STAFF]) {
      await expect(directory.updateApportionPanel(actor(identifier), { operation: "set-leaves", closedDateKeys: ["2099-10-05"] })).rejects.toMatchObject({ status: 403 });
    }
    expect(await persisted()).toEqual(before);
    expect(leaveFixtures.apply).not.toHaveBeenCalled();
  });

  it("opens a verified user's own panel without AWS directory credentials and does not grant an unassigned plan", async () => {
    await seed({});
    fixtures.directoryError = new Error("Could not load credentials from any providers");
    fixtures.assignments = [{ ...assignment(OWNER), userIdentifier: null, userSub: OWNER }];
    expect(await directory.getApportionPanel(actor(OWNER))).toMatchObject({ canCreateBusiness: true });
    await directory.updateApportionPanel(actor(OWNER), { operation: "business-branding", branding: branding() });
    await directory.updateApportionPanel(actor(OWNER), { operation: "set-service", service: service("unassigned") });
    expect((await directory.getApportionPanel(actor(OWNER))).businesses[0].business.services).toHaveLength(2);
    expect(await directory.getApportionPanel(actor(STAFF))).toMatchObject({ canCreateBusiness: false });
    fixtures.assignments = [];
    expect(await directory.getApportionPanel(actor(OWNER))).toMatchObject({ canCreateBusiness: false });
  });

  it("resolves creation capability for paid participants without a business or a paid actor category", async () => {
    await seed({});
    fixtures.assignments = [{ ...assignment(OWNER), userIdentifier: null, userSub: OWNER }];
    expect(await directory.getApportionPanel({ ...actor("9111111111"), sub: OWNER })).toMatchObject({ canCreateBusiness: true, businesses: [] });
    expect(await directory.getApportionPanel(actor(STAFF))).toMatchObject({ canCreateBusiness: false, businesses: [] });
  });

  it("preserves unlink intent metadata through reads and replays its original day after midnight", async () => {
    await directory.updateApportionPanel(actor(OWNER), { operation: "set-service", service: service("staff", STAFF) });
    const appointments = await import("../../../apps/web/lib/apportion-store");
    const apply = vi.spyOn(appointments, "applyApportionAddressOptOut").mockRejectedValueOnce(new Error("Temporary recovery failure"));
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2026-10-04T18:29:00.000Z"));
      await expect(directory.updateApportionPanel(actor(STAFF), { operation: "unlink-address", ownerIdentifier: OWNER, locationId: "location-1" })).rejects.toThrow("Temporary recovery failure");
      const operation = (await persisted()).apportionDirectory!.pendingAddressOptOuts![0];
      expect(operation).toMatchObject({ id: expect.any(String), optedOutDateKey: "2026-10-04", optedOutAt: "2026-10-04T18:29:00.000Z" });
      expect((await store.readApportionWorkspaceState()).apportionDirectory!.pendingAddressOptOuts).toEqual([operation]);
      vi.setSystemTime(new Date("2026-10-04T18:31:00.000Z"));
      apply.mockResolvedValue([]);
      await directory.reconcileApportionAddressOptOuts();
      expect(apply).toHaveBeenLastCalledWith(OWNER, "location-1", STAFF, operation.optedOutDateKey, operation.optedOutAt);
      expect((await persisted()).apportionDirectory!.pendingAddressOptOuts).toEqual([]);
      await directory.reconcileApportionAddressOptOuts();
      expect(apply).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
      apply.mockRestore();
    }
  });

  it.each(["old-operation", undefined])("does not remove newer same-address intent when completing %s", async (id) => {
    const operation = { ...(id ? { id } : {}), ownerIdentifier: OWNER, locationId: "location-1", providerIdentifier: STAFF };
    await store.withSerializedTestingMutation((state) => { state.apportionDirectory!.pendingAddressOptOuts = [operation]; });
    const appointments = await import("../../../apps/web/lib/apportion-store");
    const newerOperation = { ...operation, id: "new-operation", optedOutDateKey: "2026-10-05", optedOutAt: "2026-10-05T04:00:00.000Z" };
    const apply = vi.spyOn(appointments, "applyApportionAddressOptOut").mockImplementationOnce(async () => {
      await store.withSerializedTestingMutation((state) => { state.apportionDirectory!.pendingAddressOptOuts!.push(newerOperation); });
      return [];
    }).mockResolvedValue([]);
    try {
      await directory.reconcileApportionAddressOptOuts();
      expect((await persisted()).apportionDirectory!.pendingAddressOptOuts).toEqual([newerOperation]);
      await directory.reconcileApportionAddressOptOuts();
      expect((await persisted()).apportionDirectory!.pendingAddressOptOuts).toEqual([]);
      await directory.reconcileApportionAddressOptOuts();
      expect(apply).toHaveBeenCalledTimes(2);
    } finally {
      apply.mockRestore();
    }
  });

  it("preserves a participant committed while directory assignment awaits its lookup", async () => {
    let releaseLookup!: () => void;
    let signalLookup!: () => void;
    const lookupCaptured = new Promise<void>((resolve) => { signalLookup = resolve; });
    const resumeLookup = new Promise<void>((resolve) => { releaseLookup = resolve; });
    fixtures.lookupGate = async () => { signalLookup(); await resumeLookup; };
    const assignmentMutation = directory.updateApportionPanel(actor(OWNER), { operation: "set-service", service: service("staff", STAFF) });
    await lookupCaptured;
    try {
      await store.createParticipant({ identifier: "+919555555555", label: "Concurrent participant" });
    } finally {
      releaseLookup();
    }
    await assignmentMutation;
    const state = await persisted();
    expect(state.participants).toHaveLength(1);
    expect(state.participants[0].label).toBe("Concurrent participant");
    expect(state.apportionDirectory?.businesses[OWNER].services).toHaveLength(2);
    expect(state.apportionDirectory?.memberships[0].providerIdentifier).toBe(STAFF);
  });

  it("commits game and participant changes while merging untouched workspace fields", async () => {
    await store.withSerializedTestingMutation(async (state) => {
      await store.createParticipant({ identifier: "+919555555555", label: "Concurrent participant" });
      state.games.push({
        id: "game-regression", title: "Game regression", creatorIdentifier: OWNER, createdBy: OWNER,
        createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", completedAt: null, startedAt: null,
        participantGroupId: "game-group", poolId: "game-pool", questionIds: [], answers: [],
        participants: [{ identifier: STAFF, label: "Invited staff", acceptedAt: null }],
      });
    });
    await store.withSerializedTestingMutation((state) => {
      state.participants[0].label = "Updated participant";
      state.games[0].title = "Updated game";
    });
    await store.acceptGame("game-regression", STAFF, "Accepted staff");
    const saved = await persisted();
    expect(saved.participants).toHaveLength(1);
    expect(saved.participants[0].label).toBe("Updated participant");
    expect(saved.games[0]).toMatchObject({ title: "Updated game", participants: [{ label: "Accepted staff", acceptedAt: expect.any(String) }] });
    expect(saved.workspaceBrandingByActor[OWNER].appointmentShareCode).toBe("EXISTING-LINK");
  });

  it("renames Consultation while preserving its owner identity and validates owner-selected addresses only", async () => {
    await directory.updateApportionPanel(actor(OWNER), { operation: "set-service", service: { ...service("consultation", OWNER), name: "Owner visits" } });
    expect((await directory.getApportionBusinessContext(OWNER))?.business.services[0].name).toBe("Owner visits");
    await directory.updateApportionPanel(actor(OWNER), { operation: "set-service", service: { ...service("consultation", OWNER), name: "Owner visits", active: false } });
    const first = branding().appointmentLocations![0];
    await directory.updateApportionPanel(actor(OWNER), { operation: "business-branding", branding: { ...branding(), appointmentLocations: [first, { ...first, id: "location-2", address: "Other street" }] } });
    await directory.updateApportionPanel(actor(OWNER), { operation: "set-service", service: service("staff-one", STAFF) });
    await directory.updateApportionPanel(actor(OWNER), { operation: "set-service", service: service("staff-two", OTHER, true, ["location-2"]) });
    expect((await directory.getApportionBusinessContext(OWNER))?.memberships).toHaveLength(2);
  });

  it("lets the appointed delegate edit branding without changing owner-global settings", async () => {
    await directory.updateApportionPanel(actor(OWNER), { operation: "set-delegate", delegateIdentifier: ADMIN });
    await directory.updateApportionPanel(actor(OWNER), { operation: "set-settings", settings: { appointmentsPerSlot: 5, justAddToList: false, slotDurationMinutes: 30 } });
    await directory.updateApportionPanel(actor(ADMIN), { operation: "business-branding", ownerIdentifier: OWNER, branding: { ...branding(), instituteName: "Delegate edit", appointmentsPerSlot: 1, justAddToList: true, slotDurationMinutes: 10 } });
    expect((await persisted()).workspaceBrandingByActor[OWNER]).toMatchObject({ instituteName: "Delegate edit", appointmentsPerSlot: 5, justAddToList: false, slotDurationMinutes: 30 });
    await expect(directory.updateApportionPanel(actor(STAFF), { operation: "business-branding", ownerIdentifier: OWNER, branding: branding() })).rejects.toMatchObject({ status: 403 });
  });

  it("preserves canonical settings on stale owner branding saves unless explicitly updated", async () => {
    await directory.updateApportionPanel(actor(OWNER), { operation: "set-settings", settings: { appointmentsPerSlot: 5, justAddToList: false, slotDurationMinutes: 1440 } });
    await directory.updateApportionPanel(actor(OWNER), { operation: "business-branding", branding: { ...branding(), instituteName: "Stale form" } });
    expect((await store.getWorkspaceBranding(OWNER))).toMatchObject({ instituteName: "Stale form", appointmentsPerSlot: 5, justAddToList: false, slotDurationMinutes: 1440 });
    await directory.updateApportionPanel(actor(OWNER), { operation: "business-branding", branding: branding(), updateProviderSettings: true });
    expect((await directory.getApportionPanel(actor(OWNER))).providerSettings).toEqual({ appointmentsPerSlot: 1, justAddToList: true, slotDurationMinutes: 10 });
  });

  it("preserves directory changes when an unrelated writer commits a stale workspace snapshot", async () => {
    let releaseRead!: () => void;
    let signalRead!: () => void;
    const readCaptured = new Promise<void>((resolve) => { signalRead = resolve; });
    const resumeRead = new Promise<void>((resolve) => { releaseRead = resolve; });
    fixtures.readGate = async () => { signalRead(); await resumeRead; };
    const staleMutation = store.createParticipant({ identifier: "+919555555555", label: "Unrelated participant" });
    await readCaptured;
    try {
      await directory.updateApportionPanel(actor(OWNER), { operation: "set-service", service: service("staff", STAFF) });
    } finally {
      releaseRead();
    }
    await staleMutation;
    const state = await persisted();
    expect(state.participants).toHaveLength(1);
    expect(state.apportionDirectory?.businesses[OWNER].services).toHaveLength(2);
    expect(state.apportionDirectory?.memberships[0].providerIdentifier).toBe(STAFF);
  });

  it("preserves provider-global all-day duration through legacy normalization and keeps existing URLs immutable", async () => {
    await directory.updateApportionPanel(actor(OWNER), { operation: "set-settings", settings: { appointmentsPerSlot: 2, justAddToList: false, slotDurationMinutes: 1440 } });
    expect((await store.getWorkspaceBranding(OWNER))?.slotDurationMinutes).toBe(1440);
    await directory.updateApportionPanel(actor(OWNER), { operation: "business-branding", branding: { ...branding(), appointmentShareCode: "CHANGED", slotDurationMinutes: 1440 } });
    expect((await store.getWorkspaceBranding(OWNER))?.slotDurationMinutes).toBe(1440);
    expect((await persisted()).workspaceBrandingByActor[OWNER].appointmentShareCode).toBe("EXISTING-LINK");
  });

    it("canonicalizes old UI phone aliases without duplicating business keys and rejects raw backend quota violations", async () => {
      await store.updateWorkspaceBranding(branding(), "9111111111");
      expect(Object.keys((await persisted()).workspaceBrandingByActor)).toEqual([OWNER]);
      expect(Object.keys((await persisted()).apportionDirectory!.businesses)).toEqual([OWNER]);
      await expect(store.updateWorkspaceBranding({ ...branding(), appointmentsPerSlot: 99 }, OWNER)).rejects.toThrow("valid provider");
      const location = branding().appointmentLocations![0];
      await expect(directory.updateApportionPanel(actor(OWNER), { operation: "business-branding", branding: { ...branding(), appointmentLocations: [location, { ...location, id: "two" }, { ...location, id: "three" }] } })).rejects.toThrow("two business addresses");
    });

  it("migrates normalized legacy profiles and preserves share links/media and assignments on old UI saves", async () => {
    const context = await directory.getApportionBusinessContext("9111111111");
    expect(context?.business.services[0]).toMatchObject({ id: "consultation", assignedIdentifier: OWNER });
    await directory.updateApportionPanel(actor(OWNER), { operation: "set-service", service: service("therapy", "9222222222") });
    await store.updateWorkspaceBranding({ ...branding(), instituteName: "Updated Clinic" }, OWNER);
    const state = await persisted();
    expect(state.apportionDirectory?.businesses[OWNER].services).toHaveLength(2);
    expect(state.apportionDirectory?.memberships[0].providerIdentifier).toBe(STAFF);
    expect(state.workspaceBrandingByActor[OWNER]).toMatchObject({ appointmentShareCode: "EXISTING-LINK", imageDataUrl: "data:image/png;base64,logo" });
  });

  it("enforces ACTIVE quotas, includes Consultation, excludes disabled rows and delegate, and pauses on downgrade", async () => {
    await directory.updateApportionPanel(actor(OWNER), { operation: "set-delegate", delegateIdentifier: ADMIN });
    for (const id of ["one", "two", "three"]) await directory.updateApportionPanel(actor(OWNER), { operation: "set-service", service: service(id) });
    await directory.updateApportionPanel(actor(OWNER), { operation: "set-service", service: service("disabled", null, false, []) });
    await expect(directory.updateApportionPanel(actor(OWNER), { operation: "set-service", service: service("fifth") })).rejects.toThrow("Upgrade");
    fixtures.assignments = [assignment(OWNER, "trapit-pro-max")];
    for (let index = 5; index <= 10; index += 1) await directory.updateApportionPanel(actor(OWNER), { operation: "set-service", service: service(`service-${index}`) });
    await expect(directory.updateApportionPanel(actor(OWNER), { operation: "set-service", service: service("eleventh") })).rejects.toThrow("Upgrade");
    fixtures.assignments = [assignment(OWNER)];
    const panel = await directory.getApportionPanel(actor(OWNER));
    expect(panel.businesses[0].bookableServiceIds).toEqual(["consultation", "one", "two", "three"]);
    expect(panel.businesses[0].business.services.filter((entry) => entry.active)).toHaveLength(10);
  });

  it("enforces owner-only delegation and provider-only global settings while allowing Free staff", async () => {
    await directory.updateApportionPanel(actor(OWNER), { operation: "set-service", service: service("staff", STAFF) });
    await directory.updateApportionPanel(actor(OWNER), { operation: "set-delegate", delegateIdentifier: ADMIN });
    await expect(directory.updateApportionPanel(actor(ADMIN), { operation: "set-delegate", ownerIdentifier: OWNER, delegateIdentifier: null })).rejects.toMatchObject({ status: 403 });
    await expect(directory.updateApportionPanel(actor(ADMIN), { operation: "set-settings", ownerIdentifier: OWNER, settings: { appointmentsPerSlot: 2, justAddToList: false, slotDurationMinutes: 30 } })).rejects.toMatchObject({ status: 403 });
    await directory.updateApportionPanel(actor(STAFF), { operation: "set-settings", settings: { appointmentsPerSlot: 3, justAddToList: false, slotDurationMinutes: 30 } });
    expect((await directory.getApportionBusinessContext(OWNER))?.providerSettings[STAFF].appointmentsPerSlot).toBe(3);
    await directory.updateApportionPanel(actor(OWNER), { operation: "set-settings", settings: { appointmentsPerSlot: 2, justAddToList: false, slotDurationMinutes: 15 } });
    expect((await persisted()).workspaceBrandingByActor[OWNER]).toMatchObject({ appointmentsPerSlot: 2, justAddToList: false, slotDurationMinutes: 15 });
  });

  it("returns caller-scoped services, memberships and settings and no unrelated businesses", async () => {
    await seed({ [OWNER]: branding(), [OTHER]: branding("1:00 PM", "2:00 PM") });
    await directory.updateApportionPanel(actor(OWNER), { operation: "set-service", service: service("staff", STAFF) });
    const panel = await directory.getApportionPanel(actor("9222222222"));
    expect(panel.businesses).toHaveLength(1);
    expect(panel.businesses[0].role).toBe("staff");
    expect(panel.businesses[0].business.services.map((entry) => entry.id)).toEqual(["staff"]);
    expect(Object.keys(panel.businesses[0].providerSettings)).toEqual(["9222222222"]);
    expect((await directory.getApportionPanel(actor(ADMIN))).businesses).toEqual([]);
  });

  it("uses registered full phones, rejects aliases assigned twice and locks Consultation", async () => {
    await expect(directory.updateApportionPanel(actor(OWNER), { operation: "set-service", service: service("bad", "participant-id") })).rejects.toThrow("full registered phone");
    await expect(directory.updateApportionPanel(actor(OWNER), { operation: "set-service", service: service("bad", "+919999999999") })).rejects.toThrow("No registered user");
    await directory.updateApportionPanel(actor(OWNER), { operation: "set-service", service: service("staff", STAFF) });
    await expect(directory.updateApportionPanel(actor(OWNER), { operation: "set-service", service: service("duplicate", "9222222222") })).rejects.toThrow("only one service");
    await expect(directory.updateApportionPanel(actor(OWNER), { operation: "set-service", service: service("consultation", STAFF) })).rejects.toThrow("Consultation");
    await expect(directory.updateApportionPanel(actor(OWNER), { operation: "set-service", service: service("unknown-address", null, true, ["missing"]) })).rejects.toThrow("valid assigned");
    await expect(directory.updateApportionPanel(actor(OWNER), { operation: "set-service", service: service("empty", null, true, []) })).rejects.toThrow("valid assigned");
  });

  it("counts personal and distinct linked addresses together and delegation costs no address", async () => {
    await seed({ [OWNER]: branding(), [STAFF]: branding("1:00 PM", "2:00 PM"), [OTHER]: branding("3:00 PM", "4:00 PM") });
    fixtures.assignments.push(assignment(OTHER));
    await directory.updateApportionPanel(actor(OWNER), { operation: "set-delegate", delegateIdentifier: STAFF });
    expect((await persisted()).apportionDirectory?.memberships).toHaveLength(0);
    await directory.updateApportionPanel(actor(OWNER), { operation: "set-service", service: service("staff", STAFF) });
    await expect(directory.updateApportionPanel(actor(OTHER), { operation: "set-service", service: service("staff", "9222222222") })).rejects.toThrow("Staff address unavailable");
  });

  it("allows two businesses for one provider, shares global settings, and enforces per-address master hours", async () => {
    await seed({ [OWNER]: branding(), [OTHER]: branding("1:00 PM", "3:00 PM") });
    fixtures.assignments.push(assignment(OTHER));
    await directory.updateApportionPanel(actor(OWNER), { operation: "set-service", service: service("staff", STAFF) });
    await directory.updateApportionPanel(actor(OTHER), { operation: "set-service", service: service("staff", STAFF) });
    await directory.updateApportionPanel(actor(STAFF), { operation: "set-settings", settings: { appointmentsPerSlot: 4, justAddToList: false, slotDurationMinutes: 45 } });
    expect((await directory.getApportionBusinessContext(OTHER))?.providerSettings[STAFF].slotDurationMinutes).toBe(45);
    await directory.updateApportionPanel(actor(STAFF), { operation: "set-hours", ownerIdentifier: OWNER, locationId: "location-1", hours: { workingDays: "Monday", workingHours: "10:00 AM - 11:00 AM", workingHoursSecondWindow: "", closedDateKeys: [] } });
    await expect(directory.updateApportionPanel(actor(STAFF), { operation: "set-hours", ownerIdentifier: OWNER, locationId: "location-1", hours: { workingDays: "Monday", workingHours: "8:00 AM - 11:00 AM", workingHoursSecondWindow: "", closedDateKeys: [] } })).rejects.toThrow("master working hours");
    expect((await persisted()).apportionDirectory?.memberships[0].workingHours).toBe("10:00 AM - 11:00 AM");
  });

  it("merges personal and linked owner-business services for a staff member's booking code", async () => {
    await seed({ [OWNER]: branding(), [STAFF]: branding("5:00 PM", "7:00 PM", "staff-location") });
    fixtures.assignments.push(assignment(STAFF));
    await directory.updateApportionPanel(actor(OWNER), { operation: "set-service", service: service("therapy", STAFF) });

    const services = await directory.listApportionDirectLinkServices(STAFF);

    expect(services).toEqual(expect.arrayContaining([
      expect.objectContaining({ ownerIdentifier: STAFF, id: "consultation", businessName: "Clinic" }),
      expect.objectContaining({ ownerIdentifier: OWNER, id: "therapy", businessName: "Clinic" }),
    ]));
  });

  it("clips staff schedules and queues a durable notice when master hours shrink without bookings", async () => {
    await directory.updateApportionPanel(actor(OWNER), { operation: "set-service", service: service("staff", STAFF) });
    const location = branding().appointmentLocations![0];
    await directory.updateApportionPanel(actor(OWNER), { operation: "business-branding", branding: {
      ...branding(),
      appointmentLocations: [{ ...location, workingHours: "10:00 AM - 11:00 AM" }],
    } });

    const saved = (await persisted()).apportionDirectory!;
    expect(saved.memberships[0]).toMatchObject({ workingDays: "Monday", workingHours: "10:00 AM - 11:00 AM", workingHoursSecondWindow: "" });
    expect(saved.scheduleNotifications).toEqual([expect.objectContaining({
      recipientIdentifier: STAFF,
      message: expect.stringContaining("schedule"),
      id: expect.any(String),
      createdAt: expect.any(String),
    })]);
  });

  it("preserves existing appointments when a master schedule clips the assigned provider", async () => {
    await directory.updateApportionPanel(actor(OWNER), { operation: "set-service", service: service("staff", STAFF) });
    const appointments = await import("../../../apps/web/lib/apportion-store");
    const appointment = await appointments.createApportionAppointment({
      ownerIdentifier: OWNER,
      locationId: "location-1",
      locationName: "Main",
      requesterIdentifier: OTHER,
      requesterName: "Requester",
      serviceId: "staff",
      serviceDateKey: "2099-10-05",
      startsAt: "2099-10-05T04:30:00.000Z",
    });
    const location = branding().appointmentLocations![0];
    await directory.updateApportionPanel(actor(OWNER), { operation: "business-branding", branding: {
      ...branding(),
      appointmentLocations: [{ ...location, workingHours: "10:00 AM - 11:00 AM" }],
    } });

    expect((await appointments.listApportionAppointmentsForOwner(OWNER)).find((entry) => entry.id === appointment.id)).toMatchObject({
      currentStatus: "pending",
      startsAt: appointment.startsAt,
      locationId: "location-1",
    });
  });

  it("keeps clipped overnight hours on their originating weekday", async () => {
    const broad = branding();
    broad.appointmentLocations![0].dailyHours = Array.from({ length: 7 }, (_, weekday) => ({
      weekday,
      workingHours: weekday === 6 ? "9:00 PM - 3:00 AM" : "",
      workingHoursSecondWindow: "",
    }));
    await seed({ [OWNER]: broad });
    await directory.updateApportionPanel(actor(OWNER), { operation: "set-service", service: service("staff", STAFF) });
    const narrowLocation = { ...broad.appointmentLocations![0], dailyHours: broad.appointmentLocations![0].dailyHours!.map((entry) => ({
      ...entry,
      workingHours: entry.weekday === 6 ? "10:00 PM - 1:00 AM" : "",
    })) };
    await directory.updateApportionPanel(actor(OWNER), { operation: "business-branding", branding: { ...broad, appointmentLocations: [narrowLocation] } });

    const dailyHours = (await persisted()).apportionDirectory?.memberships[0].dailyHours!;
    expect(dailyHours[6]).toMatchObject({ weekday: 6, workingHours: "10:00 PM - 1:00 AM", workingHoursSecondWindow: "" });
    expect(dailyHours[0]).toMatchObject({ weekday: 0, workingHours: "", workingHoursSecondWindow: "" });
  });

  it("accepts two-window daily schedules, validates shape, and detects overnight person overlap", async () => {
    await directory.updateApportionPanel(actor(OWNER), { operation: "set-service", service: service("staff", STAFF) });
    const dailyHours = Array.from({ length: 7 }, (_, weekday) => ({
      weekday,
      workingHours: weekday === 1 ? "9:00 AM - 11:00 AM" : "",
      workingHoursSecondWindow: weekday === 1 ? "11:30 AM - 12:00 PM" : "",
    }));
    await directory.updateApportionPanel(actor(STAFF), { operation: "set-hours", ownerIdentifier: OWNER, locationId: "location-1", hours: { dailyHours, closedDateKeys: [] } });
    expect((await persisted()).apportionDirectory?.memberships[0].dailyHours).toEqual(dailyHours);
    await expect(directory.updateApportionPanel(actor(STAFF), { operation: "set-hours", ownerIdentifier: OWNER, locationId: "location-1", hours: {
      dailyHours: [{ weekday: 1, workingHours: "9:00 AM - 11:00 AM", workingHoursSecondWindow: "" }],
      closedDateKeys: [],
    } })).rejects.toThrow("seven days");
    fixtures.actorIdentifier = STAFF;
    const invalidApiResponse = await businessApi.PATCH(new Request("https://trapit.in/api/user/apportion/business", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ operation: "set-hours", ownerIdentifier: OWNER, locationId: "location-1", hours: { dailyHours: [{ weekday: 1, workingHours: "bad", workingHoursSecondWindow: "" }], closedDateKeys: [] } }),
    }));
    expect(invalidApiResponse.status).toBe(400);
    expect(await invalidApiResponse.json()).toMatchObject({ error: expect.stringContaining("seven days") });

    const staffBranding = branding("1:00 AM", "3:00 AM");
    staffBranding.appointmentLocations![0].dailyHours = Array.from({ length: 7 }, (_, weekday) => ({
      weekday,
      workingHours: weekday === 2 ? "1:00 AM - 3:00 AM" : "",
      workingHoursSecondWindow: "",
    }));
    await seed({ [OWNER]: branding("10:00 PM", "2:00 AM"), [STAFF]: staffBranding });
    await expect(directory.updateApportionPanel(actor(OWNER), { operation: "set-service", service: service("staff", STAFF) })).rejects.toThrow("overlap");
  });

  it("stores personal leave across assigned businesses without changing legacy business closures", async () => {
    await seed({ [OWNER]: branding(), [OTHER]: branding("1:00 PM", "3:00 PM") });
    fixtures.assignments.push(assignment(OTHER));
    await directory.updateApportionPanel(actor(OWNER), { operation: "set-service", service: service("staff", STAFF) });
    await directory.updateApportionPanel(actor(OTHER), { operation: "set-service", service: service("staff", STAFF) });
    await directory.updateApportionPanel(actor(STAFF), { operation: "set-leaves", closedDateKeys: ["2026-10-05"] });

    const state = await persisted();
    expect(state.apportionDirectory?.providerClosedDateKeys?.[STAFF]).toEqual(["2026-10-05"]);
    expect(state.workspaceBrandingByActor[OWNER].appointmentDateOverrides?.closedDateKeys).toEqual([]);
    expect((await directory.getApportionPanel(actor(STAFF))).providerClosedDateKeys).toEqual(["2026-10-05"]);
    await expect(directory.updateApportionPanel(actor(STAFF), { operation: "set-leaves", closedDateKeys: ["2026-02-30"] })).rejects.toThrow("valid leave dates");
    await expect(directory.updateApportionPanel(actor(ADMIN), { operation: "set-leaves", closedDateKeys: [] })).rejects.toMatchObject({ status: 403 });
  });

  it("rejects same-person address overlap and safe-lifecycle changes without leaving orphan memberships", async () => {
    await seed({ [OWNER]: branding(), [STAFF]: branding("10:00 AM", "1:00 PM") });
    await expect(directory.updateApportionPanel(actor(OWNER), { operation: "set-service", service: service("staff", STAFF) })).rejects.toThrow("overlap");
    expect((await directory.getApportionBusinessContext(OWNER))?.memberships).toEqual([]);
    await seed();
    await directory.updateApportionPanel(actor(OWNER), { operation: "set-service", service: service("staff", STAFF) });
    await expect(directory.updateApportionPanel(actor(OWNER), { operation: "set-service", service: service("staff", ADMIN) })).rejects.toThrow("Conflict");
    await directory.updateApportionPanel(actor(STAFF), { operation: "unlink-address", ownerIdentifier: OWNER, locationId: "location-1" });
    expect((await directory.getApportionBusinessContext(OWNER))?.memberships).toEqual([]);
    expect((await directory.getApportionBusinessContext(OWNER))?.business.services.find((entry) => entry.id === "staff")).toMatchObject({ active: false, locationIds: [] });
    await expect(store.updateWorkspaceBranding(null, OWNER)).rejects.toThrow("Conflict");
  });

  it("fails closed for unknown and Free owners without deleting migrated history", async () => {
    fixtures.assignments = [];
    fixtures.users = [];
    expect((await directory.getApportionBusinessContext(OWNER))?.ownerCategory).toBe("unknown");
    await expect(directory.updateApportionPanel(actor(OWNER), { operation: "set-service", service: service("new") })).rejects.toMatchObject({ status: 403 });
    await expect(store.updateWorkspaceBranding(branding(), OWNER)).rejects.toMatchObject({ status: 403 });
    expect((await directory.getApportionBusinessContext(OWNER))?.business.services).toHaveLength(1);
  });

  it("serializes concurrent branding, assignment and settings mutations without deadlocks or lost updates", async () => {
    await Promise.all([
      store.updateWorkspaceBranding({ ...branding(), instituteName: "Updated" }, OWNER),
      directory.updateApportionPanel(actor(OWNER), { operation: "set-service", service: service("staff", STAFF) }),
      directory.updateApportionPanel(actor(OWNER), { operation: "set-delegate", delegateIdentifier: ADMIN }),
      directory.updateApportionPanel(actor(OWNER), { operation: "set-settings", settings: { appointmentsPerSlot: 6, justAddToList: false, slotDurationMinutes: 60 } }),
    ]);
    const state = await persisted();
    expect(state.workspaceBrandingByActor[OWNER]).toMatchObject({ instituteName: "Updated", appointmentsPerSlot: 6 });
    expect(state.apportionDirectory?.businesses[OWNER]).toMatchObject({ adminDelegateIdentifier: ADMIN });
    expect(state.apportionDirectory?.businesses[OWNER].services).toHaveLength(2);
  });

  it("validates overnight and week-boundary staff hours", () => {
    const master = { ...branding().appointmentLocations![0], workingDays: "Saturday", workingHours: "10:00 PM - 2:00 AM" };
    expect(() => directory.assertApportionHoursWithinMaster({ workingDays: "Sunday", workingHours: "12:00 AM - 1:00 AM", workingHoursSecondWindow: "" }, master)).not.toThrow();
    expect(() => directory.assertApportionHoursWithinMaster({ workingDays: "Sunday", workingHours: "1:00 AM - 3:00 AM", workingHoursSecondWindow: "" }, master)).toThrow("master");
  });
});