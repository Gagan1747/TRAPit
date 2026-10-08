import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { normalizeWorkspaceBranding } from "../src/quiz";
import { matchApportionIdentity } from "../src/apportion-identity";
import type { ApportionBusinessContext } from "../../../apps/web/lib/apportion-directory";

const fixtures = vi.hoisted(() => ({ context: null as import("../../../apps/web/lib/apportion-directory").ApportionBusinessContext | null, getContext: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("../../../apps/web/lib/apportion-directory", () => ({ getApportionBusinessContext: fixtures.getContext }));
const OWNER = "+919111111111";
const STAFF = "+919222222222";
const TARGET = "+919444444444";
const OTHER = "+919555555555";
let directory: string;
let storePath: string;
let store: typeof import("../../../apps/web/lib/apportion-store");
const days = "Sunday Monday Tuesday Wednesday Thursday Friday Saturday";
const settings = () => ({ justAddToList: false, appointmentsPerSlot: 1, slotDurationMinutes: 30 });

function context(): ApportionBusinessContext {
  return {
    business: { ownerIdentifier: OWNER, adminDelegateIdentifier: OTHER, services: [
      { id: "consultation", name: "Consultation", active: true, assignedIdentifier: OWNER, locationIds: ["location-1"] },
      { id: "therapy", name: "Therapy", active: true, assignedIdentifier: STAFF, locationIds: ["location-1"] },
      { id: "unassigned", name: "Unassigned", active: true, assignedIdentifier: null, locationIds: ["location-1"] },
    ] },
    branding: normalizeWorkspaceBranding({ instituteName: "Clinic", appointmentLocations: [{ id: "location-1", name: "Main", address: "Main Street", workingDays: days, workingHours: "9:00 AM - 5:00 PM", workingHoursSecondWindow: "" }] } as never)!,
    ownerCategory: "trapit-pro", providerSettings: { [OWNER]: settings(), [STAFF]: settings() },
    memberships: [{ ownerIdentifier: OWNER, providerIdentifier: STAFF, locationId: "location-1", workingDays: days, workingHours: "9:00 AM - 5:00 PM", workingHoursSecondWindow: "", closedDateKeys: [] }],
    providerClosedDateKeys: {},
  };
}
const occurrence = (date = "2026-10-05") => ({ serviceDateKey: date, startsAt: `${date}T04:00:00.000Z` });
const input = (dates = ["2026-10-05"]) => ({ actorIdentifier: "9111111111", ownerIdentifier: OWNER, requesterIdentifier: TARGET,
  requesterName: "Customer", requesterPhone: TARGET, serviceId: "therapy", locationId: "location-1", notes: "Initial note", occurrences: dates.map((date) => occurrence(date)) });
const respond = (id: string, action: "accept" | "decline" | "cancel" = "accept", actorIdentifier = "9444444444") => store.respondToApportionInvitation({ invitationId: id, action, actorIdentifier });
async function persisted() { return JSON.parse(await readFile(storePath, "utf8")); }
async function book(date = "2026-10-05", requesterIdentifier = OTHER) {
  return store.createApportionAppointment({ ownerIdentifier: OWNER, requesterIdentifier, requesterName: "Other", serviceId: "therapy", locationId: "location-1", locationName: "Untrusted", ...occurrence(date) });
}
beforeAll(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "trapit-invitations-"));
  storePath = path.join(directory, "apportion-appointments.json");
  vi.stubEnv("TRAPIT_DATA_DIR", directory);
  store = await import("../../../apps/web/lib/apportion-store");
});
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-05T03:00:00.000Z"));
  fixtures.context = context();
  fixtures.getContext.mockReset().mockImplementation(async () => fixtures.context);
  await writeFile(storePath, JSON.stringify({ appointments: [] }));
});
afterEach(() => vi.useRealTimers());
afterAll(async () => { vi.unstubAllEnvs(); await rm(directory, { recursive: true, force: true }); });

