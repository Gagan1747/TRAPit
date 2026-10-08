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
  it("rejects Absent and push-back for slots before their slot ends", async () => {
    vi.setSystemTime(new Date("2026-10-05T03:00:00.000Z"));
    await writeFile(storePath, JSON.stringify({ appointments: [appointment("slot", 1, { justAddToList: false }), appointment("queue", 2)] }));
    await expect(store.updateApportionAppointment({ action: "reject", appointmentId: "slot", actorIdentifier: owner })).rejects.toThrow("Absent is available only for queue");
    await expect(store.updateApportionAppointment({ action: "push-back", appointmentId: "slot", actorIdentifier: owner })).rejects.toThrow("Slot appointments cannot");
    await store.updateApportionAppointment({ action: "send-message", appointmentId: "slot", actorIdentifier: requester, message: "I will wait." });
    expect((await store.listApportionAppointmentsForRequester(requester)).find((entry) => entry.id === "slot")?.messages.at(-1)?.body).toBe("I will wait.");
  });
  it("moves queue Absent back exactly four positions and leaves it active", async () => {
    await writeFile(storePath, JSON.stringify({ appointments: Array.from({ length: 7 }, (_, index) => appointment(`ticket-${index}`, index + 1)) }));
    const result = await store.updateApportionAppointment({ action: "reject", appointmentId: "ticket-0", actorIdentifier: owner });
    expect(result.appointment).toMatchObject({ currentStatus: "pushed-back", queueOrder: 5 });
    expect(result.appointment.history.at(-1)?.action).toBe("rejected");
  });
  it("marks an expired standard slot Delayed once without changing its type or original time", async () => {
    await writeFile(storePath, JSON.stringify({ appointments: [appointment("slot", 1, { justAddToList: false }), appointment("queue", 2)] }));
    const entries = await store.listApportionAppointmentsForOwner(owner);
    expect(entries.find((entry) => entry.id === "slot")).toMatchObject({ justAddToList: false, currentStatus: "delayed", startsAt: "2026-10-05T04:00:00.000Z", slotExpiresAt: "2026-10-05T18:30:00.000Z" });
    expect(entries.find((entry) => entry.id === "slot")).not.toHaveProperty("queueConvertedAt");
    const saved = await readFile(storePath, "utf8");
    await store.listApportionAppointmentsForOwner(owner);
    expect(await readFile(storePath, "utf8")).toBe(saved);
  });
  it("allows messaging and Done after delay and never expires Done", async () => {
    await writeFile(storePath, JSON.stringify({ appointments: [appointment("slot", 1, { justAddToList: false })] }));
    await expect(store.updateApportionAppointment({ action: "reject", appointmentId: "slot", actorIdentifier: owner })).rejects.toThrow("Absent is available only for queue");
    await store.updateApportionAppointment({ action: "send-message", appointmentId: "slot", actorIdentifier: requester, message: "Still waiting." });
    expect((await store.updateApportionAppointment({ action: "done", appointmentId: "slot", actorIdentifier: owner })).appointment.currentStatus).toBe("done");
    vi.setSystemTime(new Date("2026-10-06T00:00:00Z"));
    expect((await store.listApportionAppointmentsForOwner(owner))[0].currentStatus).toBe("done");
  });
  it("expires slots at their own midnight instead of the later service-window queue cutoff", async () => {
    await writeFile(storePath, JSON.stringify({ appointments: [appointment("slot", 1, { justAddToList: false, queueExpiresAt: "2026-10-06T18:30:00Z" }), appointment("queue", 2, { queueExpiresAt: "2026-10-06T18:30:00Z" })] }));
    vi.setSystemTime(new Date("2026-10-05T18:30:00Z"));
    const entries = await store.listApportionAppointmentsForOwner(owner);
    expect(entries.find((entry) => entry.id === "slot")?.currentStatus).toBe("missed");
    expect(entries.find((entry) => entry.id === "queue")?.currentStatus).toBe("pending");
  });
  it("keeps a slot active through its exact end and expires at an exact-midnight end", async () => {
    await writeFile(storePath, JSON.stringify({ appointments: [appointment("slot", 1, { justAddToList: false, startsAt: "2026-10-05T18:00:00Z", slotEndsAt: "2026-10-05T18:30:00Z" })] }));
    vi.setSystemTime(new Date("2026-10-05T18:29:59Z"));
    expect((await store.listApportionAppointmentsForOwner(owner))[0].currentStatus).toBe("pending");
    vi.setSystemTime(new Date("2026-10-05T18:30:00Z"));
    expect((await store.listApportionAppointmentsForOwner(owner))[0].currentStatus).toBe("missed");
  });
  it("protects overnight slots until their next midnight and keeps future slots pending", async () => {
    await writeFile(storePath, JSON.stringify({ appointments: [appointment("overnight", 1, { justAddToList: false, startsAt: "2026-10-05T18:00:00Z", slotEndsAt: "2026-10-05T19:00:00Z" }), appointment("future", 2, { justAddToList: false, serviceDateKey: "2026-10-08", startsAt: "2026-10-08T04:00:00Z", slotEndsAt: "2026-10-08T04:30:00Z" })] }));
    vi.setSystemTime(new Date("2026-10-05T18:30:00Z"));
    expect((await store.listApportionAppointmentsForOwner(owner)).find((entry) => entry.id === "overnight")?.currentStatus).toBe("pending");
    vi.setSystemTime(new Date("2026-10-05T19:00:00Z"));
    expect((await store.listApportionAppointmentsForOwner(owner)).find((entry) => entry.id === "overnight")?.currentStatus).toBe("delayed");
    vi.setSystemTime(new Date("2026-10-06T18:30:00Z"));
    const entries = await store.listApportionAppointmentsForOwner(owner);
    expect(entries.find((entry) => entry.id === "overnight")?.currentStatus).toBe("missed");
    expect(entries.find((entry) => entry.id === "future")?.currentStatus).toBe("pending");
  });
  it("restores proven automatic conversions only, retaining IDs history and messages", async () => {
    const conversion = { action: "pushed-back", actorIdentifier: "system", at: "2026-10-05T04:30:00Z", toStartsAt: "2026-10-05T04:00:00.000Z", note: "Booked slot ended: moved to the end of the service-day queue." };
    const converted = { currentStatus: "pushed-back", queueConvertedAt: conversion.at, bookedSettings: { justAddToList: false, appointmentsPerSlot: 1, slotDurationMinutes: 30 }, history: [conversion] };
    await writeFile(storePath, JSON.stringify({ appointments: [
      appointment("automatic", 1, { ...converted, notes: "Keep this note" }),
      appointment("ambiguous", 2, { ...converted, bookedSettings: undefined }),
      appointment("manual", 3, { ...converted, history: [{ ...conversion, action: "rejected", actorIdentifier: owner }] }),
      appointment("terminal", 4, { ...converted, currentStatus: "done" }),
    ] }));
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const entries = await store.listApportionAppointmentsForOwner(owner);
      const restored = entries.find((entry) => entry.id === "automatic")!;
      expect(restored).toMatchObject({ id: "automatic", justAddToList: false, currentStatus: "delayed" });
      expect(restored.history[0].action).toBe("pushed-back");
      expect(restored.history.some((entry) => entry.action === "slot-restored")).toBe(true);
      expect(restored.messages[0].body).toBe("Keep this note");
      expect(entries.filter((entry) => entry.id !== "automatic").every((entry) => entry.justAddToList)).toBe(true);
      expect(warning).toHaveBeenCalledOnce();
      const saved = await readFile(storePath, "utf8");
      await store.listApportionAppointmentsForOwner(owner);
      expect(await readFile(storePath, "utf8")).toBe(saved);
      expect(warning).toHaveBeenCalledOnce();
    } finally { warning.mockRestore(); }
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