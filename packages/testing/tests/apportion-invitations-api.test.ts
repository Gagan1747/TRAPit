import { beforeEach, describe, expect, it, vi } from "vitest";

const fixtures = vi.hoisted(() => ({ actor: { identifier: "+919444444444" } as { identifier: string } | null,
  list: vi.fn(), respond: vi.fn(), publish: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({ NextResponse: { json: (body: unknown, init?: ResponseInit) => new Response(JSON.stringify(body), { status: init?.status || 200 }) } }));
vi.mock("../../../apps/web/lib/workspace-actor", () => ({ getWorkspaceActor: async () => fixtures.actor }));
vi.mock("../../../apps/web/lib/realtime-events", () => ({ publishWorkspaceEvent: fixtures.publish }));
vi.mock("../../../apps/web/lib/apportion-store", () => ({
  listApportionInvitationsForActor: fixtures.list, respondToApportionInvitation: fixtures.respond,
  ApportionInvitationError: class extends Error { constructor(message: string, public readonly status: 400 | 403 = 400) { super(message); } },
}));
const route = await import("../../../apps/web/app/api/user/apportion/invitations/route");
const { ApportionInvitationError } = await import("../../../apps/web/lib/apportion-store");
function request(body: unknown = { invitationId: "invite-1", action: "accept" }) {
  return new Request("https://trapit.in/api/user/apportion/invitations", { method: "PATCH", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });
}
beforeEach(() => {
  vi.clearAllMocks();
  fixtures.actor = { identifier: "+919444444444" };
  fixtures.list.mockReset().mockResolvedValue([{ id: "invite-1", status: "pending" }]);
  fixtures.respond.mockReset().mockResolvedValue({ appointmentIds: ["appointment-1"] });
});

describe("invitation acceptance API", () => {
  it("requires authenticated identifiers for both GET and PATCH", async () => {
    fixtures.actor = null;
    expect((await route.GET(request())).status).toBe(403);
    expect((await route.PATCH(request())).status).toBe(403);
    expect(fixtures.list).not.toHaveBeenCalled();
    expect(fixtures.respond).not.toHaveBeenCalled();
  });
  it("lists the authenticated actor's invitations only", async () => {
    const response = await route.GET(request());
    expect(await response.json()).toEqual({ invitations: [{ id: "invite-1", status: "pending" }] });
    expect(fixtures.list).toHaveBeenCalledWith(fixtures.actor!.identifier);
  });
  it.each(["accept", "decline", "cancel"])("responds to %s using authenticated identity and publishes apportion", async (action) => {
    fixtures.list.mockResolvedValue([{ id: "invite-1", status: action === "accept" ? "accepted" : action === "decline" ? "declined" : "cancelled" }]);
    const response = await route.PATCH(request({ invitationId: " invite-1 ", action, actorIdentifier: "spoofed-owner" }));
    expect(response.status).toBe(200);
    expect(fixtures.respond).toHaveBeenCalledWith({ invitationId: "invite-1", action, actorIdentifier: fixtures.actor!.identifier });
    expect(fixtures.publish).toHaveBeenCalledOnce();
    expect(fixtures.publish).toHaveBeenCalledWith("apportion");
    expect(await response.json()).toEqual({ invitations: await fixtures.list(), appointmentIds: ["appointment-1"] });
  });
  it.each([null, [], {}, { invitationId: 7, action: "accept" }, { invitationId: " ", action: "accept" }, { invitationId: "invite-1", action: "done" }])("rejects invalid request %j before mutation", async (body) => {
    expect((await route.PATCH(request(body))).status).toBe(400);
    expect(fixtures.respond).not.toHaveBeenCalled();
    expect(fixtures.publish).not.toHaveBeenCalled();
  });
  it("rejects malformed JSON before mutation", async () => {
    const response = await route.PATCH(new Request("https://trapit.in/api/user/apportion/invitations", { method: "PATCH", body: "{" }));
    expect(response.status).toBe(400);
    expect(fixtures.respond).not.toHaveBeenCalled();
  });
  it.each([400, 403] as const)("preserves store error status %s without publishing", async (status) => {
    fixtures.respond.mockRejectedValue(new ApportionInvitationError("Rejected invitation action", status));
    const response = await route.PATCH(request());
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error: "Rejected invitation action" });
    expect(fixtures.publish).not.toHaveBeenCalled();
  });
  it("maps unavailable capacity and schedule failures to 400", async () => {
    fixtures.respond.mockRejectedValue(new Error("This appointment slot is already full."));
    expect((await route.PATCH(request())).status).toBe(400);
    expect(fixtures.publish).not.toHaveBeenCalled();
  });
});