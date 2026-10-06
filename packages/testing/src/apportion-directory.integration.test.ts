import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createEmptyTestingWorkspaceState, normalizeWorkspaceBranding, type TestingWorkspaceState, type WorkspaceBranding } from "./quiz";
import type { WorkspaceActor } from "../../../apps/web/lib/workspace-actor";

vi.mock("server-only", () => ({}));
vi.mock("../../../apps/web/lib/auth-config", () => ({ isWebAuthConfigured: () => true }));
vi.mock("../../../apps/web/lib/poll-store", () => ({}));
const fixtures = vi.hoisted(() => ({ users: [] as Array<{ identifier: string; label: string; sub: string | null }>, assignments: [] as Array<{ userIdentifier: string | null; userSub: string | null; category: string; assignedAt: string; expiresAt: string | null }> }));
vi.mock("../../../apps/web/lib/cognito", () => ({ listRegisteredDirectoryUsers: async () => fixtures.users }));
vi.mock("../../../apps/web/lib/user-category-store", () => ({ listUserCategoryManagementState: async () => ({ activeAssignments: fixtures.assignments }) }));

const OWNER = "+919111111111";
const STAFF = "+919222222222";
const ADMIN = "+919333333333";
const OTHER = "+919444444444";
let temporaryDirectory: string;
let storePath: string;
let directory: typeof import("../../../apps/web/lib/apportion-directory");
let store: typeof import("../../../apps/web/lib/testing-store");

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
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await rm(temporaryDirectory, { recursive: true, force: true });
});

beforeEach(async () => {
  fixtures.users = [OWNER, STAFF, ADMIN, OTHER].map((identifier) => ({ identifier, label: identifier, sub: identifier }));
  fixtures.assignments = [assignment(OWNER)];
  await seed();
});

describe("persistent Apportion directory", () => {
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

  it("rejects same-person address overlap and safe-lifecycle changes without leaving orphan memberships", async () => {
    await seed({ [OWNER]: branding(), [STAFF]: branding("10:00 AM", "1:00 PM") });
    await expect(directory.updateApportionPanel(actor(OWNER), { operation: "set-service", service: service("staff", STAFF) })).rejects.toThrow("overlap");
    expect((await directory.getApportionBusinessContext(OWNER))?.memberships).toEqual([]);
    await seed();
    await directory.updateApportionPanel(actor(OWNER), { operation: "set-service", service: service("staff", STAFF) });
    await expect(directory.updateApportionPanel(actor(OWNER), { operation: "set-service", service: service("staff", ADMIN) })).rejects.toThrow("Conflict");
    await directory.updateApportionPanel(actor(STAFF), { operation: "unlink-address", ownerIdentifier: OWNER, locationId: "location-1" });
    const afterUnlink = await directory.getApportionBusinessContext(OWNER);
    expect(afterUnlink?.memberships).toEqual([]);
    expect(afterUnlink?.business.services.find((entry) => entry.id === "staff")?.active).toBe(false);
    expect(afterUnlink?.business.services.find((entry) => entry.id === "consultation")).toMatchObject({ active: true, assignedIdentifier: OWNER });
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

  it("allows saving a staff schedule with no working intervals", async () => {
    await seed();
    await directory.updateApportionPanel(actor(OWNER), { operation: "set-service", service: service("staff", STAFF) });
    const dailyHours = Array.from({ length: 7 }, (_, weekday) => ({ weekday, workingHours: "", workingHoursSecondWindow: "" }));
    await directory.updateApportionPanel(actor(STAFF), {
      operation: "set-hours",
      ownerIdentifier: OWNER,
      locationId: "location-1",
      hours: { dailyHours, closedDateKeys: [] },
    });
    expect((await directory.getApportionBusinessContext(OWNER))?.memberships[0].dailyHours).toEqual(dailyHours);
  });
});