import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fixtures = vi.hoisted(() => ({
  tokens: [] as Array<{ id: string; userIdentifier: string; token: string }>,
  subscriptions: [] as Array<{ id: string; userIdentifier: string; endpoint: string; keys: { auth: string; p256dh: string } }>,
  delivered: new Set<string>(),
  send: vi.fn(), mark: vi.fn(), markSchedule: vi.fn(), reconcile: vi.fn(), reconcileLeaves: vi.fn(), lifecycle: vi.fn(), publish: vi.fn(), readPending: vi.fn(), readSchedule: vi.fn(),
  pending: [{ id: "optout-1", recipientIdentifier: "+919222222222", title: "Address unavailable", body: "Appointment cancelled.", url: "/user" }] as Array<{ id: string; recipientIdentifier: string; title: string; body: string; url: string; webPushEligible?: boolean; mobilePushEligible?: boolean }>,
  schedulePending: [] as Array<{ id: string; recipientIdentifier: string; message: string; createdAt: string }>,
  schedules: [] as Array<{ kind: "test" | "poll"; id: string; startsAt: string; endsAt: string; recipients: string[] }>,
  intents: [] as Array<{ key: string; instanceKey: string; recipientIdentifier: string; kind: "test" | "poll"; entityId: string; phase: "confirmed" | "15min" | "start" }>,
  remove: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({ NextResponse: { json: (body: unknown, init?: ResponseInit) => new Response(JSON.stringify(body), { status: init?.status || 200 }) } }));
vi.mock("../../../apps/web/node_modules/web-push", () => ({ default: { setVapidDetails: vi.fn(), sendNotification: fixtures.send } }));
vi.mock("../../../apps/web/lib/realtime-events", () => ({ publishWorkspaceEvent: fixtures.publish }));
vi.mock("../../../apps/web/lib/apportion-store", () => ({ listApportionPendingNotifications: fixtures.readPending, markApportionNotificationDelivered: fixtures.mark, reconcileApportionLifecycle: fixtures.lifecycle }));
vi.mock("../../../apps/web/lib/apportion-directory", () => ({
  reconcileApportionAddressOptOuts: fixtures.reconcile,
  reconcileApportionProviderLeaves: fixtures.reconcileLeaves,
  listPendingApportionScheduleNotifications: fixtures.readSchedule,
  markApportionScheduleNotificationDelivered: fixtures.markSchedule,
}));
vi.mock("../../../apps/web/lib/testing-store", () => ({
  listAvailableTestsForParticipant: async () => [], listAvailablePollsForParticipant: async () => [],
  listBrowserNotificationSchedules: async () => fixtures.schedules,
}));
vi.mock("../../../apps/web/lib/notification-store", () => ({
  listPushTokens: async () => fixtures.tokens, listWebPushSubscriptions: async () => fixtures.subscriptions,
  hasNotificationDelivery: async (key: string, id: string) => fixtures.delivered.has(`${key}:${id}`),
  recordNotificationDelivery: async (key: string, id: string) => { fixtures.delivered.add(`${key}:${id}`); },
  reconcileBrowserNotificationIntents: async () => fixtures.intents,
  browserScheduleInstanceKey: (schedule: { kind: string; id: string; startsAt: string }) => `${schedule.kind}:${schedule.id}:${schedule.startsAt}`,
  removeWebPushSubscription: fixtures.remove,
}));
const worker = await import("../../../apps/web/app/api/internal/notifications/run/route");
const request = () => new Request("https://trapit.in/api/internal/notifications/run", { method: "POST", headers: { authorization: "Bearer worker-secret" } });
beforeEach(() => {
  vi.clearAllMocks();
  fixtures.send.mockReset();
  fixtures.reconcile.mockReset().mockResolvedValue(undefined);
  fixtures.reconcileLeaves.mockReset().mockResolvedValue(undefined);
  fixtures.lifecycle.mockReset().mockResolvedValue(false);
  fixtures.readPending.mockReset().mockImplementation(async () => fixtures.pending);
  fixtures.readSchedule.mockReset().mockImplementation(async () => fixtures.schedulePending);
  fixtures.markSchedule.mockReset().mockResolvedValue(undefined);
  fixtures.tokens = [];
  fixtures.subscriptions = [];
  fixtures.schedulePending = [];
  fixtures.pending = [{ id: "optout-1", recipientIdentifier: "+919222222222", title: "Address unavailable", body: "Appointment cancelled.", url: "/user" }];
  fixtures.schedules = [];
  fixtures.intents = [];
  fixtures.remove.mockImplementation(async (id: string) => { fixtures.subscriptions = fixtures.subscriptions.filter((entry) => entry.id !== id); });
  fixtures.delivered.clear();
  vi.stubEnv("TRAPIT_NOTIFICATION_WORKER_SECRET", "worker-secret");
  vi.stubEnv("NEXT_PUBLIC_WEB_PUSH_PUBLIC_KEY", "public");
  vi.stubEnv("WEB_PUSH_PRIVATE_KEY", "private");
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("durable Apportion notification worker", () => {
  it("expires invitations through lifecycle before reading and delivering their shared outbox", async () => {
    const notices: typeof fixtures.pending = [];
    fixtures.lifecycle.mockImplementation(async () => {
      await Promise.resolve();
      if (notices.length) return false;
      notices.push({ id: "invitation-expiry", recipientIdentifier: "+919222222222", title: "Appointment invitation expired", body: "Acceptance deadline passed.", url: "/user?section=apportion&invitationId=invite-1" });
      return true;
    });
    fixtures.readPending.mockImplementation(async () => {
      expect(notices).toHaveLength(1);
      return notices;
    });
    fixtures.subscriptions = [{ id: "browser", userIdentifier: "9222222222", endpoint: "endpoint", keys: { auth: "auth", p256dh: "key" } }];
    fixtures.send.mockResolvedValue({});
    await worker.POST(request());
    await worker.POST(request());
    expect(fixtures.send).toHaveBeenCalledOnce();
    expect(fixtures.send.mock.calls[0][1]).toContain("TRAPit.in appointment update");
    expect(fixtures.send.mock.calls[0][1]).not.toContain("Acceptance deadline passed.");
    expect(fixtures.mark).toHaveBeenCalledWith("invitation-expiry");
    expect(fixtures.publish).toHaveBeenCalledOnce();
  });
  it("serializes overlapping worker calls without duplicate successful push delivery", async () => {
    fixtures.subscriptions = [{ id: "browser", userIdentifier: "9222222222", endpoint: "endpoint", keys: { auth: "auth", p256dh: "key" } }];
    fixtures.send.mockImplementation(async () => { await Promise.resolve(); return {}; });
    await Promise.all([worker.POST(request()), worker.POST(request())]);
    expect(fixtures.send).toHaveBeenCalledTimes(1);
    expect(fixtures.reconcileLeaves).toHaveBeenCalledTimes(2);
    expect(fixtures.lifecycle).toHaveBeenCalledTimes(2);
  });
  it("reconciles leaves and lifecycle before reading the outbox and publishes changes", async () => {
    fixtures.lifecycle.mockResolvedValue(true);
    fixtures.readPending.mockImplementation(async () => {
      expect(fixtures.reconcileLeaves).toHaveBeenCalledTimes(1);
      expect(fixtures.lifecycle).toHaveBeenCalledTimes(1);
      return fixtures.pending;
    });
    await worker.POST(request());
    expect(fixtures.publish).toHaveBeenCalledWith("apportion");
  });
  it("awaits reconciliation before reading pending notifications without a panel visit", async () => {
    let reconciled = false;
    fixtures.reconcile.mockImplementation(async () => { await Promise.resolve(); reconciled = true; });
    fixtures.readPending.mockImplementation(async () => { expect(reconciled).toBe(true); return fixtures.pending; });
    await worker.POST(request());
    expect(fixtures.reconcile).toHaveBeenCalledTimes(1);
    expect(fixtures.readPending).toHaveBeenCalledTimes(1);
  });
  it("leaves recovery retryable when reconciliation fails and rejects unauthorized recovery", async () => {
    fixtures.reconcile.mockRejectedValueOnce(new Error("Recovery unavailable"));
    await expect(worker.POST(request())).rejects.toThrow("Recovery unavailable");
    expect(fixtures.readPending).not.toHaveBeenCalled();
    await worker.POST(request());
    expect(fixtures.readPending).toHaveBeenCalledTimes(1);
    fixtures.reconcile.mockClear();
    const response = await worker.POST(new Request("https://trapit.in/api/internal/notifications/run", { method: "POST" }));
    expect(response.status).toBe(401);
    expect(fixtures.reconcile).not.toHaveBeenCalled();
  });
  it("retries failed subscriptions without repeating successful deliveries", async () => {
    fixtures.subscriptions = ["first", "second"].map((id) => ({ id, userIdentifier: "9222222222", endpoint: id, keys: { auth: "auth", p256dh: "key" } }));
    fixtures.send.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error("Temporary push failure"));
    await worker.POST(request());
    expect(fixtures.mark).not.toHaveBeenCalled();
    expect(fixtures.delivered.has("apportion:optout-1:first")).toBe(true);
    expect(fixtures.delivered.has("apportion:optout-1:second")).toBe(false);
    fixtures.send.mockResolvedValueOnce({});
    await worker.POST(request());
    expect(fixtures.send).toHaveBeenCalledTimes(3);
    expect(fixtures.send.mock.calls[2][0].endpoint).toBe("second");
    expect(fixtures.mark).toHaveBeenCalledWith("optout-1");
  });
  it("keeps notifications pending when no browser permissions/subscriptions exist", async () => {
    await worker.POST(request());
    expect(fixtures.mark).not.toHaveBeenCalled();
    expect(fixtures.send).not.toHaveBeenCalled();
  });
  it("does not drop retries when browser push is unconfigured", async () => {
    vi.stubEnv("WEB_PUSH_PRIVATE_KEY", "");
    fixtures.subscriptions = [{ id: "first", userIdentifier: "9222222222", endpoint: "first", keys: { auth: "auth", p256dh: "key" } }];
    await worker.POST(request());
    expect(fixtures.mark).not.toHaveBeenCalled();
    expect(fixtures.delivered.size).toBe(0);
  });
  it("records only accepted Expo tickets", async () => {
    fixtures.tokens = [{ id: "mobile", userIdentifier: "9222222222", token: "ExponentPushToken[test]" }];
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ status: "error" }] }))).mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ status: "ok" }] })));
    vi.stubGlobal("fetch", fetchMock);
    await worker.POST(request());
    expect(fixtures.mark).not.toHaveBeenCalled();
    expect(fixtures.delivered.size).toBe(0);
    await worker.POST(request());
    expect(fixtures.delivered.has("apportion:optout-1:mobile")).toBe(true);
    expect(fixtures.mark).toHaveBeenCalledWith("optout-1");
  });
  it("delivers and acknowledges durable schedule notices through the existing push worker", async () => {
    fixtures.schedulePending = [{ id: "schedule-1", recipientIdentifier: "+919222222222", message: "Your hours changed.", createdAt: "2026-10-04T09:00:00Z" }];
    fixtures.subscriptions = [{ id: "browser", userIdentifier: "9222222222", endpoint: "endpoint", keys: { auth: "auth", p256dh: "key" } }];
    fixtures.send.mockResolvedValueOnce({}).mockResolvedValueOnce({});
    await worker.POST(request());
    expect(fixtures.send).toHaveBeenNthCalledWith(2, expect.objectContaining({ endpoint: "endpoint" }), expect.stringContaining("Sign in to view it."));
    expect(fixtures.markSchedule).toHaveBeenCalledWith("schedule-1");
  });

  describe("browser scheduling worker", () => {
    it("does not add native New appointment delivery while retaining browser delivery", async () => {
      fixtures.pending = [{ id: "new-appointment", recipientIdentifier: "9222222222", title: "New appointment", body: "New booking", url: "/user", mobilePushEligible: false }];
      fixtures.tokens = [{ id: "mobile", userIdentifier: "9222222222", token: "ExponentPushToken[test]" }];
      fixtures.subscriptions = [{ id: "browser", userIdentifier: "9222222222", endpoint: "endpoint", keys: { auth: "auth", p256dh: "key" } }];
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);
      fixtures.send.mockResolvedValue({});
      await worker.POST(request());
      expect(fetchMock).not.toHaveBeenCalled();
      expect(fixtures.send).toHaveBeenCalledOnce();
      expect(fixtures.mark).toHaveBeenCalledWith("new-appointment");
    });
    it("acknowledges native-ineligible notices with only native subscriptions instead of perpetually retrying", async () => {
      fixtures.pending = [{ id: "new-appointment", recipientIdentifier: "9222222222", title: "New appointment", body: "New booking", url: "/user", mobilePushEligible: false }];
      fixtures.tokens = [{ id: "mobile", userIdentifier: "9222222222", token: "ExponentPushToken[test]" }];
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);
      await worker.POST(request());
      expect(fetchMock).not.toHaveBeenCalled();
      expect(fixtures.send).not.toHaveBeenCalled();
      expect(fixtures.mark).toHaveBeenCalledWith("new-appointment");
    });
    it("does not report missing VAPID for browser-ineligible events and retains existing native invitations", async () => {
      vi.stubEnv("WEB_PUSH_PRIVATE_KEY", "");
      fixtures.pending = [{ id: "owner-invitation", recipientIdentifier: "9222222222", title: "Appointment invitation", body: "Invitation created", url: "/user", webPushEligible: false }];
      fixtures.subscriptions = [{ id: "browser", userIdentifier: "9222222222", endpoint: "endpoint", keys: { auth: "auth", p256dh: "key" } }];
      fixtures.tokens = [{ id: "mobile", userIdentifier: "9222222222", token: "ExponentPushToken[test]" }];
      const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [{ status: "ok" }] })));
      vi.stubGlobal("fetch", fetchMock);
      const response = await worker.POST(request());
      expect(response.status).toBe(200);
      expect((await response.json()).errors).toEqual([]);
      expect(fetchMock).toHaveBeenCalledOnce();
      expect(fixtures.send).not.toHaveBeenCalled();
      expect(fixtures.mark).toHaveBeenCalledWith("owner-invitation");
    });
    it("acknowledges browser-ineligible owner invitation copies without sending browser pushes or suppressing native delivery", async () => {
      fixtures.pending = [{ id: "owner-invitation", recipientIdentifier: "9222222222", title: "Appointment invitation", body: "Invitation created", url: "/user", webPushEligible: false }];
      fixtures.subscriptions = [{ id: "browser", userIdentifier: "9222222222", endpoint: "endpoint", keys: { auth: "auth", p256dh: "key" } }];
      await worker.POST(request());
      expect(fixtures.send).not.toHaveBeenCalled();
      expect(fixtures.mark).toHaveBeenCalledWith("owner-invitation");
      fixtures.mark.mockClear();
      fixtures.tokens = [{ id: "mobile", userIdentifier: "9222222222", token: "ExponentPushToken[test]" }];
      const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [{ status: "ok" }] })));
      vi.stubGlobal("fetch", fetchMock);
      await worker.POST(request());
      expect(fetchMock).toHaveBeenCalledOnce();
      expect(JSON.parse(fetchMock.mock.calls[0][1].body)[0]).toMatchObject({ title: "Appointment invitation", body: "Invitation created" });
      expect(fixtures.send).not.toHaveBeenCalled();
      expect(fixtures.mark).toHaveBeenCalledWith("owner-invitation");
    });
    function schedule(phase: "confirmed" | "15min" | "start") {
      fixtures.pending = [];
      const startsAt = new Date(Date.now() + (phase === "start" ? -1000 : 60_000)).toISOString();
      const instanceKey = `poll:instance-2:${startsAt}`;
      fixtures.schedules = [{ kind: "poll", id: "instance-2", startsAt, endsAt: new Date(Date.now() + 3600_000).toISOString(), recipients: ["9222222222"] }];
      fixtures.intents = [{ key: `browser:${instanceKey}:9222222222:${phase}`, instanceKey, recipientIdentifier: "9222222222", kind: "poll", entityId: "instance-2", phase }];
      fixtures.subscriptions = ["first", "second"].map((id) => ({ id, userIdentifier: "9222222222", endpoint: id, keys: { auth: "auth", p256dh: "key" } }));
    }
    it.each(["confirmed", "15min", "start"] as const)("delivers private %s payloads and deduplicates per subscription", async (phase) => {
      schedule(phase);
      fixtures.send.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error("retry"));
      const failed = await worker.POST(request());
      expect(failed.status).toBe(503);
      fixtures.send.mockResolvedValueOnce({});
      await worker.POST(request());
      expect(fixtures.send).toHaveBeenCalledTimes(3);
      expect(fixtures.send.mock.calls[2][0].endpoint).toBe("second");
      expect(JSON.parse(fixtures.send.mock.calls[0][1])).toMatchObject({ body: "Sign in to view your scheduled activity.", data: { url: "/user?section=polls" } });
    });
    it("rechecks cancellations, reassignment, and expired instances before sending", async () => {
      schedule("start");
      fixtures.schedules[0].recipients = [];
      await worker.POST(request());
      expect(fixtures.send).not.toHaveBeenCalled();
      fixtures.schedules[0].recipients = ["9222222222"];
      fixtures.schedules[0].endsAt = new Date(Date.now() - 1).toISOString();
      await worker.POST(request());
      expect(fixtures.send).not.toHaveBeenCalled();
      fixtures.schedules = [];
      await worker.POST(request());
      expect(fixtures.send).not.toHaveBeenCalled();
    });
    it.each([404, 410])("removes HTTP %s endpoints without retrying them", async (statusCode) => {
      schedule("confirmed");
      fixtures.send.mockRejectedValueOnce({ statusCode }).mockResolvedValueOnce({});
      await worker.POST(request());
      expect(fixtures.remove).toHaveBeenCalledWith("first");
      await worker.POST(request());
      expect(fixtures.send).toHaveBeenCalledTimes(2);
    });
    it("uses a safe URL for malicious appointment links", async () => {
      fixtures.pending = [{ id: "unsafe", recipientIdentifier: "9222222222", title: "Private name", body: "Private address", url: "//attacker.invalid" }];
      fixtures.subscriptions = [{ id: "browser", userIdentifier: "9222222222", endpoint: "endpoint", keys: { auth: "auth", p256dh: "key" } }];
      fixtures.send.mockResolvedValue({});
      await worker.POST(request());
      expect(JSON.parse(fixtures.send.mock.calls[0][1])).toMatchObject({ data: { url: "/user" } });
      expect(fixtures.send.mock.calls[0][1]).not.toContain("Private");
    });
  });
});