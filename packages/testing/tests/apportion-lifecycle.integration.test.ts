import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

vi.mock("server-only", () => ({}));
vi.mock("../../../apps/web/lib/apportion-directory", () => ({ getApportionBusinessContext: async () => null }));
let directory: string;
let storePath: string;
let store: typeof import("../../../apps/web/lib/apportion-store");
const owner = "+919111111111";
const requester = "+919444444444";
function appointment(id: string, queueOrder: number, extra = {}) {
  return { id, ownerIdentifier: owner, requesterIdentifier: requester, requesterName: "Customer", startsAt: "2026-10-05T04:00:00.000Z", createdAt: "2026-10-04T04:00:00.000Z", currentStatus: "pending", locationId: "location-1", serviceId: "consultation", serviceDateKey: "2026-10-05", queueOrder, justAddToList: true, slotEndsAt: "2026-10-05T04:30:00.000Z", queueExpiresAt: "2026-10-05T18:30:00.000Z", ...extra };
}
beforeAll(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "trapit-lifecycle-"));
  storePath = path.join(directory, "apportion-appointments.json");
  vi.stubEnv("TRAPIT_DATA_DIR", directory);
  store = await import("../../../apps/web/lib/apportion-store");
});
beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-10-05T05:00:00.000Z")); });
afterAll(async () => { vi.useRealTimers(); vi.unstubAllEnvs(); await rm(directory, { recursive: true, force: true }); });

describe("Apportion lifecycle", () => {
  it("preserves either saved boundary when migrating a partial snapshot", async () => {
    await writeFile(storePath, JSON.stringify({ appointments: [appointment("slot", 1, { slotEndsAt: "2026-10-05T06:00:00.000Z", queueExpiresAt: undefined }), appointment("overnight", 2, { slotEndsAt: undefined, queueExpiresAt: "2026-10-06T18:30:00.000Z" })] }));
    const entries = await store.listApportionAppointmentsForOwner(owner);
    expect(entries.find((entry) => entry.id === "slot")?.slotEndsAt).toBe("2026-10-05T06:00:00.000Z");
    expect(entries.find((entry) => entry.id === "overnight")?.queueExpiresAt).toBe("2026-10-06T18:30:00.000Z");
  });
  it("moves an absent standard booking to the queue tail before its slot ends", async () => {
    vi.setSystemTime(new Date("2026-10-05T03:00:00.000Z"));
    await writeFile(storePath, JSON.stringify({ appointments: [appointment("slot", 1, { justAddToList: false }), appointment("queue", 2)] }));
    const result = await store.updateApportionAppointment({ action: "reject", appointmentId: "slot", actorIdentifier: owner });
    expect(result.appointment).toMatchObject({ justAddToList: true, currentStatus: "pushed-back", queueOrder: 2, queueConvertedAt: "2026-10-05T03:00:00.000Z" });
    await expect(store.updateApportionAppointment({ action: "reschedule", appointmentId: "slot", actorIdentifier: requester, nextStartsAt: "2026-10-05T06:00:00.000Z" })).rejects.toThrow("Queue appointments cannot be rescheduled");
    await store.updateApportionAppointment({ action: "send-message", appointmentId: "slot", actorIdentifier: requester, message: "I will wait." });
    expect((await store.listApportionAppointmentsForRequester(requester)).find((entry) => entry.id === "slot")?.messages.at(-1)?.body).toBe("I will wait.");
  });
  it("moves queue Absent back exactly four positions and leaves it active", async () => {
    await writeFile(storePath, JSON.stringify({ appointments: Array.from({ length: 7 }, (_, index) => appointment(`ticket-${index}`, index + 1)) }));
    const result = await store.updateApportionAppointment({ action: "reject", appointmentId: "ticket-0", actorIdentifier: owner });
    expect(result.appointment).toMatchObject({ currentStatus: "pushed-back", queueOrder: 5 });
    expect(result.appointment.history.at(-1)?.action).toBe("rejected");
  });
  it("converts an expired standard slot once, retaining its original time", async () => {
    await writeFile(storePath, JSON.stringify({ appointments: [appointment("slot", 1, { justAddToList: false }), appointment("queue", 2)] }));
    const entries = await store.listApportionAppointmentsForOwner(owner);
    expect(entries.find((entry) => entry.id === "slot")).toMatchObject({ justAddToList: true, currentStatus: "pushed-back", queueOrder: 2, startsAt: "2026-10-05T04:00:00.000Z" });
    const saved = await readFile(storePath, "utf8");
    await store.listApportionAppointmentsForOwner(owner);
    expect(await readFile(storePath, "utf8")).toBe(saved);
  });
  it("preserves overnight and future queues at midnight, then catches up idempotently", async () => {
    await writeFile(storePath, JSON.stringify({ appointments: [appointment("day", 1), appointment("overnight", 2, { slotEndsAt: "2026-10-05T20:00:00.000Z", queueExpiresAt: "2026-10-06T18:30:00.000Z" }), appointment("future", 3, { serviceDateKey: "2026-10-08", startsAt: "2026-10-08T04:00:00.000Z", slotEndsAt: "2026-10-08T04:30:00.000Z", queueExpiresAt: "2026-10-08T18:30:00.000Z" })] }));
    vi.setSystemTime(new Date("2026-10-05T18:30:00.000Z"));
    const first = await store.listApportionAppointmentsForOwner(owner);
    expect(first.find((entry) => entry.id === "day")?.currentStatus).toBe("missed");
    expect(first.find((entry) => entry.id === "overnight")?.currentStatus).toBe("pending");
    expect(first.find((entry) => entry.id === "future")?.currentStatus).toBe("pending");
    vi.setSystemTime(new Date("2026-10-07T00:00:00.000Z"));
    const caughtUp = await store.listApportionAppointmentsForOwner(owner);
    expect(caughtUp.find((entry) => entry.id === "overnight")?.currentStatus).toBe("missed");
    const saved = await readFile(storePath, "utf8");
    await store.listApportionAppointmentsForOwner(owner);
    expect(await readFile(storePath, "utf8")).toBe(saved);
  });
});