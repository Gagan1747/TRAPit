import { describe, expect, it, vi } from "vitest";
import { createRefreshQueue } from "../../../apps/web/lib/refresh-queue";

describe("workspace refresh queue", () => {
  it("runs only one request batch at a time and keeps the latest trailing refresh", async () => {
    const refresh = createRefreshQueue();
    let release = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const first = vi.fn(async () => { await gate; });
    const replaced = vi.fn(async () => {});
    const latest = vi.fn(async () => {});
    const active = refresh(first);
    expect(refresh(replaced)).toBe(active);
    expect(refresh(latest)).toBe(active);
    await Promise.resolve();
    expect(first).toHaveBeenCalledOnce();
    expect(latest).not.toHaveBeenCalled();
    release();
    await active;
    expect(replaced).not.toHaveBeenCalled();
    expect(latest).toHaveBeenCalledOnce();
  });

  it("does not lose an update arriving during the trailing refresh", async () => {
    const refresh = createRefreshQueue();
    const final = vi.fn(async () => {});
    const trailing = vi.fn(async () => { refresh(final); });
    await refresh(async () => { refresh(trailing); });
    expect(trailing).toHaveBeenCalledOnce();
    expect(final).toHaveBeenCalledOnce();
  });

  it("propagates errors and allows the next refresh to retry", async () => {
    const refresh = createRefreshQueue();
    const error = new Error("Network failure");
    await expect(refresh(async () => { throw error; })).rejects.toBe(error);
    const retry = vi.fn(async () => {});
    await refresh(retry);
    expect(retry).toHaveBeenCalledOnce();
  });
});