describe("Apportion invitations", () => {
  it("acknowledges displayed messages per actor without clearing later arrivals or exposing cursors", async () => {
    const invitation = await store.createApportionInvitation(input());
    await respond(invitation.id);
    const appointmentId = (await persisted()).appointments[0].id;
    const send = (actorIdentifier: string, message: string) => store.updateApportionAppointment({ action: "send-message", actorIdentifier, appointmentId, message });
    const read = (actorIdentifier: string, lastMessageId: string) => store.updateApportionAppointment({ action: "mark-read", actorIdentifier, appointmentId, lastMessageId });
    const first = await send(STAFF, "First reply");
    const firstId = first.appointment.messages.at(-1)!.id;
    await send(STAFF, "Later reply");
    await expect(read(OTHER + "9", firstId)).rejects.toThrow("own appointments");
    await read(TARGET, firstId);
    let projected = (await store.listApportionAppointmentsForActor(TARGET))[0];
    expect(projected.hasUnreadMessages).toBe(true);
    expect(projected).not.toHaveProperty("messageReadCursors");
    await read(TARGET, projected.messages.at(-1)!.id);
    await read(TARGET, firstId);
    expect((await store.listApportionAppointmentsForActor(TARGET))[0].hasUnreadMessages).toBe(false);
    await send(TARGET, "My own reply");
    expect((await store.listApportionAppointmentsForActor(TARGET))[0].hasUnreadMessages).toBe(false);
    expect((await store.listApportionAppointmentsForActor(STAFF))[0].hasUnreadMessages).toBe(true);
    const saved = await persisted();
    delete saved.appointments[0].messageReadBaselineId;
    delete saved.appointments[0].messageReadCursors;
    await writeFile(storePath, JSON.stringify(saved));
    projected = (await store.listApportionAppointmentsForActor(STAFF))[0];
    expect(projected.hasUnreadMessages).toBe(false);
    await send(TARGET, "After migration");
    expect((await store.listApportionAppointmentsForActor(STAFF))[0].hasUnreadMessages).toBe(true);
  });
  it("matches formatted India aliases without cross-country suffix identity", () => {
    expect(matchApportionIdentity("+639444444444", TARGET)).toBe(false);
    expect(matchApportionIdentity(" +91 (94444) 44444 ", "9444444444")).toBe(true);
    expect(matchApportionIdentity("+639444444444", "9444444444")).toBe(false);
    expect(matchApportionIdentity("+639444444444", TARGET)).toBe(false);
    expect(matchApportionIdentity("+639444444444", "+63 94444 44444")).toBe(true);
    expect(matchApportionIdentity(" User@Example.com ", "user@example.com")).toBe(true);
    expect(matchApportionIdentity("", "")).toBe(false);
  });
  it("rejects foreign same-suffix creation, reads, responses and cancellation", async () => {
    await expect(store.createApportionInvitation({ ...input(), actorIdentifier: "+639111111111" })).rejects.toMatchObject({ status: 403 });
    const invitation = await store.createApportionInvitation(input());
    const before = await persisted();
    for (const identifier of ["+639111111111", "+639444444444"]) {
      expect(await store.listApportionInvitationsForActor(identifier)).toEqual([]);
      expect(await store.listApportionNotificationsForActor(identifier)).toEqual([]);
    }
    for (const action of ["accept", "decline"] as const) await expect(respond(invitation.id, action, "+639444444444")).rejects.toMatchObject({ status: 403 });
    await expect(respond(invitation.id, "cancel", "+639111111111")).rejects.toMatchObject({ status: 403 });
    expect(await persisted()).toEqual(before);
    expect((await respond(invitation.id)).invitation.status).toBe("accepted");
  });
  it("does not treat a foreign same-suffix target as an owner self-invitation", async () => {
    const invitation = await store.createApportionInvitation({ ...input(), requesterIdentifier: "+639111111111" });
    expect(await store.listApportionInvitationsForActor("9111111111")).toHaveLength(1);
    await expect(respond(invitation.id, "accept", "9111111111")).rejects.toMatchObject({ status: 403 });
    expect((await respond(invitation.id, "accept", "+639111111111")).invitation.status).toBe("accepted");
  });
  it("rejects a directory context whose canonical owner only shares a foreign suffix", async () => {
    fixtures.context!.business.ownerIdentifier = "+639111111111";
    await expect(store.createApportionInvitation(input())).rejects.toThrow("unavailable");
    expect((await persisted()).invitations ?? []).toEqual([]);
  });
  it("builds from the one validated context despite a later directory change", async () => {
    const invitation = await store.createApportionInvitation(input());
    const validatedContext = structuredClone(fixtures.context!);
    fixtures.context!.memberships[0].workingHours = "11:00 AM - 5:00 PM";
    fixtures.context!.business.services[1].assignedIdentifier = OWNER;
    fixtures.context!.providerSettings[OWNER].appointmentsPerSlot = 4;
    fixtures.getContext.mockReset().mockResolvedValueOnce(validatedContext).mockResolvedValue(fixtures.context);
    await respond(invitation.id);
    expect(fixtures.getContext).toHaveBeenCalledTimes(1);
    expect((await persisted()).appointments[0]).toMatchObject({ assignedStaffIdentifier: STAFF,
      bookedSettings: { appointmentsPerSlot: 1, slotDurationMinutes: 30 }, slotEndsAt: "2026-10-05T04:30:00.000Z" });
  });
      it("atomically accepts twelve duration occurrences using one owner context and backfills origins", async () => {
        const dates = Array.from({ length: 6 }, (_, week) => [5 + week * 7, 8 + week * 7]).flat().map((day) => new Date(Date.UTC(2026, 9, day)).toISOString().slice(0, 10));
        const invitation = await store.createApportionInvitation({ ...input(dates), recurrence: { mode: "weekly", durationCount: 6, weekdayKeys: ["Mon", "Thu"] }, recurrenceStartDateKey: "2026-10-05" });
        expect(fixtures.getContext).toHaveBeenCalledTimes(1);
        fixtures.getContext.mockClear();
        await respond(invitation.id);
        expect(fixtures.getContext).toHaveBeenCalledTimes(1);
        const saved = await persisted();
        expect(saved.appointments).toHaveLength(12);
        expect(saved.appointments.every((entry: { sourceInvitationId: string }) => entry.sourceInvitationId === invitation.id)).toBe(true);
        for (const appointment of saved.appointments) delete appointment.sourceInvitationId;
        await writeFile(storePath, JSON.stringify(saved));
        expect((await store.listApportionAppointmentsForRequester(TARGET)).every((entry) => entry.sourceInvitationId === invitation.id)).toBe(true);
      });
  it("keeps the saved 30-minute slot end when accepting at 09:50 after duration becomes 10", async () => {
    const invitation = await store.createApportionInvitation(input());
    fixtures.context!.providerSettings[STAFF].slotDurationMinutes = 10;
    fixtures.context!.providerSettings[STAFF].appointmentsPerSlot = 3;
    fixtures.context!.providerSettings[STAFF].justAddToList = true;
    vi.setSystemTime(new Date("2026-10-05T04:20:00.000Z"));
    await respond(invitation.id);
    expect((await persisted()).appointments[0]).toMatchObject({ startsAt: "2026-10-05T04:00:00.000Z", slotEndsAt: "2026-10-05T04:30:00.000Z", justAddToList: false,
      bookedSettings: { slotDurationMinutes: 30, appointmentsPerSlot: 3, justAddToList: false } });
  });
  it.each(["master", "provider"])("validates the saved duration against reduced current %s hours", async (schedule) => {
    const invitation = await store.createApportionInvitation(input());
    fixtures.context!.providerSettings[STAFF].slotDurationMinutes = 10;
    if (schedule === "master") fixtures.context!.branding.appointmentLocations![0].workingHours = "9:00 AM - 9:45 AM";
    else fixtures.context!.memberships[0].workingHours = "9:00 AM - 9:45 AM";
    const before = await persisted();
    await expect(respond(invitation.id)).rejects.toThrow();
    expect(await persisted()).toEqual(before);
  });
  it("recomputes queue starts with current capacity, clipped hours and saved duration/mode", async () => {
    fixtures.context!.providerSettings[STAFF].justAddToList = true;
    const invitation = await store.createApportionInvitation(input());
    await book();
    fixtures.context!.providerSettings[STAFF] = { justAddToList: false, appointmentsPerSlot: 2, slotDurationMinutes: 10 };
    fixtures.context!.branding.appointmentLocations![0].workingHours = "10:30 AM - 12:00 PM";
    fixtures.context!.memberships[0].workingHours = "10:00 AM - 1:00 PM";
    vi.setSystemTime(new Date("2026-10-05T04:15:00.000Z"));
    await respond(invitation.id);
    expect((await persisted()).appointments[1]).toMatchObject({ startsAt: "2026-10-05T05:30:00.000Z", justAddToList: true,
      bookedSettings: { slotDurationMinutes: 30, appointmentsPerSlot: 2, justAddToList: true } });
  });
  it("estimates a same-day queue from now rather than its old saved start", async () => {
    fixtures.context!.providerSettings[STAFF].justAddToList = true;
    const invitation = await store.createApportionInvitation(input());
    vi.setSystemTime(new Date("2026-10-05T04:15:00.000Z"));
    await respond(invitation.id);
    expect((await persisted()).appointments[0].startsAt).toBe("2026-10-05T04:15:00.000Z");
  });
  it("carries queue workload across current split windows", async () => {
    fixtures.context!.providerSettings[STAFF].justAddToList = true;
    const invitation = await store.createApportionInvitation(input());
    await book("2026-10-05", OTHER);
    await book("2026-10-05", OWNER);
    for (const schedule of [fixtures.context!.branding.appointmentLocations![0], fixtures.context!.memberships[0]]) {
      schedule.workingHours = "10:30 AM - 11:00 AM";
      schedule.workingHoursSecondWindow = "2:00 PM - 3:00 PM";
    }
    await respond(invitation.id);
    expect((await persisted()).appointments[2].startsAt).toBe("2026-10-05T09:00:00.000Z");
  });
  it("handles Saturday overnight queue windows using UTC service-day offsets", async () => {
    fixtures.context!.providerSettings[STAFF].justAddToList = true;
    for (const schedule of [fixtures.context!.branding.appointmentLocations![0], fixtures.context!.memberships[0]]) schedule.workingHours = "11:30 PM - 2:00 AM";
    const invitation = await store.createApportionInvitation({ ...input(), occurrences: [{ serviceDateKey: "2026-10-10", startsAt: "2026-10-10T18:00:00.000Z" }] });
    vi.setSystemTime(new Date("2026-10-10T18:15:00.000Z"));
    await respond(invitation.id);
    expect((await persisted()).appointments[0]).toMatchObject({ startsAt: "2026-10-10T18:15:00.000Z", serviceDateKey: "2026-10-10" });
  });
  it("rolls back every queue occurrence when a later current window cannot fit", async () => {
    fixtures.context!.providerSettings[STAFF].justAddToList = true;
    const invitation = await store.createApportionInvitation(input(["2026-10-05", "2026-10-06"]));
    fixtures.context!.branding.appointmentDateHoursOverrides = [{ dateKey: "2026-10-06", locations: [{ locationId: "location-1", workingHours: "9:00 AM - 9:20 AM", workingHoursSecondWindow: "" }] }];
    const before = await persisted();
    await expect(respond(invitation.id)).rejects.toThrow("No queue appointment fits");
    expect(await persisted()).toEqual(before);
  });
  it("enforces the original queue acceptance deadline despite a later current window", async () => {
    fixtures.context!.providerSettings[STAFF].justAddToList = true;
    const invitation = await store.createApportionInvitation(input());
    fixtures.context!.memberships[0].workingHours = "2:00 PM - 5:00 PM";
    vi.setSystemTime(new Date(invitation.expiresAt));
    await expect(respond(invitation.id)).rejects.toThrow("no longer pending");
    expect((await persisted()).appointments).toEqual([]);
  });
  it.each([false, true])("recovers delayed leave identically with an intervening expiry read: %s", async (readFirst) => {
    const invitation = await store.createApportionInvitation(input(["2026-10-06", "2026-10-07"]));
    const leaveAt = new Date().toISOString();
    fixtures.context!.providerClosedDateKeys = { [STAFF]: ["2026-10-06"] };
    vi.setSystemTime(new Date("2026-10-06T05:00:00.000Z"));
    if (readFirst) expect((await store.listApportionInvitationsForActor(TARGET))[0].status).toBe("expired");
    await store.applyApportionProviderLeave(STAFF, ["2026-10-06"], "2026-10-05", leaveAt);
    const saved = (await persisted()).invitations[0];
    expect(saved).toMatchObject({ id: invitation.id, status: "pending", expiresAt: "2026-10-07T04:30:00.000Z", statusUpdatedAt: "2026-10-06T05:00:00.000Z" });
    expect(saved.occurrences).toEqual([{ ...occurrence("2026-10-07"), slotEndsAt: "2026-10-07T04:30:00.000Z" }]);
    expect(saved.notifications.map((notice: { title: string }) => notice.title)).toEqual(["Appointment invitation", "Appointment invitation", "Appointment invitation updated", "Appointment invitation updated"]);
    await store.applyApportionProviderLeave(STAFF, ["2026-10-06"], "2026-10-05", leaveAt);
    expect((await persisted()).invitations[0]).toEqual(saved);
  });
  it("preserves delivered expiry history and original notices during delayed leave recovery", async () => {
    await store.createApportionInvitation(input(["2026-10-06", "2026-10-07"]));
    const originalNotices = (await persisted()).invitations[0].notifications;
    const leaveAt = new Date().toISOString();
    fixtures.context!.providerClosedDateKeys = { [STAFF]: ["2026-10-06"] };
    vi.setSystemTime(new Date("2026-10-06T05:00:00.000Z"));
    await store.listApportionInvitationsForActor(TARGET);
    const expiry = (await store.listApportionPendingNotifications()).find((notice) => notice.title === "Appointment invitation expired")!;
    await store.markApportionNotificationDelivered(expiry.id);
    await store.applyApportionProviderLeave(STAFF, ["2026-10-06"], "2026-10-05", leaveAt);
    const saved = (await persisted()).invitations[0];
    expect(saved.status).toBe("pending");
    expect(saved.notifications.filter((notice: { title: string }) => notice.title === "Appointment invitation")).toEqual(originalNotices);
    expect(saved.notifications.filter((notice: { title: string }) => notice.title === "Appointment invitation expired")).toEqual([expect.objectContaining({ id: expiry.id, deliveredAt: "2026-10-06T05:00:00.000Z" })]);
  });
  it.each([false, true])("cancels delayed leave's final date without stale expiry notices (read first: %s)", async (readFirst) => {
    await store.createApportionInvitation(input(["2026-10-06"]));
    const leaveAt = new Date().toISOString();
    fixtures.context!.providerClosedDateKeys = { [STAFF]: ["2026-10-06"] };
    vi.setSystemTime(new Date("2026-10-06T05:00:00.000Z"));
    if (readFirst) await store.listApportionInvitationsForActor(TARGET);
    await store.applyApportionProviderLeave(STAFF, ["2026-10-06"], "2026-10-05", leaveAt);
    const saved = (await persisted()).invitations[0];
    expect(saved).toMatchObject({ status: "cancelled", occurrences: [] });
    expect(saved.notifications.map((notice: { title: string }) => notice.title)).toEqual(["Appointment invitation", "Appointment invitation", "Appointment invitation cancelled", "Appointment invitation cancelled"]);
  });
  it.each(["accept", "decline", "cancel"] as const)("never resurrects an invitation already resolved by %s", async (action) => {
    const invitation = await store.createApportionInvitation(input(["2026-10-06", "2026-10-07"]));
    await respond(invitation.id, action, action === "cancel" ? OWNER : TARGET);
    const before = (await persisted()).invitations[0];
    fixtures.context!.providerClosedDateKeys = { [STAFF]: ["2026-10-06"] };
    vi.setSystemTime(new Date("2026-10-06T05:00:00.000Z"));
    await store.applyApportionProviderLeave(STAFF, ["2026-10-06"], "2026-10-05", invitation.createdAt);
    expect((await persisted()).invitations[0]).toEqual(before);
  });
  it("does not recover an invitation auto-expired before the saved intent", async () => {
    await store.createApportionInvitation(input(["2026-10-06", "2026-10-07"]));
    vi.setSystemTime(new Date("2026-10-06T04:30:00.000Z"));
    await store.listApportionInvitationsForActor(TARGET);
    const before = await persisted();
    fixtures.context!.providerClosedDateKeys = { [STAFF]: ["2026-10-06"] };
    await store.applyApportionProviderLeave(STAFF, ["2026-10-06"], "2026-10-05", "2026-10-06T05:00:00.000Z");
    expect(await persisted()).toEqual(before);
  });
  it("migrates the same file without dropping legacy metadata, snapshots, history or notes", async () => {
    const appointment = await book("2026-10-09");
    const old = { ...appointment, customMetadata: { retained: true }, originalStartsAt: "2026-10-09T03:30:00.000Z", slotEndsAt: "2026-10-09T20:00:00.000Z", queueExpiresAt: "2026-10-10T18:30:00.000Z" };
    await writeFile(storePath, JSON.stringify({ appointments: [old], metadata: { version: 5 } }));
    const invitation = await store.createApportionInvitation(input());
    expect(invitation).toMatchObject({ status: "pending", expiresAt: "2026-10-05T04:30:00.000Z" });
    expect((await persisted()).appointments[0]).toEqual(old);
    expect((await persisted()).metadata).toEqual({ version: 5 });
  });
  it("allows only the owner, rejects self invitations and caps total occurrences at six", async () => {
    for (const actorIdentifier of [STAFF, OTHER, TARGET]) await expect(store.createApportionInvitation({ ...input(), actorIdentifier })).rejects.toMatchObject({ status: 403 });
    await expect(store.createApportionInvitation({ ...input(), requesterIdentifier: "9111111111" })).rejects.toThrow("normal booking");
    await expect(store.createApportionInvitation(input([]))).rejects.toThrow("six");
    await expect(store.createApportionInvitation(input(Array.from({ length: 7 }, (_, index) => `2026-10-${String(index + 5).padStart(2, "0")}`)))).rejects.toThrow("six");
    await expect(store.createApportionInvitation(input(["2026-10-05", "2026-10-05"]))).rejects.toThrow("distinct");
    expect((await persisted()).appointments).toHaveLength(0);
  });
  it("projects only owner/target invitations and recipient-specific notifications", async () => {
    await store.createApportionInvitation(input());
    for (const identifier of [OWNER, TARGET]) {
      const invitations = await store.listApportionInvitationsForActor(identifier);
      expect(invitations).toHaveLength(1);
      expect(invitations[0].notifications.map((entry) => entry.recipientIdentifier)).toEqual([identifier]);
    }
    expect(await store.listApportionInvitationsForActor(STAFF)).toEqual([]);
    expect(await store.listApportionInvitationsForActor(OTHER)).toEqual([]);
    expect((await persisted()).invitations[0].notifications).toHaveLength(2);
  });
  it("does not hold capacity and rolls back every occurrence when a later slot fills", async () => {
    const invitation = await store.createApportionInvitation(input(["2026-10-05", "2026-10-06"]));
    expect(await store.listApportionSlotCounts(OWNER)).toEqual([]);
    await book("2026-10-06");
    const before = await persisted();
    await expect(respond(invitation.id)).rejects.toThrow("full");
    expect(await persisted()).toEqual(before);
  });
  it("accepts six canonical appointments atomically and retries without duplicate records or notices", async () => {
    const invitation = await store.createApportionInvitation(input(["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09", "2026-10-10"]));
    const first = await respond(invitation.id);
    expect(first.appointmentIds).toHaveLength(6);
    const saved = await persisted();
    expect(saved.appointments.every((entry: { requesterIdentifier: string; history: Array<{ actorIdentifier: string }>; messages: Array<{ body: string }> }) => entry.requesterIdentifier === TARGET && entry.history[0].actorIdentifier === TARGET && entry.messages[0].body === "Initial note")).toBe(true);
    expect(await respond(invitation.id)).toEqual(first);
    expect(await persisted()).toEqual(saved);
  });
  it("authorizes only the target for acceptance/decline and only the owner for cancellation", async () => {
    const invitation = await store.createApportionInvitation(input());
    for (const actor of [OWNER, STAFF, OTHER]) for (const action of ["accept", "decline"] as const) await expect(respond(invitation.id, action, actor)).rejects.toMatchObject({ status: 403 });
    await expect(respond(invitation.id, "cancel", TARGET)).rejects.toMatchObject({ status: 403 });
    await respond(invitation.id, "cancel", OWNER);
    expect((await store.listApportionInvitationsForActor(TARGET))[0].status).toBe("cancelled");
    await expect(respond(invitation.id)).rejects.toThrow("no longer pending");
  });
  it("declines without booking and keeps completed history idempotently", async () => {
    const invitation = await store.createApportionInvitation(input());
    await respond(invitation.id, "decline");
    const saved = await persisted();
    await respond(invitation.id, "decline");
    expect(await persisted()).toEqual(saved);
    expect(saved.appointments).toEqual([]);
    expect(saved.invitations[0].status).toBe("declined");
  });
  it("serializes concurrent acceptance of one invitation and racing invitations for one slot", async () => {
    const invitation = await store.createApportionInvitation(input());
    const other = await store.createApportionInvitation({ ...input(), requesterIdentifier: OTHER });
    const results = await Promise.allSettled([respond(invitation.id), respond(invitation.id), respond(other.id, "accept", OTHER)]);
    expect(results.map((entry) => entry.status)).toEqual(["fulfilled", "fulfilled", "rejected"]);
    expect((await persisted()).appointments).toHaveLength(1);
  });
  it("serializes invitation acceptance against a normal capacity booking", async () => {
    const invitation = await store.createApportionInvitation(input());
    const results = await Promise.allSettled([book(), respond(invitation.id)]);
    expect(results.map((entry) => entry.status)).toEqual(["fulfilled", "rejected"]);
    expect((await persisted()).appointments).toHaveLength(1);
  });
  it("rejects already booked requester service-day duplicates despite free capacity", async () => {
    fixtures.context!.providerSettings[STAFF].appointmentsPerSlot = 2;
    const invitation = await store.createApportionInvitation(input());
    await book("2026-10-05", TARGET);
    await expect(respond(invitation.id)).rejects.toThrow("already has");
    expect((await persisted()).appointments).toHaveLength(1);
  });
  it("accepts an original standard slot after start but before its snapshot end", async () => {
    const invitation = await store.createApportionInvitation(input());
    vi.setSystemTime(new Date("2026-10-05T04:15:00.000Z"));
    const accepted = await respond(invitation.id);
    expect(accepted.invitation.status).toBe("accepted");
    expect((await persisted()).appointments[0]).toMatchObject({ startsAt: "2026-10-05T04:00:00.000Z", justAddToList: false, currentStatus: "pending" });
  });
  it("accepts an overnight standard slot after IST midnight on its original service day", async () => {
    fixtures.context!.branding.appointmentLocations![0].workingHours = "11:30 PM - 2:30 AM";
    fixtures.context!.memberships[0].workingHours = "11:30 PM - 2:30 AM";
    fixtures.context!.providerSettings[STAFF].slotDurationMinutes = 60;
    const invitation = await store.createApportionInvitation({ ...input(), occurrences: [{ serviceDateKey: "2026-10-05", startsAt: "2026-10-05T18:00:00.000Z" }] });
    vi.setSystemTime(new Date("2026-10-05T18:45:00.000Z"));
    expect((await respond(invitation.id)).invitation.status).toBe("accepted");
    expect((await persisted()).appointments[0]).toMatchObject({ serviceDateKey: "2026-10-05", queueExpiresAt: "2026-10-06T18:30:00.000Z" });
  });
  it("preserves queue mode while rechecking open schedules and canonical requester history", async () => {
    fixtures.context!.providerSettings[STAFF].justAddToList = true;
    const invitation = await store.createApportionInvitation(input());
    await book();
    await respond(invitation.id);
    expect((await persisted()).appointments).toHaveLength(2);
    expect((await persisted()).appointments[1]).toMatchObject({ justAddToList: true, requesterIdentifier: TARGET, queueOrder: 2 });
  });
  it("uses the current assigned provider but preserves the invited duration on acceptance", async () => {
    const invitation = await store.createApportionInvitation(input());
    fixtures.context!.business.services[1].assignedIdentifier = OWNER;
    fixtures.context!.providerSettings[OWNER].slotDurationMinutes = 10;
    await respond(invitation.id);
    expect((await persisted()).appointments[0]).toMatchObject({ assignedStaffIdentifier: OWNER, bookedSettings: { slotDurationMinutes: 30 } });
  });
  it("rejects two separate accepted invitations for the same requester service day", async () => {
    fixtures.context!.providerSettings[STAFF].appointmentsPerSlot = 2;
    const first = await store.createApportionInvitation(input());
    const second = await store.createApportionInvitation(input());
    const results = await Promise.allSettled([respond(first.id), respond(second.id)]);
    expect(results.map((entry) => entry.status)).toEqual(["fulfilled", "rejected"]);
    expect((await persisted()).appointments).toHaveLength(1);
  });
  it("expires at exact first end on reads and worker lifecycle, without duplicate notifications", async () => {
    const invitation = await store.createApportionInvitation(input());
    vi.setSystemTime(new Date(invitation.expiresAt));
    expect(await store.reconcileApportionLifecycle()).toBe(true);
    const saved = await persisted();
    expect(saved.invitations[0].status).toBe("expired");
    expect(saved.invitations[0].notifications).toHaveLength(4);
    await expect(respond(invitation.id)).rejects.toThrow("no longer pending");
    expect(await store.reconcileApportionLifecycle()).toBe(false);
    expect(await persisted()).toEqual(saved);
    expect((await store.listApportionInvitationsForActor(TARGET))[0].status).toBe("expired");
  });
  it("uses the saved duration for expiry even after provider settings change", async () => {
    const invitation = await store.createApportionInvitation(input());
    fixtures.context!.providerSettings[STAFF].slotDurationMinutes = 10;
    vi.setSystemTime(new Date("2026-10-05T04:20:00.000Z"));
    expect((await store.listApportionInvitationsForActor(TARGET))[0].status).toBe("pending");
    expect((await respond(invitation.id)).invitation.status).toBe("accepted");
  });
  it("expires during an ordinary list read without requiring worker reconciliation", async () => {
    const invitation = await store.createApportionInvitation(input());
    vi.setSystemTime(new Date(invitation.expiresAt));
    expect((await store.listApportionInvitationsForActor(TARGET))[0].status).toBe("expired");
    expect((await store.listApportionPendingNotifications()).filter((entry) => entry.title === "Appointment invitation expired")).toHaveLength(2);
  });
  it.each(["inactive", "unlinked", "master", "membership", "provider-leave", "membership-leave", "capacity"]) ("rechecks current %s and leaves the whole invitation untouched on rejection", async (change) => {
    const invitation = await store.createApportionInvitation(input(["2026-10-05", "2026-10-06"]));
    if (change === "inactive") fixtures.context!.business.services[1].active = false;
    if (change === "unlinked") fixtures.context!.memberships = [];
    if (change === "master") fixtures.context!.branding.appointmentDateOverrides = { closedDateKeys: ["2026-10-06"], openedDateKeys: [] };
    if (change === "membership") fixtures.context!.memberships[0].workingHours = "10:00 AM - 5:00 PM";
    if (change === "provider-leave") fixtures.context!.providerClosedDateKeys = { [STAFF]: ["2026-10-06"] };
    if (change === "membership-leave") fixtures.context!.memberships[0].closedDateKeys = ["2026-10-06"];
    if (change === "capacity") { await book("2026-10-06"); fixtures.context!.providerSettings[STAFF].appointmentsPerSlot = 1; }
    const before = await persisted();
    await expect(respond(invitation.id)).rejects.toThrow();
    expect(await persisted()).toEqual(before);
  });
  it("clips acceptance to current master hours even when staff hours remain wider", async () => {
    const invitation = await store.createApportionInvitation(input());
    fixtures.context!.branding.appointmentLocations![0].workingHours = "10:00 AM - 5:00 PM";
    await expect(respond(invitation.id)).rejects.toThrow("business hours");
    expect((await persisted()).appointments).toEqual([]);
  });
  it("preserves same-day leave occurrences and removes only matching future dates durably", async () => {
    const invitation = await store.createApportionInvitation(input(["2026-10-05", "2026-10-06", "2026-10-07"]));
    fixtures.context!.providerClosedDateKeys = { [STAFF]: ["2026-10-05", "2026-10-06"] };
    expect(await store.applyApportionProviderLeave(STAFF, ["2026-10-05", "2026-10-06"], "2026-10-05", new Date().toISOString())).toEqual([]);
    const pending = (await store.listApportionInvitationsForActor(TARGET))[0];
    expect(pending.occurrences.map((entry) => entry.serviceDateKey)).toEqual(["2026-10-05", "2026-10-07"]);
    expect(pending.expiresAt).toBe(invitation.expiresAt);
    expect(pending.notifications).toHaveLength(2);
    const saved = await persisted();
    await store.applyApportionProviderLeave(STAFF, ["2026-10-06"], "2026-10-05", new Date().toISOString());
    expect(await persisted()).toEqual(saved);
  });
  it("recomputes the first remaining end and cancels when future leave removes the final date", async () => {
    const invitation = await store.createApportionInvitation(input(["2026-10-06", "2026-10-07"]));
    fixtures.context!.providerClosedDateKeys = { [STAFF]: ["2026-10-06"] };
    await store.applyApportionProviderLeave(STAFF, ["2026-10-06"], "2026-10-05", new Date().toISOString());
    expect((await store.listApportionInvitationsForActor(TARGET))[0].expiresAt).toBe("2026-10-07T04:30:00.000Z");
    fixtures.context!.providerClosedDateKeys = { [STAFF]: ["2026-10-06", "2026-10-07"] };
    await store.applyApportionProviderLeave(STAFF, ["2026-10-07"], "2026-10-05", new Date().toISOString());
    expect((await store.listApportionInvitationsForActor(TARGET))[0]).toMatchObject({ id: invitation.id, status: "cancelled", occurrences: [] });
  });
  it("does not prune reopened, reassigned or unassigned services on old provider/owner leave", async () => {
    const unassigned = await store.createApportionInvitation({ ...input(["2026-10-06"]), serviceId: "unassigned" });
    const assigned = await store.createApportionInvitation(input(["2026-10-06"]));
    fixtures.context!.providerClosedDateKeys = { [OWNER]: ["2026-10-06"] };
    await store.applyApportionProviderLeave(OWNER, ["2026-10-06"], "2026-10-05", new Date().toISOString());
    await store.applyApportionProviderLeave(STAFF, ["2026-10-06"], "2026-10-05", new Date().toISOString());
    expect((await store.listApportionInvitationsForActor(TARGET)).every((entry) => entry.status === "pending" && entry.occurrences.length === 1)).toBe(true);
    fixtures.context!.business.services[1].assignedIdentifier = OWNER;
    fixtures.context!.providerClosedDateKeys = { [STAFF]: ["2026-10-06"] };
    await store.applyApportionProviderLeave(STAFF, ["2026-10-06"], "2026-10-05", new Date().toISOString());
    expect((await persisted()).invitations.map((entry: { id: string }) => entry.id).sort()).toEqual([unassigned.id, assigned.id].sort());
    expect((await persisted()).invitations.every((entry: { status: string }) => entry.status === "pending")).toBe(true);
  });
  it("aggregates recipient notices into the existing durable outbox and acknowledges once", async () => {
    await store.createApportionInvitation(input());
    const outbox = await store.listApportionPendingNotifications();
    expect(outbox).toHaveLength(2);
    expect(outbox.filter((notice) => notice.webPushEligible).map((notice) => notice.recipientIdentifier)).toEqual([TARGET]);
    expect(await store.listApportionNotificationsForActor(TARGET)).toHaveLength(1);
    await store.markApportionNotificationDelivered(outbox[0].id);
    const saved = await persisted();
    await store.markApportionNotificationDelivered(outbox[0].id);
    expect(await persisted()).toEqual(saved);
    expect(await store.listApportionPendingNotifications()).toHaveLength(1);
  });
});