import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { normalizeWorkspaceBranding } from "../src/quiz";
import type { ApportionBusinessContext } from "../../../apps/web/lib/apportion-directory";

vi.mock("server-only", () => ({}));
vi.mock("../../../apps/web/lib/apportion-directory", () => ({
  getApportionBusinessContext: vi.fn(async () => fixtures.context),
  getApportionBusinessContexts: vi.fn(async (owners: string[]) => new Map([...new Set(owners)].map((owner) => [owner, fixtures.context]))),
  resolveApportionProviderContact: vi.fn(async (identifier: string) => ({ name: identifier === STAFF ? "Therapist" : "Owner", phone: identifier })),
}));
const directoryApi = await import("../../../apps/web/lib/apportion-directory");
const fixtures = vi.hoisted(() => ({ context: null as import("../../../apps/web/lib/apportion-directory").ApportionBusinessContext | null }));
const OWNER = "+919111111111";
const STAFF = "+919222222222";
const ADMIN = "+919333333333";
const REQUESTER = "+919444444444";
let temporaryDirectory: string;
let storePath: string;
let store: typeof import("../../../apps/web/lib/apportion-store");

function legacy() {
  return { id: "old-id", ownerIdentifier: OWNER, requesterIdentifier: REQUESTER, requesterName: "Customer", startsAt: "2099-10-04T04:00:00.000Z", createdAt: "2026-01-01T00:00:00.000Z", currentStatus: "pending", locationId: "location-1", queueOrder: 1, bookedQueuePosition: 7, history: [{ action: "booked", actorIdentifier: REQUESTER, at: "2026-01-01T00:00:00.000Z", fromStartsAt: null, toStartsAt: "2099-10-04T04:00:00.000Z", note: "Original booking" }] };
}

function context(): ApportionBusinessContext {
  return {
    business: { ownerIdentifier: OWNER, adminDelegateIdentifier: ADMIN, services: [
      { id: "consultation", name: "Consultation", active: true, assignedIdentifier: OWNER, locationIds: ["location-1"] },
      { id: "therapy", name: "Therapy", active: true, assignedIdentifier: STAFF, locationIds: ["location-1", "location-2"] },
      { id: "unassigned", name: "Unassigned", active: true, assignedIdentifier: null, locationIds: ["location-1"] },
    ] },
    branding: normalizeWorkspaceBranding({ instituteName: "Clinic", appointmentShareCode: "OLD-QR", appointmentLocations: [
      { id: "location-1", name: "Main", address: "Main Street", workingDays: "Monday", workingHours: "9:00 AM - 5:00 PM", workingHoursSecondWindow: "" },
      { id: "location-2", name: "Second", address: "Second Street", workingDays: "Tuesday", workingHours: "9:00 AM - 5:00 PM", workingHoursSecondWindow: "" },
    ] } as never)!,
    ownerCategory: "trapit-pro",
    providerSettings: { [OWNER]: { justAddToList: false, appointmentsPerSlot: 1, slotDurationMinutes: 10 }, [STAFF]: { justAddToList: false, appointmentsPerSlot: 1, slotDurationMinutes: 30 } },
    memberships: ["location-1", "location-2"].map((locationId) => ({ ownerIdentifier: OWNER, providerIdentifier: STAFF, locationId, workingDays: "Monday", workingHours: "9:00 AM - 5:00 PM", workingHoursSecondWindow: "", closedDateKeys: [] })),
  };
}

function booking(serviceId = "therapy", startsAt = "2099-10-05T04:00:00.000Z", locationId = "location-1") {
  return { serviceId, ownerIdentifier: "9111111111", requesterIdentifier: REQUESTER, requesterName: "Customer", locationId, locationName: "Untrusted name", startsAt, appointmentsPerSlot: 999, bookedSettings: { justAddToList: true, appointmentsPerSlot: 6, slotDurationMinutes: 240 } };
}

async function persisted() {
  return JSON.parse(await readFile(storePath, "utf8")) as { appointments: import("../../../apps/web/lib/apportion-store").ApportionAppointment[] };
}

beforeAll(async () => {
  temporaryDirectory = await mkdtemp(path.join(process.cwd(), ".trapit-apportion-store-"));
  storePath = path.join(temporaryDirectory, "apportion-appointments.json");
  vi.stubEnv("TRAPIT_DATA_DIR", temporaryDirectory);
  store = await import("../../../apps/web/lib/apportion-store");
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await rm(temporaryDirectory, { recursive: true, force: true });
});
beforeEach(async () => {
  vi.clearAllMocks();
  fixtures.context = context();
  await writeFile(storePath, JSON.stringify({ appointments: [legacy()] }));
});

