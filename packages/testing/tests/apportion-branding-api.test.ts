import { beforeEach, describe, expect, it, vi } from "vitest";
import { normalizeWorkspaceBranding } from "../src/quiz";

const fixtures = vi.hoisted(() => ({ prepare: vi.fn(), mutate: vi.fn(), updatePanel: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({ NextResponse: { json: (body: unknown, init?: ResponseInit) => new Response(JSON.stringify(body), { status: init?.status ?? 200, headers: { "Content-Type": "application/json" } }) } }));
vi.mock("../../../apps/web/lib/workspace-actor", () => ({ getWorkspaceActor: async () => ({ identifier: "+919111111111", sub: "owner" }) }));
vi.mock("../../../apps/web/lib/apportion-directory", () => ({
  ApportionDirectoryError: class extends Error { constructor(message: string, public status = 400) { super(message); } },
  prepareApportionBrandingMutation: fixtures.prepare,
  getApportionPanel: async () => ({ businesses: [], providerSettings: {} }),
  updateApportionPanel: fixtures.updatePanel,
}));
vi.mock("../../../apps/web/lib/testing-store", () => ({
  getWorkspaceBranding: async () => null,
  withSerializedTestingMutation: async (operation: (state: object) => Promise<unknown>) => operation({}),
  mutateWorkspaceBrandingState: fixtures.mutate,
}));
const brandingApi = await import("../../../apps/web/app/api/admin/branding/route");
const businessApi = await import("../../../apps/web/app/api/user/apportion/business/route");
const request = (body: string) => new Request("https://trapit.in/api/admin/branding", { method: "POST", body });
const branding = () => normalizeWorkspaceBranding({ instituteName: "Clinic", appointmentsPerSlot: 1, slotDurationMinutes: 1440, justAddToList: true, appointmentLocations: [{ id: "location-1", name: "Main", address: "Street", workingDays: "Monday", workingHours: "9:00 AM - 9:00 AM", workingHoursSecondWindow: "" }] } as never)!;
beforeEach(() => {
  vi.clearAllMocks();
  fixtures.prepare.mockImplementation(async (_state, input) => input);
  fixtures.mutate.mockImplementation((_state, input) => input);
});

describe("branding API payload and settings contracts", () => {
  it.each(["{", "null", "[]", "42", "{}", '{"branding":42}', '{"branding":null,"updateProviderSettings":"true"}'])("rejects invalid branding body %s without mutation", async (body) => {
    const response = await brandingApi.POST(request(body));
    expect(response.status).toBe(400);
    expect(await response.json()).toHaveProperty("error");
    expect(fixtures.prepare).not.toHaveBeenCalled();
  });
  it.each([{ appointmentsPerSlot: "2" }, { justAddToList: 1 }, { promotionalImageDataUrls: [42] }, { appointmentLocations: [null] }, { appointmentDateOverrides: { closedDateKeys: [42], openedDateKeys: [] } }, { appointmentWeeklyHoursOverrides: [{ weekday: "1", locations: [] }] }])("rejects incorrectly typed branding fields %j", async (fields) => {
    expect((await brandingApi.POST(request(JSON.stringify({ branding: { ...branding(), ...fields } })))).status).toBe(400);
    expect(fixtures.prepare).not.toHaveBeenCalled();
  });
  it.each([undefined, false, true])("passes explicit settings intent %s through the serialized preparation", async (updateProviderSettings) => {
    const input = { ...branding(), slotDurationMinutes: 1440 };
    const response = await brandingApi.POST(request(JSON.stringify({ branding: input, updateProviderSettings })));
    expect(await response.clone().json()).not.toHaveProperty("error");
    expect(response.status).toBe(200);
     expect(fixtures.prepare).toHaveBeenCalledWith({}, input, "+919111111111", updateProviderSettings === true, expect.objectContaining({ identifier: "+919111111111", sub: "owner" }));
  });
  it("allows an explicit null clear payload", async () => {
    expect((await brandingApi.POST(request('{"branding":null}'))).status).toBe(200);
  });
  it.each(["{", "null", "[]", "42", '{"operation":"set-settings","ownerIdentifier":42}', '{"operation":"set-settings","ownerIdentifier":" "}', '{"operation":"business-branding","updateProviderSettings":1}'])("rejects invalid business mutation body %s", async (body) => {
    const response = await businessApi.PATCH(request(body));
    expect(response.status).toBe(400);
    expect(await response.json()).toHaveProperty("error");
    expect(fixtures.updatePanel).not.toHaveBeenCalled();
  });
});