import { beforeEach, describe, expect, it, vi } from "vitest";

const fixtures = vi.hoisted(() => ({ actor: null as null | { sub: string; identifier?: string }, getResults: vi.fn() }));
vi.mock("next/server", () => ({ NextResponse: { json: (body: unknown, init?: ResponseInit) => new Response(JSON.stringify(body), init) } }));
vi.mock("../../../apps/web/lib/workspace-actor", () => ({ getWorkspaceActor: async () => fixtures.actor }));
vi.mock("../../../apps/web/lib/testing-store", () => ({ getTestResults: fixtures.getResults }));
const { GET } = await import("../../../apps/web/app/api/test-results/[testId]/route");
const request = () => new Request("https://trapit.in/api/test-results/test-1?participantId=another-person");

beforeEach(() => {
  vi.clearAllMocks();
  fixtures.actor = { sub: "actor", identifier: "+919111111111" };
  fixtures.getResults.mockResolvedValue({ participants: [] });
});

describe("test results API identity", () => {
  it("requires signed-in access", async () => {
    fixtures.actor = null;
    expect((await GET(request(), { params: { testId: "test-1" } })).status).toBe(403);
    expect(fixtures.getResults).not.toHaveBeenCalled();
  });

  it.each(["+919111111111", undefined])("never accepts query-selected participant identity (%s)", async (identifier) => {
    fixtures.actor = { sub: "actor", identifier };
    expect((await GET(request(), { params: { testId: "test-1" } })).status).toBe(200);
    expect(fixtures.getResults).toHaveBeenCalledWith({ actorId: "actor", participantIdentifier: identifier ?? "", testId: "test-1" });
  });
});
