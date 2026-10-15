import { afterEach, describe, expect, it, vi } from "vitest";

const fixtures = vi.hoisted(() => ({ listener: null as ((event: { scope: string; timestamp: string }) => void) | null, unsubscribe: vi.fn() }));
vi.mock("../../../apps/web/lib/realtime-events", () => ({
  subscribeWorkspaceEvents: (listener: typeof fixtures.listener) => {
    fixtures.listener = listener;
    return fixtures.unsubscribe;
  },
}));

const { GET } = await import("../../../apps/web/app/api/internal/events/route");

afterEach(() => {
  vi.useRealTimers();
  fixtures.listener = null;
  fixtures.unsubscribe.mockClear();
});

describe("workspace event stream lifecycle", () => {
  it("marks the legacy initial refresh and disables proxy buffering", async () => {
    const controller = new AbortController();
    const response = await GET(new Request("https://trapit.in/api/internal/events", { signal: controller.signal }));
    expect(response.headers.get("x-accel-buffering")).toBe("no");
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    expect(decoder.decode((await reader.read()).value)).toContain("event: ready");
    expect(decoder.decode((await reader.read()).value)).toContain('"initial":true');
    fixtures.listener!({ scope: "apportion", timestamp: "now" });
    expect(decoder.decode((await reader.read()).value)).toContain('"scope":"apportion"');
    controller.abort();
    expect((await reader.read()).done).toBe(true);
    expect(fixtures.unsubscribe).toHaveBeenCalledOnce();
  });

  it("cleans up exactly once when an expired stream is later aborted", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    await GET(new Request("https://trapit.in/api/internal/events", { signal: controller.signal }));
    vi.advanceTimersByTime(10 * 60 * 1000);
    expect(() => controller.abort()).not.toThrow();
    expect(fixtures.unsubscribe).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cleans up subscriptions and timers when the response is cancelled", async () => {
    vi.useFakeTimers();
    const response = await GET(new Request("https://trapit.in/api/internal/events"));
    await response.body!.cancel();
    expect(fixtures.unsubscribe).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    expect(() => fixtures.listener!({ scope: "all", timestamp: "later" })).not.toThrow();
  });
});