describe("canonical appointment store", () => {
  it("requires a reason, preserves notes, atomically appends an authored cancellation, and retries once", async () => {
    const appointment = await store.createApportionAppointment({ ...booking(), notes: "Original customer note" });
    const before = await persisted();
    for (const reason of [undefined, "", "  ", "\u0000"]) {
      await expect(store.cancelApportionAppointment({ actorIdentifier: STAFF, appointmentId: appointment.id, reason })).rejects.toThrow("cancellation reason");
    }
    expect(await persisted()).toEqual(before);
    await expect(store.cancelApportionAppointment({ actorIdentifier: OWNER, appointmentId: appointment.id, reason: "No authority" })).rejects.toThrow("own appointments");
    const input = { actorIdentifier: STAFF, appointmentId: appointment.id, reason: "  On leave  " };
    await Promise.all([store.cancelApportionAppointment(input), store.cancelApportionAppointment(input)]);
    const cancelled = (await persisted()).appointments.find((entry) => entry.id === appointment.id)!;
    expect(cancelled).toMatchObject({ currentStatus: "cancelled", canceledByIdentifier: STAFF, notes: "Original customer note" });
    expect(cancelled.messages.map((entry) => entry.body)).toEqual(["Original customer note", "Cancellation reason: On leave"]);
    expect(cancelled.messages.at(-1)).toMatchObject({ authorIdentifier: STAFF });
    expect(cancelled.history.filter((entry) => entry.action === "cancelled")).toHaveLength(1);
  });
  it("keeps booked business, service, address and staff contacts after configuration changes", async () => {
    const appointment = await store.createApportionAppointment(booking());
    fixtures.context!.branding.instituteName = "Renamed";
    fixtures.context!.branding.appointmentLocations![0].address = "Changed address";
    fixtures.context!.business.services[1].name = "Changed service";
    fixtures.context!.business.services[1].assignedIdentifier = ADMIN;
    const projected = (await store.listApportionAppointmentsForActor(REQUESTER)).find((entry) => entry.id === appointment.id)!;
    expect(projected).toMatchObject({ ownerName: "Clinic", serviceName: "Therapy", locationAddress: "Main Street", assignedStaffName: "Therapist", assignedStaffPhone: STAFF });
  });
  it("honors pending handovers immediately and does not transfer new bookings after relinking", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2026-10-01T10:00:00.000Z"));
      const previous = await store.createApportionAppointment(booking());
      const optedOutAt = new Date().toISOString();
      fixtures.context!.pendingAddressOptOuts = [{ ownerIdentifier: OWNER, locationId: "location-1", providerIdentifier: STAFF, optedOutAt }];
      vi.setSystemTime(new Date("2026-10-01T10:01:00.000Z"));
      const relinked = await store.createApportionAppointment(booking("therapy", "2099-10-05T04:30:00.000Z"));
      expect(await store.resolveApportionAppointmentAccess(previous, STAFF)).toMatchObject({ controllerIdentifier: ADMIN, canManage: false });
      expect(await store.resolveApportionAppointmentAccess(relinked, STAFF)).toMatchObject({ controllerIdentifier: STAFF, canManage: true });
      expect((await store.applyApportionAddressOptOut(OWNER, "location-1", STAFF, undefined, optedOutAt)).map((entry) => entry.id)).toEqual([previous.id]);
      expect(await store.resolveApportionAppointmentAccess(relinked, STAFF)).toMatchObject({ controllerIdentifier: STAFF, canManage: true });
    } finally {
      vi.useRealTimers();
    }
  });
  it("persists a new appointment notification for the owner only", async () => {
    const appointment = await store.createApportionAppointment(booking());
    const notices = (await persisted()).appointments.find((entry) => entry.id === appointment.id)!.notifications!;
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({ title: "New appointment", recipientIdentifier: OWNER, deliveredAt: null });
    expect(notices[0].body).not.toContain(REQUESTER);
  });
  it("reuses owner contexts when projecting hundreds of historical appointments", async () => {
    const appointments = Array.from({ length: 297 }, (_, index) => ({
      ...legacy(), id: `historical-${index}`, currentStatus: "done", serviceId: "therapy", assignedStaffIdentifier: STAFF,
    }));
    await writeFile(storePath, JSON.stringify({ appointments }));
    const projected = await store.listApportionAppointmentsForActor(STAFF);
    expect(projected).toHaveLength(297);
    expect(projected.every((entry) => entry.canManage && !entry.canMessage)).toBe(true);
    expect(directoryApi.getApportionBusinessContexts).toHaveBeenCalledTimes(1);
    vi.clearAllMocks();
    fixtures.context = null;
    expect(await store.listApportionAppointmentsForActor(ADMIN)).toEqual([]);
    expect(directoryApi.getApportionBusinessContexts).toHaveBeenCalledTimes(1);
  });
  it("notifies the Admin fallback controller when an unassigned slot converts or expires", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2026-10-05T03:00:00.000Z"));
      fixtures.context!.business.services[2].assignedIdentifier = null;
      const entry = await store.createApportionAppointment({ ...booking("unassigned"), startsAt: "2026-10-05T04:00:00.000Z", serviceDateKey: "2026-10-05" });
      vi.setSystemTime(new Date("2026-10-05T05:00:00.000Z"));
      await store.reconcileApportionLifecycle();
      expect((await store.listApportionNotificationsForActor(ADMIN)).filter((notice) => notice.url.includes(entry.id))).toHaveLength(1);
      vi.setSystemTime(new Date("2026-10-05T18:30:00.000Z"));
      await store.reconcileApportionLifecycle();
      expect((await store.listApportionNotificationsForActor(ADMIN)).filter((notice) => notice.url.includes(entry.id))).toHaveLength(2);
    } finally { vi.useRealTimers(); }
  });
  it("preserves all existing bookings when leave is marked and rejects new bookings on leave", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2026-10-05T03:00:00.000Z"));
      const today = await store.createApportionAppointment({ ...booking(), startsAt: "2026-10-05T04:00:00.000Z", serviceDateKey: "2026-10-05" });
      const future = await store.createApportionAppointment({ ...booking(), startsAt: "2026-10-06T04:00:00.000Z", serviceDateKey: "2026-10-06" });
      const unassigned = await store.createApportionAppointment({ ...booking("unassigned"), startsAt: "2026-10-06T04:00:00.000Z", serviceDateKey: "2026-10-06" });
      fixtures.context!.providerClosedDateKeys = { [STAFF]: ["2026-10-05", "2026-10-06"] };
      const changed = await store.applyApportionProviderLeave(STAFF, ["2026-10-05", "2026-10-06"], "2026-10-05", new Date().toISOString());
      expect(changed).toEqual([]);
      const entries = (await persisted()).appointments;
      expect(entries.find((entry) => entry.id === today.id)?.currentStatus).toBe("pending");
      expect(entries.find((entry) => entry.id === unassigned.id)?.currentStatus).toBe("pending");
      expect(entries.find((entry) => entry.id === future.id)?.currentStatus).toBe("pending");
      await expect(store.createApportionAppointment({ ...booking(), startsAt: "2026-10-06T05:00:00.000Z", serviceDateKey: "2026-10-06" })).rejects.toThrow("unavailable");
      const saved = await persisted();
      expect(await store.applyApportionProviderLeave(STAFF, ["2026-10-06"], "2026-10-05", new Date().toISOString())).toEqual([]);
      expect(await persisted()).toEqual(saved);
    } finally { vi.useRealTimers(); }
  });

  it("legacy leave retries do not rewrite bookings; normal expiry remains independent", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2026-10-05T03:00:00.000Z"));
      const future = await store.createApportionAppointment({ ...booking(), startsAt: "2026-10-06T04:00:00.000Z", serviceDateKey: "2026-10-06" });
      const reopened = await store.createApportionAppointment({ ...booking(), startsAt: "2026-10-07T04:00:00.000Z", serviceDateKey: "2026-10-07" });
      const leaveAt = new Date().toISOString();
      fixtures.context!.providerClosedDateKeys = { [STAFF]: ["2026-10-06"] };
      vi.setSystemTime(new Date("2026-10-08T03:00:00.000Z"));
      const changed = await store.applyApportionProviderLeave(STAFF, ["2026-10-06", "2026-10-07"], "2026-10-05", leaveAt);
      expect(changed).toEqual([]);
      expect((await persisted()).appointments.find((entry) => entry.id === future.id)?.currentStatus).toBe("pending");
      await store.reconcileApportionLifecycle();
      expect((await persisted()).appointments.find((entry) => entry.id === reopened.id)?.currentStatus).toBe("missed");
    } finally { vi.useRealTimers(); }
  });

  it("filters embedded notifications by recipient in every appointment projection without changing the outbox", async () => {
    const notifications = [OWNER, STAFF, REQUESTER].map((recipientIdentifier) => ({ id: recipientIdentifier, recipientIdentifier, title: "Private", body: "Recipient only", url: "/user", createdAt: "2026-01-01T00:00:00Z" }));
    await writeFile(storePath, JSON.stringify({ appointments: [{ ...legacy(), assignedStaffIdentifier: STAFF, notifications }] }));
    for (const identifier of ["9111111111", "9222222222", "9444444444"]) {
      const entries = await store.listApportionAppointmentsForActor(identifier);
      expect(entries[0].notifications).toEqual([notifications.find((entry) => entry.recipientIdentifier.endsWith(identifier))]);
    }
    expect((await store.listApportionAppointmentsForOwner("9111111111"))[0].notifications).toEqual([notifications[0]]);
    expect((await store.listApportionAppointmentsForRequester("9444444444"))[0].notifications).toEqual([notifications[2]]);
    expect((await persisted()).appointments[0].notifications).toEqual(notifications);
  });
  it("does not reject an unassigned service booking on the owner's leave date", async () => {
    fixtures.context!.business.services[2].assignedIdentifier = null;
    fixtures.context!.providerClosedDateKeys = { [OWNER]: ["2099-10-05"] };
    const appointment = await store.createApportionAppointment({
      ...booking("unassigned", "2099-10-05T04:00:00.000Z"),
      serviceDateKey: "2099-10-05",
    });
    expect(appointment.serviceId).toBe("unassigned");
    expect(appointment.assignedStaffIdentifier).toBeNull();
  });
  it("unlink retries transfer management without changing statuses, including historical appointments", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2026-10-04T18:29:00.000Z"));
      fixtures.context!.providerSettings[STAFF].justAddToList = true;
      const sameDay = await store.createApportionAppointment({ ...booking(), startsAt: "2026-10-04T04:00:00.000Z", serviceDateKey: "2026-10-04" });
      const nextDay = await store.createApportionAppointment({ ...booking(), startsAt: "2026-10-05T04:00:00.000Z", serviceDateKey: "2026-10-05" });
      const later = await store.createApportionAppointment({ ...booking(), startsAt: "2026-10-06T04:00:00.000Z", serviceDateKey: "2026-10-06" });
      const completed = await store.createApportionAppointment({ ...booking(), startsAt: "2026-10-07T04:00:00.000Z", serviceDateKey: "2026-10-07" });
      await store.updateApportionAppointment({ appointmentId: completed.id, actorIdentifier: STAFF, action: "done" });
      const cancelled = await store.createApportionAppointment({ ...booking(), startsAt: "2026-10-08T04:00:00.000Z", serviceDateKey: "2026-10-08" });
      await store.cancelApportionAppointment({ appointmentId: cancelled.id, actorIdentifier: REQUESTER, reason: "Unavailable" });
      const optedOutAt = new Date().toISOString();
      fixtures.context!.memberships = [];
      vi.setSystemTime(new Date("2026-10-05T18:29:00.000Z"));
      const nextDayChanges = await store.applyApportionAddressOptOut(OWNER, "location-1", STAFF, "2026-10-04", optedOutAt);
      expect(nextDayChanges.map((entry) => entry.id)).toEqual([sameDay.id, nextDay.id, later.id, completed.id, cancelled.id]);
      expect((await persisted()).appointments.find((entry) => entry.id === sameDay.id)?.currentStatus).toBe("pending");
      expect((await persisted()).appointments.find((entry) => entry.id === completed.id)?.currentStatus).toBe("done");
      expect((await persisted()).appointments.find((entry) => entry.id === cancelled.id)?.canceledByIdentifier).toBe(REQUESTER);
      vi.setSystemTime(new Date("2026-10-06T18:31:00.000Z"));
      const expired = { ...nextDay, id: "expired-before-recovery", currentStatus: "pending" as const, statusUpdatedAt: optedOutAt, history: nextDay.history.filter((entry) => entry.action !== "cancelled") };
      const saved = await persisted();
      saved.appointments.push(expired);
      await writeFile(storePath, JSON.stringify(saved));
      const recovered = await store.applyApportionAddressOptOut(OWNER, "location-1", STAFF, "2026-10-04", optedOutAt);
      expect(recovered.map((entry) => entry.id)).toEqual([expired.id]);
      expect(recovered[0].currentStatus).toBe("pending");
      expect(recovered[0].history).toEqual(expired.history);
      expect(recovered[0].managementTransferred).toBe(true);
      const finalState = await persisted();
      expect(await store.applyApportionAddressOptOut(OWNER, "location-1", STAFF, "2026-10-04", optedOutAt)).toEqual([]);
      expect(await persisted()).toEqual(finalState);
    } finally {
      vi.useRealTimers();
    }
  });

  it("uses phone aliases for legacy views and actions without replacing IDs/history", async () => {
    expect(await store.listApportionAppointmentsForOwner("9111111111")).toHaveLength(1);
    expect(await store.listApportionAppointmentsForRequester("9444444444")).toHaveLength(1);
    await store.cancelApportionAppointment({ actorIdentifier: "9444444444", appointmentId: "old-id", reason: "Unavailable" });
    const persisted = JSON.parse(await readFile(storePath, "utf8"));
    expect(persisted.appointments[0]).toMatchObject({ id: "old-id", bookedQueuePosition: 7, currentStatus: "cancelled" });
    expect(persisted.appointments[0].history[0]).toEqual(legacy().history[0]);
  });

  it("projects one canonical record into owner, historical staff, requester and controller views", async () => {
    const appointment = await store.createApportionAppointment(booking());
    for (const identifier of ["9111111111", "9222222222", "9444444444"]) {
      const view = (await store.listApportionAppointmentsForActor(identifier)).find((entry) => entry.id === appointment.id);
      expect(view).toMatchObject({ id: appointment.id, canManage: identifier === "9222222222" });
    }
    expect((await store.listApportionAppointmentsForActor(ADMIN)).find((entry) => entry.id === appointment.id)).toMatchObject({ canManage: false, canMessage: false });
    for (const action of ["cancel", "done", "push-back", "reject", "present-in-person"] as const) {
      await expect(store.updateApportionAppointment({ appointmentId: appointment.id, actorIdentifier: OWNER, action })).rejects.toThrow();
      await expect(store.updateApportionAppointment({ appointmentId: appointment.id, actorIdentifier: ADMIN, action })).rejects.toThrow();
    }
    await expect(store.updateApportionAppointment({ appointmentId: appointment.id, actorIdentifier: STAFF, action: "reschedule", nextStartsAt: "2099-10-06T04:00:00.000Z" })).rejects.toThrow("Only the requester");
    await store.updateApportionAppointment({ appointmentId: appointment.id, actorIdentifier: "9444444444", action: "reschedule", nextStartsAt: "2099-10-06T04:00:00.000Z" });
    await store.updateApportionAppointment({ appointmentId: appointment.id, actorIdentifier: "9222222222", action: "done" });
    const owner = (await store.listApportionAppointmentsForActor(OWNER)).find((entry) => entry.id === appointment.id)!;
    const requester = (await store.listApportionAppointmentsForActor(REQUESTER)).find((entry) => entry.id === appointment.id)!;
    expect(owner.history).toEqual(requester.history);
    expect(owner.currentStatus).toBe("done");
    expect((await persisted()).appointments.filter((entry) => entry.id === appointment.id)).toHaveLength(1);
  });

  it("routes unassigned services to the current delegate or owner, never delegating Consultation", async () => {
    const unassigned = await store.createApportionAppointment(booking("unassigned"));
    expect(await store.resolveApportionAppointmentAccess(unassigned, ADMIN)).toMatchObject({ canManage: true });
    fixtures.context!.business.adminDelegateIdentifier = REQUESTER;
    expect(await store.resolveApportionAppointmentAccess(unassigned, ADMIN)).toMatchObject({ canManage: false, canView: false });
    expect(await store.resolveApportionAppointmentAccess(unassigned, REQUESTER)).toMatchObject({ canManage: true });
    fixtures.context!.business.adminDelegateIdentifier = null;
    await store.updateApportionAppointment({ appointmentId: unassigned.id, actorIdentifier: "9111111111", action: "done" });
    const consultation = (await store.listApportionAppointmentsForOwner(OWNER))[0];
    fixtures.context!.business.adminDelegateIdentifier = ADMIN;
    expect(await store.resolveApportionAppointmentAccess(consultation, OWNER)).toMatchObject({ canManage: true });
    expect(await store.resolveApportionAppointmentAccess(consultation, ADMIN)).toMatchObject({ canManage: false });
  });

  it("serializes capacity checks against directory settings and scopes slots and queues to service", async () => {
    const results = await Promise.allSettled(Array.from({ length: 8 }, () => store.createApportionAppointment(booking())));
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const consultation = await store.createApportionAppointment(booking("consultation"));
    const therapy = (await store.listApportionAppointmentsForOwner(OWNER)).find((entry) => entry.serviceId === "therapy")!;
    expect(therapy.queueOrder).toBe(1);
    expect(therapy).toMatchObject({ bookedSettings: { justAddToList: false, appointmentsPerSlot: 1, slotDurationMinutes: 30 }, justAddToList: false, locationName: "Main", locationAddress: "Main Street" });
    expect(consultation.queueOrder).toBe(1);
    expect(await store.listApportionSlotCounts("9111111111", "location-1", "therapy")).toEqual([{ count: 1, locationId: "location-1", serviceId: "therapy", startsAt: therapy.startsAt }]);
    expect((await store.listApportionSlotCounts(OWNER)).every((entry) => entry.serviceId === "consultation")).toBe(true);
    expect((await persisted()).appointments).toHaveLength(3);
  });
  it("enforces provider-global leave during canonical creation and rescheduling", async () => {
    fixtures.context!.providerClosedDateKeys = { [STAFF]: ["2099-10-06"] };
    await expect(store.createApportionAppointment(booking("therapy", "2099-10-06T04:00:00.000Z"))).rejects.toThrow("Provider unavailable");
    const appointment = await store.createApportionAppointment(booking("therapy", "2099-10-05T04:00:00.000Z"));
    await expect(store.updateApportionAppointment({
      appointmentId: appointment.id,
      actorIdentifier: REQUESTER,
      action: "reschedule",
      nextServiceDateKey: "2099-10-06",
      nextStartsAt: "2099-10-06T04:00:00.000Z",
    })).rejects.toThrow("Provider unavailable");
  });

  it("preserves snapshots after settings, assignment and tier changes; only first four/ten ACTIVE rows book", async () => {
    fixtures.context!.ownerCategory = "trapit-pro-max";
    for (let index = 0; index < 10; index += 1) fixtures.context!.business.services.push({ id: `extra-${index}`, name: `Extra ${index}`, active: index !== 0, assignedIdentifier: null, locationIds: ["location-1"] });
    const appointment = await store.createApportionAppointment(booking("extra-7"));
    await expect(store.createApportionAppointment(booking("extra-8"))).rejects.toThrow("not bookable");
    fixtures.context!.ownerCategory = "trapit-pro";
    fixtures.context!.providerSettings[OWNER] = { justAddToList: true, appointmentsPerSlot: 6, slotDurationMinutes: 1440 };
    await expect(store.createApportionAppointment(booking("extra-7", "2099-10-06T04:00:00.000Z"))).rejects.toThrow("not bookable");
    await expect(store.createApportionAppointment(booking("extra-2"))).rejects.toThrow("not bookable");
    await store.createApportionAppointment(booking("extra-1"));
    const saved = (await store.listApportionAppointmentsForOwner(OWNER)).find((entry) => entry.id === appointment.id)!;
    expect(saved.bookedSettings).toEqual({ justAddToList: false, appointmentsPerSlot: 1, slotDurationMinutes: 10 });
    expect(saved.justAddToList).toBe(false);
    expect(fixtures.context!.branding.appointmentShareCode).toBe("OLD-QR");
    expect((await persisted()).appointments.find((entry) => entry.id === "old-id")!.history).toEqual(legacy().history);
    fixtures.context!.ownerCategory = "trapit-normal";
    await expect(store.createApportionAppointment(booking("consultation"))).rejects.toThrow("not bookable");
  });

  it("keeps the lock across dynamic module instances and recovers after a rejected operation", async () => {
    vi.resetModules();
    const secondStore = await import("../../../apps/web/lib/apportion-store");
    const results = await Promise.allSettled([store.createApportionAppointment(booking()), secondStore.createApportionAppointment(booking())]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect((await secondStore.listApportionAppointmentsForOwner(OWNER)).filter((entry) => entry.serviceId === "therapy")).toHaveLength(1);
    await secondStore.createApportionAppointment(booking("therapy", "2099-10-06T04:00:00.000Z"));
    expect((await persisted()).appointments).toHaveLength(3);
  });

  it("keeps completed data and original history metadata when normalizing service queues", async () => {
    const completed = { ...legacy(), id: "completed", currentStatus: "done", queueOrder: 99, history: [{ ...legacy().history[0], note: "  Original note  ", id: "history-id" }] };
    const aliased = { ...legacy(), id: "alias", ownerIdentifier: "9111111111", queueOrder: 5, bookedQueuePosition: 8 };
    await writeFile(storePath, JSON.stringify({ appointments: [legacy(), completed, aliased] }));
    await store.createApportionAppointment(booking("consultation", legacy().startsAt.replace("04:00", "05:00")));
    const state = await persisted();
    expect(state.appointments.find((entry) => entry.id === "completed")).toMatchObject({ queueOrder: 99, currentStatus: "done", history: completed.history });
    const active = state.appointments.filter((entry) => entry.currentStatus === "pending").sort((first, second) => first.queueOrder - second.queueOrder);
    expect(active.map((entry) => entry.queueOrder)).toEqual([1, 2, 3]);
    expect(state.appointments.find((entry) => entry.id === "alias")!.bookedQueuePosition).toBe(8);
    expect(fixtures.context!.branding.appointmentShareCode).toBe("OLD-QR");
  });

  it("retains historical staff visibility while actions follow a new linked service provider", async () => {
    const appointment = await store.createApportionAppointment(booking());
    fixtures.context!.business.services[1].assignedIdentifier = ADMIN;
    fixtures.context!.memberships.push({ ...fixtures.context!.memberships[0], providerIdentifier: ADMIN });
    expect(await store.resolveApportionAppointmentAccess(appointment, STAFF)).toMatchObject({ canView: true, canManage: false });
    expect(await store.resolveApportionAppointmentAccess(appointment, ADMIN)).toMatchObject({ canView: true, canManage: true });
    expect((await store.listApportionAppointmentsForActor(ADMIN)).find((entry) => entry.id === appointment.id)).toMatchObject({ assignedStaffIdentifier: STAFF, canManage: true });
    await expect(store.cancelApportionAppointment({ actorIdentifier: STAFF, appointmentId: appointment.id })).rejects.toThrow();
    await store.cancelApportionAppointment({ actorIdentifier: ADMIN, appointmentId: appointment.id, reason: "Provider unavailable" });
  });

  it("migrates original notes once and retains the first booked time across reschedules", async () => {
    const original = legacy();
    const originalStartsAt = original.startsAt;
    const migrated = {
      ...original,
      notes: "  Please call on arrival.  ",
      customLegacyField: { kept: true },
      history: [...original.history, {
        action: "rescheduled", actorIdentifier: REQUESTER, at: "2026-02-01T00:00:00.000Z",
        fromStartsAt: originalStartsAt, toStartsAt: "2099-10-05T04:00:00.000Z", note: null,
      }],
      startsAt: "2099-10-05T04:00:00.000Z",
    };
    await writeFile(storePath, JSON.stringify({ appointments: [migrated] }));

    const firstRead = (await store.listApportionAppointmentsForRequester(REQUESTER))[0];
    const saved = await persisted();
    expect(firstRead).toMatchObject({
      notes: "Please call on arrival.",
      originalStartsAt,
      messages: [{ id: "initial-note:old-id", authorIdentifier: REQUESTER, createdAt: original.createdAt, body: "Please call on arrival." }],
      customLegacyField: { kept: true },
    });
    expect(saved.appointments[0].history).toEqual(migrated.history);
    await store.listApportionAppointmentsForRequester(REQUESTER);
    expect((await persisted()).appointments[0].messages).toHaveLength(1);
  });

  it("allows only requester/current controller to append immutable messages while active", async () => {
    const appointment = await store.createApportionAppointment({ ...booking(), notes: "Initial booking note" });
    const beforeHistory = appointment.history;
    const beforeStatus = appointment.statusUpdatedAt;
    await expect(store.updateApportionAppointment({ appointmentId: appointment.id, actorIdentifier: OWNER, action: "send-message", message: "Owner is read-only" })).rejects.toThrow();
    await expect(store.updateApportionAppointment({ appointmentId: appointment.id, actorIdentifier: ADMIN, action: "send-message", message: "Admin is read-only" })).rejects.toThrow();
    await expect(store.updateApportionAppointment({ appointmentId: appointment.id, actorIdentifier: "+919555555555", action: "send-message", message: "Historical staff is read-only" })).rejects.toThrow();
    const messages = await Promise.all([
      store.updateApportionAppointment({ appointmentId: appointment.id, actorIdentifier: REQUESTER, action: "send-message", message: "  Customer reply  " }),
      store.updateApportionAppointment({ appointmentId: appointment.id, actorIdentifier: STAFF, action: "send-message", message: "Controller reply" }),
    ]);
    expect(messages.flatMap((result) => result.appointment.messages).map(({ body }) => body)).toEqual(expect.arrayContaining(["Initial booking note", "Customer reply", "Controller reply"]));
    const saved = (await persisted()).appointments.find((entry) => entry.id === appointment.id)!;
    expect(saved.messages).toHaveLength(3);
    expect(saved.messages.filter((entry) => entry.body === "Customer reply")[0].authorIdentifier).toBe(REQUESTER);
    expect(saved.history).toEqual(beforeHistory);
    expect(saved.statusUpdatedAt).toBe(beforeStatus);
    await expect(store.updateApportionAppointment({ appointmentId: appointment.id, actorIdentifier: STAFF, action: "send-message", message: "\u0001" })).rejects.toThrow("control characters");
    await expect(store.updateApportionAppointment({ appointmentId: appointment.id, actorIdentifier: REQUESTER, action: "send-message", message: " " })).rejects.toThrow("1 to 2000");
    await store.updateApportionAppointment({ appointmentId: appointment.id, actorIdentifier: STAFF, action: "done" });
    expect((await store.listApportionAppointmentsForActor(REQUESTER)).find((entry) => entry.id === appointment.id)).toMatchObject({ canMessage: false });
    await expect(store.updateApportionAppointment({ appointmentId: appointment.id, actorIdentifier: STAFF, action: "send-message", message: "After completion" })).rejects.toThrow("closed");
  });

  it.each(["done", "rejected", "cancelled", "missed"] as const)("closes the thread when an appointment is %s", async (currentStatus) => {
    const appointment = await store.createApportionAppointment(booking());
    const state = await persisted();
    state.appointments.find((entry) => entry.id === appointment.id)!.currentStatus = currentStatus;
    await writeFile(storePath, JSON.stringify(state));

    expect((await store.listApportionAppointmentsForActor(STAFF)).find((entry) => entry.id === appointment.id)).toMatchObject({ canMessage: false });
    await expect(store.updateApportionAppointment({ appointmentId: appointment.id, actorIdentifier: STAFF, action: "send-message", message: "Terminal" })).rejects.toThrow("closed");
  });

  it("revalidates reschedule capacity and membership without changing booked settings", async () => {
    const appointment = await store.createApportionAppointment(booking());
    await store.createApportionAppointment(booking("therapy", "2099-10-06T04:00:00.000Z"));
    await expect(store.updateApportionAppointment({ appointmentId: appointment.id, actorIdentifier: REQUESTER, action: "reschedule", nextStartsAt: "2099-10-06T04:00:00.000Z", appointmentsPerSlot: 999 })).rejects.toThrow("already full");
    fixtures.context!.memberships[0].closedDateKeys = ["2099-10-07"];
    await expect(store.updateApportionAppointment({ appointmentId: appointment.id, actorIdentifier: REQUESTER, action: "reschedule", nextStartsAt: "2099-10-07T04:00:00.000Z" })).rejects.toThrow("unavailable on this day");
    fixtures.context!.providerSettings[STAFF].slotDurationMinutes = 1440;
    await store.updateApportionAppointment({ appointmentId: appointment.id, actorIdentifier: REQUESTER, action: "reschedule", nextStartsAt: "2099-10-08T04:00:00.000Z" });
    expect((await store.listApportionAppointmentsForOwner(OWNER)).find((entry) => entry.id === appointment.id)!.bookedSettings!.slotDurationMinutes).toBe(30);
    fixtures.context!.memberships = [];
    await expect(store.updateApportionAppointment({ appointmentId: appointment.id, actorIdentifier: REQUESTER, action: "reschedule", nextStartsAt: "2099-10-09T04:00:00.000Z" })).rejects.toThrow("Staff address unavailable");
  });

  it("preserves opted-out bookings, hands management to Admin, and is replay idempotent", async () => {
    const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
    const tomorrow = new Date(Date.now() + 330 * 60_000 + 86400_000).toISOString().slice(0, 10);
    fixtures.context!.providerSettings[STAFF].justAddToList = true;
    const current = await store.createApportionAppointment({ ...booking(), startsAt: `${today}T04:00:00.000Z`, serviceDateKey: today });
    const future = await store.createApportionAppointment({ ...booking(), startsAt: `${tomorrow}T04:00:00.000Z`, serviceDateKey: tomorrow });
    const otherAddress = await store.createApportionAppointment(booking("therapy", "2099-10-05T04:00:00.000Z", "location-2"));
    fixtures.context!.memberships = fixtures.context!.memberships.filter((entry) => entry.locationId !== "location-1");
    expect(await store.applyApportionAddressOptOut("9111111111", "location-1", "9222222222")).toHaveLength(2);
    const saved = await persisted();
    expect(saved.appointments.find((entry) => entry.id === future.id)).toMatchObject({ currentStatus: "pending", assignedStaffIdentifier: STAFF, managementTransferred: true });
    expect(saved.appointments.find((entry) => entry.id === current.id)).toMatchObject({ currentStatus: "pending" });
    expect(saved.appointments.find((entry) => entry.id === otherAddress.id)).toMatchObject({ currentStatus: "pending" });
    expect(await store.resolveApportionAppointmentAccess(current, ADMIN)).toMatchObject({ canManage: true });
    expect(await store.resolveApportionAppointmentAccess(current, STAFF)).toMatchObject({ canManage: false, canView: true });
    expect(await store.resolveApportionAppointmentAccess(otherAddress, STAFF)).toMatchObject({ canManage: true });
    await expect(store.createApportionAppointment(booking("therapy", "2099-10-06T04:00:00.000Z"))).rejects.toThrow("Staff address unavailable");
    const pending = (await store.listApportionPendingNotifications()).filter((entry) => !entry.webPushEligible && entry.title !== "New appointment");
    expect(pending).toHaveLength(6);
    expect(await store.listApportionNotificationsForActor("9444444444")).toHaveLength(2);
    expect(await store.applyApportionAddressOptOut(OWNER, "location-1", STAFF)).toEqual([]);
    expect(await persisted()).toEqual(saved);
    await store.markApportionNotificationDelivered(pending[0].id);
    await store.markApportionNotificationDelivered(pending[0].id);
    expect((await store.listApportionPendingNotifications()).filter((entry) => !entry.webPushEligible && entry.title !== "New appointment")).toHaveLength(5);
    await store.updateApportionAppointment({ appointmentId: current.id, actorIdentifier: ADMIN, action: "done" });
    fixtures.context!.business.adminDelegateIdentifier = null;
    expect(await store.resolveApportionAppointmentAccess(current, OWNER)).toMatchObject({ canManage: true });
  });

  it("serializes reads that mark missed alongside creation without losing either mutation", async () => {
    const old = { ...legacy(), id: "past", startsAt: "2020-01-01T04:00:00.000Z", serviceDateKey: "2020-01-01" };
    await writeFile(storePath, JSON.stringify({ appointments: [legacy(), old] }));
    await Promise.all([store.listApportionAppointmentsForOwner(OWNER), store.createApportionAppointment(booking()), store.listApportionAppointmentsForRequester(REQUESTER)]);
    const state = await persisted();
    expect(state.appointments).toHaveLength(3);
    expect(state.appointments.find((entry) => entry.id === "past")!.history.filter((entry) => entry.action === "missed")).toHaveLength(1);
    await store.listApportionAppointmentsForOwner(OWNER);
    expect((await persisted()).appointments.find((entry) => entry.id === "past")!.history.filter((entry) => entry.action === "missed")).toHaveLength(1);
  });

  it("fails closed for missing business, disabled service, invalid location and removed or closed membership", async () => {
    await expect(store.createApportionAppointment(booking("therapy", undefined, "missing"))).rejects.toThrow("not bookable");
    fixtures.context!.business.services[1].active = false;
    await expect(store.createApportionAppointment(booking())).rejects.toThrow("not bookable");
    fixtures.context!.business.services[1].active = true;
    fixtures.context!.memberships[0].closedDateKeys = ["2099-10-05"];
    await expect(store.createApportionAppointment(booking())).rejects.toThrow("unavailable on this day");
    fixtures.context = null;
    await expect(store.createApportionAppointment(booking())).rejects.toThrow("business is unavailable");
  });
});