import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { normalizeWorkspaceBranding } from "../src/quiz";
import type { ApportionBusinessContext } from "../../../apps/web/lib/apportion-directory";

const fixtures = vi.hoisted(() => ({ context: null as ApportionBusinessContext | null }));
vi.mock("server-only", () => ({}));
vi.mock("../../../apps/web/lib/apportion-directory", () => ({
  getApportionBusinessContext: async () => fixtures.context,
  getApportionBusinessContexts: async (owners: string[]) => new Map(owners.map((owner) => [owner, fixtures.context])),
  resolveApportionProviderContact: async (identifier: string) => ({ name: "Provider", phone: identifier }),
}));
const owner = "+919111111111";
const staff = "+919222222222";
const customer = "+919444444444";
const directory = path.resolve(".browser-apportion-outbox-test-data");
const file = path.join(directory, "apportion-appointments.json");
let store: typeof import("../../../apps/web/lib/apportion-store");
const settings = { justAddToList: false, appointmentsPerSlot: 2, slotDurationMinutes: 30 };
const occurrence = (day = "2026-10-05", time = "04:00") => ({ serviceDateKey: day, startsAt: `${day}T${time}:00.000Z` });
const book = () => store.createApportionAppointment({
  ownerIdentifier: owner, requesterIdentifier: customer, requesterName: "Customer", serviceId: "therapy",
  locationId: "location-1", locationName: "Main", notes: "Original note", ...occurrence(),
});
const invite = () => store.createApportionInvitation({
  ownerIdentifier: owner, actorIdentifier: owner, requesterIdentifier: customer, requesterName: "Customer",
  serviceId: "therapy", locationId: "location-1", occurrences: [occurrence(), occurrence("2026-10-06")],
});
const persisted = async () => JSON.parse(await readFile(file, "utf8"));
const browserPending = async () => (await store.listApportionPendingNotifications()).filter((notice) => notice.webPushEligible);
const at = (time: string) => vi.setSystemTime(new Date(`2026-10-05T${time}:00.000Z`));

beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers({ toFake: ["Date"] });
  at("03:00");
  const days = "Sunday Monday Tuesday Wednesday Thursday Friday Saturday";
  fixtures.context = {
    business: { ownerIdentifier: owner, adminDelegateIdentifier: null, services: [
      { id: "therapy", name: "Therapy", active: true, assignedIdentifier: staff, locationIds: ["location-1"] },
    ] },
    branding: normalizeWorkspaceBranding({ instituteName: "Clinic", appointmentLocations: [
      { id: "location-1", name: "Main", address: "Main street", workingDays: days, workingHours: "9:00 AM - 5:00 PM", workingHoursSecondWindow: "" },
    ] } as never)!,
    ownerCategory: "trapit-pro", providerSettings: { [staff]: settings },
    memberships: [{ ownerIdentifier: owner, providerIdentifier: staff, locationId: "location-1", workingDays: days, workingHours: "9:00 AM - 5:00 PM", workingHoursSecondWindow: "", closedDateKeys: [] }],
  };
  await mkdir(directory, { recursive: true });
  await writeFile(file, JSON.stringify({ appointments: [], invitations: [] }));
  vi.stubEnv("TRAPIT_DATA_DIR", directory);
  store = await import("../../../apps/web/lib/apportion-store");
});
afterEach(async () => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  await rm(directory, { recursive: true, force: true });
});

