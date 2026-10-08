import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";

const fixtures = vi.hoisted(() => ({
  actor: { sub: "account", identifier: "member@example.com", role: "user" } as { sub: string | null; identifier: string | null; role: string } | null,
  upsert: vi.fn(), remove: vi.fn(),
}));
vi.mock("next/server", () => ({ NextResponse: { json: (body: unknown, init?: ResponseInit) => new Response(JSON.stringify(body), { status: init?.status || 200 }) } }));
vi.mock("../../../apps/web/lib/workspace-actor", () => ({ getWorkspaceActor: async () => fixtures.actor }));
vi.mock("../../../apps/web/lib/notification-store", () => ({ upsertWebPushSubscription: fixtures.upsert, removeOwnedWebPushSubscription: fixtures.remove }));
const api = await import("../../../apps/web/app/api/user/web-push-subscriptions/route");
const subscription = { endpoint: "https://fcm.googleapis.com/push/example", keys: { auth: "a".repeat(22), p256dh: "b".repeat(87) } };
const request = (body: unknown, method = "POST", origin = "https://trapit.in") => new Request("https://trapit.in/api/user/web-push-subscriptions", {
  method, headers: { "Content-Type": "application/json", origin }, body: JSON.stringify(body),
});
beforeEach(() => {
  vi.clearAllMocks();
  fixtures.actor = { sub: "account", identifier: "member@example.com", role: "user" };
  fixtures.upsert.mockResolvedValue({ id: "subscription" });
  fixtures.remove.mockResolvedValue(undefined);
});
afterEach(() => vi.restoreAllMocks());

describe("authenticated browser push enrollment", () => {
  it("derives ownership only from the authenticated session, ignoring submitted account identifiers", async () => {
    const response = await api.POST(request({ ...subscription, userSub: "victim", userIdentifier: "victim@example.com" }));
    expect(response.status).toBe(200);
    expect(fixtures.upsert).toHaveBeenCalledWith(expect.objectContaining({ userSub: "account", userIdentifier: "member@example.com" }));
  });
  it("rejects unauthenticated and scaffold actors without account identities", async () => {
    fixtures.actor = null;
    expect((await api.POST(request(subscription))).status).toBe(403);
    fixtures.actor = { sub: null, identifier: null, role: "admin" };
    expect((await api.POST(request(subscription))).status).toBe(403);
    expect(fixtures.upsert).not.toHaveBeenCalled();
  });
  it("rejects cross-origin registration and deletion", async () => {
    expect((await api.POST(request(subscription, "POST", "https://attacker.invalid"))).status).toBe(403);
    expect((await api.DELETE(request(subscription, "DELETE", "https://attacker.invalid"))).status).toBe(403);
    expect(fixtures.upsert).not.toHaveBeenCalled();
    expect(fixtures.remove).not.toHaveBeenCalled();
  });
  it.each(["http://fcm.googleapis.com/push/a", "https://127.0.0.1/push", "https://fcm.googleapis.com.attacker.invalid/push"])("rejects unsafe push endpoint %s", async (endpoint) => {
    expect((await api.POST(request({ ...subscription, endpoint }))).status).toBe(400);
    expect(fixtures.upsert).not.toHaveBeenCalled();
  });
  it("handles invalid JSON/types and surfaces storage failures", async () => {
    expect((await api.POST(request({ endpoint: 123, keys: { auth: {}, p256dh: [] } }))).status).toBe(400);
    expect((await api.POST(new Request("https://trapit.in/api/user/web-push-subscriptions", { method: "POST", body: "{" }))).status).toBe(400);
    fixtures.upsert.mockRejectedValueOnce(new Error("Store unavailable"));
    const response = await api.POST(request(subscription));
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ error: "Store unavailable" });
  });
  it("deletes only the current authenticated account binding", async () => {
    expect((await api.DELETE(request(subscription, "DELETE"))).status).toBe(200);
    expect(fixtures.remove).toHaveBeenCalledWith(subscription.endpoint, "account");
  });
});

describe("private and same-origin service worker notifications", () => {
  async function harness() {
    const handlers = new Map<string, (event: unknown) => void>();
    const showNotification = vi.fn().mockResolvedValue(undefined);
    const openWindow = vi.fn().mockResolvedValue(undefined);
    const source = await readFile(path.resolve("..", "..", "apps", "web", "public", "sw.js"), "utf8");
    vm.runInNewContext(source, {
      self: { location: { origin: "https://trapit.in" }, registration: { showNotification }, addEventListener: (name: string, callback: (event: unknown) => void) => handlers.set(name, callback) },
      clients: { matchAll: async () => [], openWindow },
      URL, Date,
    });
    return { handlers, showNotification, openWindow };
  }
  it("never displays private payload text or titles and safely handles malformed payloads", async () => {
    const worker = await harness();
    const waitUntil = vi.fn();
    worker.handlers.get("push")!({ data: { json: () => ({ title: "Private patient", body: "Private location", data: { url: "//attacker.invalid", deliveryKey: "event-1" } }) }, waitUntil });
    expect(worker.showNotification).toHaveBeenCalledWith("TRAPit.in notification", expect.objectContaining({ body: "Sign in to view your TRAPit.in update.", data: { url: "https://trapit.in/user" }, tag: "event-1" }));
    worker.handlers.get("push")!({ data: { json: () => { throw new Error("invalid"); } }, waitUntil });
    expect(worker.showNotification).toHaveBeenCalledTimes(2);
  });
  it.each(["https://attacker.invalid", "//attacker.invalid", "/\\attacker.invalid", "javascript:alert(1)"])("does not navigate to unsafe URL %s", async (url) => {
    const worker = await harness();
    let completion: Promise<unknown> | undefined;
    worker.handlers.get("notificationclick")!({ notification: { close: vi.fn(), data: { url } }, waitUntil: (promise: Promise<unknown>) => { completion = promise; } });
    await completion;
    expect(worker.openWindow).toHaveBeenCalledWith("https://trapit.in/user");
  });
});
