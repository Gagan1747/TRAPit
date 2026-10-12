import { afterEach, describe, expect, it, vi } from "vitest";
import { readJsonResponse } from "../../../apps/web/lib/read-json-response";

afterEach(() => vi.restoreAllMocks());

describe("Business Panel response errors", () => {
  it("reports HTML upload rejection without parsing HTML as JSON", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(readJsonResponse(new Response("<html>too large</html>", { status: 413, headers: { "Content-Type": "text/html" } }))).rejects.toThrow("request limit");
    expect(log).toHaveBeenCalledOnce();
  });
  it("surfaces JSON validation errors and preserves successful payloads", async () => {
    await expect(readJsonResponse(Response.json({ error: "Invalid image" }, { status: 400 }))).rejects.toThrow("Invalid image");
    expect(await readJsonResponse(Response.json({ saved: true }))).toEqual({ saved: true });
  });
  it("does not treat an HTML success response as a successful save", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(readJsonResponse(new Response("<html>sign in</html>", { headers: { "Content-Type": "text/html" } }))).rejects.toThrow("not confirmed");
  });
});