describe("durable customer-only appointment browser outbox", () => {
  it("atomically saves creation, 30-minute and 1-minute intents, without native/in-app additions", async () => {
    const appointment = await book();
    const saved = await persisted();
    expect(saved.browserNotificationIntents.map((notice: { phase: string }) => notice.phase)).toEqual(["confirmed", "30min", "1min"]);
    expect(saved.browserNotificationIntents.every((notice: { recipientIdentifier: string; webPushEligible: boolean; mobilePushEligible: boolean }) =>
      notice.recipientIdentifier === customer && notice.webPushEligible && !notice.mobilePushEligible)).toBe(true);
    expect(appointment.notifications).toHaveLength(1);
    expect(appointment.notifications![0]).toMatchObject({ recipientIdentifier: owner, mobilePushEligible: false });
    expect(appointment.notifications![0].webPushEligible).not.toBe(true);
    expect(await store.listApportionNotificationsForActor(customer)).toEqual([]);
    const creation = (await browserPending())[0];
    expect(creation.id).toContain("apportion-browser:");
    await store.markApportionNotificationDelivered(creation.id);
    at("03:30");
    const thirty = (await browserPending())[0];
    expect(thirty.title).toBe("TRAPit.in appointment update");
    await store.markApportionNotificationDelivered(thirty.id);
    vi.resetModules();
    store = await import("../../../apps/web/lib/apportion-store");
    expect(await browserPending()).toEqual([]);
    at("03:59");
    const one = await browserPending();
    expect(one).toHaveLength(1);
    expect(one[0].id).not.toBe(thirty.id);
    at("04:00");
    expect(await browserPending()).toEqual([]);
    expect((await persisted()).browserNotificationIntents).toHaveLength(3);
  });

  it.each(["03:45", "03:59:30"])("skips reminders due before creation at %s", async (time) => {
    vi.setSystemTime(new Date(`2026-10-05T${time.length === 5 ? `${time}:00` : time}.000Z`));
    await book();
    expect((await persisted()).browserNotificationIntents.map((notice: { phase: string }) => notice.phase))
      .toEqual(time === "03:45" ? ["confirmed", "1min"] : ["confirmed"]);
  });

  it("baselines legacy schedules and disables legacy web alerts without dropping native notices", async () => {
    at("03:45");
    await writeFile(file, JSON.stringify({ appointments: [{
      id: "legacy", ownerIdentifier: owner, requesterIdentifier: customer, requesterName: "Customer",
      createdAt: "2026-10-04T03:00:00Z", currentStatus: "pending", ...occurrence(), locationId: "location-1",
      slotEndsAt: "2026-10-05T04:30:00Z", queueExpiresAt: "2026-10-05T18:30:00Z",
      notifications: [{ id: "legacy-alert", recipientIdentifier: owner, title: "Legacy", body: "Native body", url: "/user", createdAt: "2026-10-04T03:00:00Z", webPushEligible: true }],
    }], browserNotificationIntents: [{ id: "old-start", phase: "start" }] }));
    expect(await browserPending()).toEqual([]);
    const saved = await persisted();
    expect(saved.browserNotificationVersion).toBe(1);
    expect(saved.browserNotificationIntents.map((notice: { phase: string }) => notice.phase)).toEqual(["1min"]);
    expect((await store.listApportionPendingNotifications()).find((notice) => notice.id === "legacy-alert"))
      .toMatchObject({ body: "Native body", webPushEligible: false });
    at("03:59");
    expect(await browserPending()).toHaveLength(1);
  });

  it("invalidates old occurrence intents on reschedule and all scheduled alerts on cancellation", async () => {
    const appointment = await book();
    const original = (await browserPending())[0].id;
    at("03:10");
    await store.updateApportionAppointment({
      action: "reschedule", actorIdentifier: customer, appointmentId: appointment.id,
      nextStartsAt: occurrence("2026-10-05", "04:30").startsAt,
    });
    expect((await browserPending()).map((notice) => notice.id)).not.toContain(original);
    expect(await browserPending()).toHaveLength(1);
    await store.cancelApportionAppointment({ actorIdentifier: customer, appointmentId: appointment.id, reason: "Changed plans" });
    at("04:29");
    expect(await browserPending()).toEqual([]);
    const saved = (await persisted()).appointments[0];
    expect(saved.notes).toBe("Original note");
    expect(saved.messages.at(-1).body).toBe("Cancellation reason: Changed plans");
    expect(saved.currentStatus).toBe("cancelled");
    expect(saved.notifications).toHaveLength(1);
  });

  it("uses independent recurrence keys, suppresses canceled invitations, and follows accepted bookings", async () => {
    const invitation = await invite();
    const creation = await browserPending();
    expect(creation).toHaveLength(2);
    expect(new Set(creation.map((notice) => notice.id)).size).toBe(2);
    expect(creation.every((notice) => notice.recipientIdentifier === customer)).toBe(true);
    for (const notice of creation) await store.markApportionNotificationDelivered(notice.id);
    await store.respondToApportionInvitation({ actorIdentifier: customer, invitationId: invitation.id, action: "accept" });
    expect(await browserPending()).toHaveLength(2);
    const pendingIds = new Set((await browserPending()).map((notice) => notice.id));
    expect(creation.every((notice) => !pendingIds.has(notice.id))).toBe(true);
    for (const id of (await persisted()).invitations[0].appointmentIds) {
      await store.cancelApportionAppointment({ actorIdentifier: customer, appointmentId: id, reason: "Unavailable" });
    }
    expect(await browserPending()).toEqual([]);
  });
  it("suppresses an unaccepted recurring invitation after cancel without altering its native notices", async () => {
    const invitation = await invite();
    expect(await browserPending()).toHaveLength(2);
    await store.respondToApportionInvitation({ actorIdentifier: owner, invitationId: invitation.id, action: "cancel", reason: "Provider unavailable" });
    at("03:59");
    expect(await browserPending()).toEqual([]);
    expect(await store.listApportionNotificationsForActor(customer)).toHaveLength(2);
    expect((await persisted()).invitations[0].messages.at(-1).body).toBe("Cancellation reason: Provider unavailable");
  });
});
