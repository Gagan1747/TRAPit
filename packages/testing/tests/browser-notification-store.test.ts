import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";

vi.mock("server-only", () => ({}));
const directory = path.resolve(".browser-notification-test-data");
let store: typeof import("../../../apps/web/lib/notification-store");
const now = Date.parse("2026-10-08T10:00:00Z");
const schedule = (id = "instance-1", minutes = 30) => ({
  kind: "poll" as const, id,
  startsAt: new Date(now + minutes * 60_000).toISOString(),
  endsAt: new Date(now + (minutes + 60) * 60_000).toISOString(),
  recipients: ["user@example.com"],
});
beforeEach(async () => {
  vi.resetModules();
  await mkdir(directory, { recursive: true });
  vi.stubEnv("TRAPIT_NOTIFICATION_FILE", path.join(directory, "notification-state.json"));
  store = await import("../../../apps/web/lib/notification-store");
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(directory, { recursive: true, force: true });
});

describe("durable browser scheduling intents", () => {
  it("baselines historical scheduling without replay and recovers new scheduling after reload", async () => {
    expect(await store.reconcileBrowserNotificationIntents([schedule()], now)).toEqual([]);
    const next = schedule("instance-2");
    const pending = await store.reconcileBrowserNotificationIntents([schedule(), next], now);
    expect(pending.map((intent) => [intent.entityId, intent.phase])).toEqual([["instance-2", "confirmed"]]);
    vi.resetModules();
    store = await import("../../../apps/web/lib/notification-store");
    expect(await store.reconcileBrowserNotificationIntents([schedule(), next], now)).toEqual(pending);
    const persisted = JSON.parse(await readFile(path.join(directory, "notification-state.json"), "utf8"));
    expect(persisted.browserBaseline).toBe(true);
    expect(persisted.browserIntents).toHaveLength(5);
  });
  it("starts at first worker tick at/after start, not in the 15-minute window, and never alerts after end", async () => {
    const item = schedule();
    await store.reconcileBrowserNotificationIntents([item], now);
    expect((await store.reconcileBrowserNotificationIntents([item], now + 20 * 60_000)).map((entry) => entry.phase)).toEqual(["15min"]);
    expect((await store.reconcileBrowserNotificationIntents([item], now + 31 * 60_000)).map((entry) => entry.phase)).toEqual(["start"]);
    expect(await store.reconcileBrowserNotificationIntents([item], Date.parse(item.endsAt))).toEqual([]);
  });
  it("uses separate instance/start keys and discards obsolete reschedule and removed recipient intents", async () => {
    await store.reconcileBrowserNotificationIntents([], now);
    const first = await store.reconcileBrowserNotificationIntents([schedule()], now);
    const second = await store.reconcileBrowserNotificationIntents([schedule("instance-1", 40)], now);
    expect(first[0].key).not.toBe(second[0].key);
    expect(await store.reconcileBrowserNotificationIntents([{ ...schedule(), recipients: [] }], now)).toEqual([]);
    expect(await store.reconcileBrowserNotificationIntents([], now)).toEqual([]);
  });
  it("has no eligible recipients solely from public availability", async () => {
    await store.reconcileBrowserNotificationIntents([], now);
    expect(await store.reconcileBrowserNotificationIntents([{ ...schedule(), recipients: [] }], now)).toEqual([]);
  });
  it("preserves concurrent delivery records and rebinds subscriptions without old account ownership or dedup", async () => {
    const input = { endpoint: "https://fcm.googleapis.com/push/abc", keys: { auth: "auth", p256dh: "key" }, userIdentifier: "one@example.com", userSub: "one" };
    const first = await store.upsertWebPushSubscription(input);
    await Promise.all([store.recordNotificationDelivery("first", first.id), store.recordNotificationDelivery("second", first.id)]);
    expect(await store.hasNotificationDelivery("first", first.id)).toBe(true);
    expect(await store.hasNotificationDelivery("second", first.id)).toBe(true);
    const next = await store.upsertWebPushSubscription({ ...input, userIdentifier: "two@example.com", userSub: "two" });
    expect(next.id).not.toBe(first.id);
    expect(next.userSub).toBe("two");
    expect(await store.hasNotificationDelivery("first", next.id)).toBe(false);
    await store.removeOwnedWebPushSubscription(input.endpoint, "one");
    expect(await store.listWebPushSubscriptions()).toHaveLength(1);
    await store.removeOwnedWebPushSubscription(input.endpoint, "two");
    expect(await store.listWebPushSubscriptions()).toEqual([]);
    await expect(store.upsertWebPushSubscription({ ...input, userSub: null })).rejects.toThrow("valid web push subscription");
  });
});
