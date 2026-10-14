import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerBrowserPush } from "../../../apps/web/components/browser-push-prompt";

const subscription = { toJSON: () => ({ endpoint: "https://push.example.test/subscription" }), unsubscribe: vi.fn() };
const getSubscription = vi.fn();
const subscribe = vi.fn();
const post = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  subscription.unsubscribe.mockResolvedValue(true);
  getSubscription.mockResolvedValue(subscription);
  subscribe.mockResolvedValue(subscription);
  post.mockResolvedValue(new Response("{}", { status: 200 }));
  vi.stubGlobal("navigator", { serviceWorker: { register: vi.fn(async () => ({ active: {}, pushManager: { getSubscription, subscribe } })) } });
  vi.stubGlobal("Notification", { permission: "granted" });
  vi.stubGlobal("window", { atob });
  vi.stubGlobal("fetch", post);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("browser notification subscription binding", () => {
  it("reuses the device subscription but posts each requested session binding", async () => {
    await registerBrowserPush("dGVzdA");
    await registerBrowserPush("dGVzdA");
    expect(subscribe).not.toHaveBeenCalled();
    expect(post).toHaveBeenCalledTimes(2);
    expect(post).toHaveBeenCalledWith("/api/user/web-push-subscriptions", expect.objectContaining({ method: "POST" }));
  });
  it("creates a subscription when none exists", async () => {
    getSubscription.mockResolvedValueOnce(null);
    await registerBrowserPush("dGVzdA");
    expect(subscribe).toHaveBeenCalledWith(expect.objectContaining({ userVisibleOnly: true, applicationServerKey: new Uint8Array([116, 101, 115, 116]) }));
  });
  it("gives denied permission instructions without invoking the browser subscription prompt", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("Notification", { permission: "denied" });
    await expect(registerBrowserPush("dGVzdA")).rejects.toThrow("browser's site settings");
    expect(navigator.serviceWorker.register).not.toHaveBeenCalled();
    expect(subscribe).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
  });
  it("waits for an active service worker before subscribing", async () => {
    let ready!: (value: unknown) => void;
    const pendingRegistration = { active: null, pushManager: { getSubscription, subscribe } };
    vi.stubGlobal("navigator", { serviceWorker: {
      register: vi.fn(async () => pendingRegistration),
      ready: new Promise((resolve) => { ready = resolve; }),
    } });
    const operation = registerBrowserPush("dGVzdA");
    await vi.waitFor(() => expect(navigator.serviceWorker.register).toHaveBeenCalledWith("/sw.js", { scope: "/", updateViaCache: "none" }));
    expect(getSubscription).not.toHaveBeenCalled();
    ready({ ...pendingRegistration, active: {} });
    await operation;
    expect(post).toHaveBeenCalledOnce();
  });
  it("surfaces registration failures with actionable feedback", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(navigator.serviceWorker.register).mockRejectedValueOnce(new Error("Worker script unavailable"));
    await expect(registerBrowserPush("dGVzdA")).rejects.toThrow("Unable to start browser notifications. Worker script unavailable");
    expect(post).not.toHaveBeenCalled();
  });
  it("times out an inactive worker with dashboard retry instructions", async () => {
    vi.useFakeTimers();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("navigator", { serviceWorker: {
      register: vi.fn(async () => ({ active: null })),
      ready: new Promise(() => {}),
    } });
    const rejection = expect(registerBrowserPush("dGVzdA")).rejects.toThrow("Reload this dashboard and retry");
    await vi.advanceTimersByTimeAsync(15_000);
    await rejection;
    expect(post).not.toHaveBeenCalled();
  });
  it("detaches failed account bindings and surfaces the server error", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    post.mockResolvedValueOnce(new Response('{"error":"Registration unavailable"}', { status: 503 }));
    await expect(registerBrowserPush("dGVzdA")).rejects.toThrow("Registration unavailable");
    expect(subscription.unsubscribe).toHaveBeenCalledOnce();
    expect(log).toHaveBeenCalled();
    await registerBrowserPush("dGVzdA");
    expect(post).toHaveBeenCalledTimes(2);
  });
  it("serializes overlapping requests without skipping the later account binding", async () => {
    let release!: (response: Response) => void;
    post.mockImplementationOnce(() => new Promise<Response>((resolve) => { release = resolve; }));
    const first = registerBrowserPush("dGVzdA");
    const second = registerBrowserPush("dGVzdA");
    await vi.waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    release(new Response("{}", { status: 200 }));
    await Promise.all([first, second]);
    expect(post).toHaveBeenCalledTimes(2);
  });
});
