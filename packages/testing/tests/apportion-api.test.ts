import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { normalizeWorkspaceBranding } from "../src/quiz";
import { validateAppointmentLocations } from "../../../apps/web/lib/appointment-locations";

const fixtures = vi.hoisted(() => ({
  actor: { identifier: "+919222222222", userCategory: "trapit-normal" },
  authConfigured: true,
  registeredUsers: [{ identifier: "+919333333333", label: "Registered Name" }],
  appointments: [] as Array<Record<string, unknown>>,
  invitations: [] as Array<Record<string, unknown>>,
  invitationList: vi.fn(async (_identifier: string) => [] as Array<Record<string, unknown>>),
  invite: vi.fn(async (_input: Record<string, unknown>) => ({ id: "invitation", status: "pending" })),
  context: null as import("../../../apps/web/lib/apportion-directory").ApportionBusinessContext | null,
  personalContext: null as import("../../../apps/web/lib/apportion-directory").ApportionBusinessContext | null,
  linkedBusinessOwnerIdentifier: "+919111111111",
  linkedBusinessBranding: null as ReturnType<typeof normalizeWorkspaceBranding> | null,
  directServices: [] as Array<{ ownerIdentifier: string; id: string; name: string; businessName: string; locationIds: string[] }>,
  panel: { businesses: [] as Array<{ role: string; ownerCategory: string }> },
  scheduleNotifications: [] as Array<Record<string, unknown>>,
  share: vi.fn(async () => "SHARE"), counts: vi.fn(async (_ownerIdentifier?: string, _locationId?: string, _serviceId?: string) => [] as Array<{ count: number; locationId: string; startsAt: string }>), update: vi.fn(async () => ({ appointment: {}, nextInPersonAppointment: null })), create: vi.fn(async () => ({ id: "booked" })),
}));
vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({ NextResponse: { json: (body: unknown, init?: ResponseInit) => new Response(JSON.stringify(body), { status: init?.status || 200, headers: { "Content-Type": "application/json" } }) } }));
vi.mock("../../../apps/web/lib/workspace-actor", () => ({ getWorkspaceActor: async () => fixtures.actor }));
vi.mock("../../../apps/web/lib/auth-config", () => ({ isWebAuthConfigured: () => fixtures.authConfigured }));
vi.mock("../../../apps/web/lib/cognito", () => ({ listRegisteredDirectoryUsers: async () => fixtures.registeredUsers }));
vi.mock("../../../apps/web/lib/apportion-directory", () => ({ getApportionPanel: async () => fixtures.panel, getApportionBusinessContext: vi.fn(async (ownerIdentifier: string) => ownerIdentifier === OWNER ? fixtures.context : ownerIdentifier === STAFF ? fixtures.personalContext : null), listApportionDirectLinkServices: async () => fixtures.directServices, assertApportionHoursWithinMaster: vi.fn(), listApportionScheduleNotificationsForActor: async () => fixtures.scheduleNotifications }));
vi.mock("../../../apps/web/lib/realtime-events", () => ({ publishWorkspaceEvent: vi.fn() }));
vi.mock("../../../apps/web/lib/session", () => ({ getWebSession: async () => ({ phoneNumber: fixtures.actor.identifier, displayName: "Requester" }) }));
vi.mock("../../../apps/web/lib/testing-store", () => ({ getOrCreateWorkspaceAppointmentShareCode: fixtures.share, listWorkspaceAppointmentBusinesses: async () => [], listParticipants: async () => fixtures.registeredUsers, getWorkspaceBranding: async () => fixtures.context?.branding, getWorkspaceBrandingByAppointmentShareCode: async () => ({ ownerIdentifier: fixtures.linkedBusinessOwnerIdentifier, branding: fixtures.linkedBusinessBranding ?? fixtures.context?.branding }) }));
vi.mock("../../../apps/web/lib/apportion-store", () => ({
  createApportionInvitation: fixtures.invite,
  listApportionInvitationsForActor: fixtures.invitationList,
  listApportionAppointmentsForActor: async () => fixtures.appointments,
  listApportionAppointmentsForRequester: async () => fixtures.appointments,
  listApportionAppointmentsForOwner: async () => fixtures.appointments,
  listApportionNotificationsForActor: async () => [{ id: "notice", title: "Address unavailable", recipientIdentifier: fixtures.actor.identifier, createdAt: "2026-10-03T09:00:00Z" }],
  listApportionSlotCounts: fixtures.counts,
  updateApportionAppointment: fixtures.update,
  cancelApportionAppointment: vi.fn(), createApportionAppointment: fixtures.create,
}));

const dashboard = await import("../../../apps/web/app/api/user/apportion/route");
const directoryApi = await import("../../../apps/web/lib/apportion-directory");
const publicApi = await import("../../../apps/web/app/api/apportion/[shareCode]/route");
const OWNER = "+919111111111";
const STAFF = "+919222222222";
beforeEach(() => {
  vi.clearAllMocks();
  fixtures.actor = { identifier: STAFF, userCategory: "trapit-normal" };
  fixtures.authConfigured = true;
  fixtures.registeredUsers = [{ identifier: "+919333333333", label: "Registered Name" }];
  fixtures.invite.mockReset().mockResolvedValue({ id: "invitation", status: "pending" });
  fixtures.appointments = [];
  fixtures.invitations = [];
  fixtures.invitationList.mockImplementation(async () => fixtures.invitations);
  fixtures.scheduleNotifications = [];
  fixtures.linkedBusinessOwnerIdentifier = OWNER;
  fixtures.linkedBusinessBranding = null;
  fixtures.personalContext = null;
  fixtures.directServices = [
    { ownerIdentifier: OWNER, id: "consultation", name: "Consultation", businessName: "Clinic", locationIds: ["location-1"] },
    { ownerIdentifier: OWNER, id: "therapy", name: "Therapy", businessName: "Clinic", locationIds: ["location-1"] },
  ];
  fixtures.panel = { businesses: [] };
  fixtures.context = {
    business: { ownerIdentifier: OWNER, adminDelegateIdentifier: null, services: [{ id: "consultation", name: "Consultation", active: true, assignedIdentifier: OWNER, locationIds: ["location-1"] }, { id: "therapy", name: "Therapy", active: true, assignedIdentifier: STAFF, locationIds: ["location-1"] }] },
    ownerCategory: "trapit-pro",
    branding: normalizeWorkspaceBranding({ instituteName: "Clinic", appointmentLocations: [{ id: "location-1", name: "Main", address: "Street", workingDays: "Monday", workingHours: "9:00 AM - 5:00 PM", workingHoursSecondWindow: "" }] } as never)!,
    providerSettings: { [OWNER]: { appointmentsPerSlot: 1, justAddToList: true, slotDurationMinutes: 10 }, [STAFF]: { appointmentsPerSlot: 3, justAddToList: false, slotDurationMinutes: 30 } },
    memberships: [{ ownerIdentifier: OWNER, providerIdentifier: STAFF, locationId: "location-1", workingDays: "Monday", workingHours: "10:00 AM - 12:00 PM", workingHoursSecondWindow: "", closedDateKeys: [] }],
  };
});

describe("Apportion API role and service contracts", () => {
  it("loads each owner's context once for a large dashboard including missing contexts", async () => {
    fixtures.appointments = Array.from({ length: 297 }, (_, index) => ({
      id: `appointment-${index}`,
      ownerIdentifier: index < 200 ? OWNER : STAFF,
      requesterIdentifier: STAFF,
      locationId: "location-1",
      serviceId: "therapy",
      justAddToList: false,
    }));
    const payload = await (await dashboard.GET(new Request("https://trapit.in/api/user/apportion"))).json();
    expect(directoryApi.getApportionBusinessContext).toHaveBeenCalledTimes(2);
    expect(Object.keys(payload.appointmentOperatingHoursById)).toHaveLength(297);
    expect(payload.appointmentOperatingHoursById["appointment-0"].workingHours).toBe("10:00 AM - 12:00 PM");
    expect(payload.appointmentOperatingHoursById["appointment-296"].workingHours).toBe("");
  });
  it.each([OWNER, STAFF, "+919444444444"])("projects invitation capability only for the canonical owner %s", async (identifier) => {
    fixtures.actor.identifier = identifier;
    fixtures.context!.business.adminDelegateIdentifier = "+919444444444";
    const payload = await (await publicApi.GET(new Request("https://trapit.in/api/apportion/SHARE"), { params: { shareCode: "SHARE" } })).json();
    expect(payload.viewerIdentifier).toBe(identifier);
    expect(payload.canInvite).toBe(identifier === OWNER);
    expect(payload.business).toMatchObject({ canInvite: identifier === OWNER, recurringBookingsEnabled: identifier === OWNER, recurringBookingLimit: identifier === OWNER ? 6 : null });
    expect(payload.addressOptions[0].contexts[0].business.canInvite).toBe(identifier === OWNER);
    fixtures.linkedBusinessOwnerIdentifier = STAFF;
    const linked = await (await publicApi.GET(new Request(`https://trapit.in/api/apportion/STAFF?ownerIdentifier=${encodeURIComponent(OWNER)}&serviceId=therapy`), { params: { shareCode: "STAFF" } })).json();
    expect(linked.canInvite).toBe(false);
    expect(linked.business.recurringBookingsEnabled).toBe(false);
  });
  it("restricts public lookup to the owner and returns only full registered identities", async () => {
    const lookup = (phone: string) => publicApi.GET(new Request(`https://trapit.in/api/apportion/SHARE?lookupPhone=${encodeURIComponent(phone)}&ownerIdentifier=${encodeURIComponent(OWNER)}&serviceId=therapy`), { params: { shareCode: "SHARE" } });
    expect((await lookup("9333333333")).status).toBe(403);
    fixtures.actor.identifier = OWNER;
    expect(await (await lookup("+91 (93333) 33333")).json()).toEqual({ user: { identifier: "+919333333333", name: "Registered Name" } });
    expect((await lookup("333")).status).toBe(400);
    expect((await lookup("9444444444")).status).toBe(404);
    fixtures.linkedBusinessOwnerIdentifier = STAFF;
    expect((await lookup("9333333333")).status).toBe(403);
  });
  it("includes actor-scoped invitations in the dashboard", async () => {
    fixtures.invitations = [{ id: "pending", status: "pending" }];
    const payload = await (await dashboard.GET(new Request("https://trapit.in/api/user/apportion"))).json();
    expect(payload.invitations).toEqual(fixtures.invitations);
    expect(fixtures.invitationList).toHaveBeenCalledWith(STAFF);
  });
  it("allows overlapping master address schedules for independently assigned providers", () => {
    const location = { id: "location-1", name: "Main", address: "Street", workingDays: "Monday", workingHours: "9:00 AM - 5:00 PM", workingHoursSecondWindow: "" };
    expect(() => validateAppointmentLocations([location, { ...location, id: "location-2", name: "Second" }])).not.toThrow();
  });
  it("does not apply owner leave to an unassigned service or expose it as provider leave", async () => {
    fixtures.context!.business.services[1].assignedIdentifier = null;
    const now = new Date(Date.now() + 330 * 60_000);
    now.setUTCDate(now.getUTCDate() + 1);
    while (now.getUTCDay() !== 1) now.setUTCDate(now.getUTCDate() + 1);
    const dateKey = now.toISOString().slice(0, 10);
    fixtures.context!.providerClosedDateKeys = { [OWNER]: [dateKey] };

    const payload = await (await publicApi.GET(
      new Request("https://trapit.in/api/apportion/SHARE?serviceId=therapy"),
      { params: { shareCode: "SHARE" } },
    )).json();
    expect(payload.business.providerClosedDateKeys).toEqual([]);

    const response = await publicApi.POST(new Request("https://trapit.in/api/apportion/SHARE", {
      method: "POST",
      body: JSON.stringify({ serviceId: "therapy", locationId: "location-1", slotDateKey: dateKey, startsAt: `${dateKey}T04:30:00.000Z` }),
    }), { params: { shareCode: "SHARE" } });
    expect(response.status).toBe(200);
    expect(fixtures.create).toHaveBeenCalledWith(expect.objectContaining({ serviceId: "therapy", serviceDateKey: dateKey }));

    fixtures.appointments = [{
      id: "unassigned-reschedule",
      ownerIdentifier: OWNER,
      requesterIdentifier: STAFF,
      locationId: "location-1",
      serviceId: "therapy",
      bookedSettings: { justAddToList: false, appointmentsPerSlot: 1, slotDurationMinutes: 30 },
    }];
    const rescheduleResponse = await dashboard.PATCH(new Request("https://trapit.in/api/user/apportion", {
      method: "PATCH",
      body: JSON.stringify({ action: "reschedule", appointmentId: "unassigned-reschedule", nextServiceDateKey: dateKey, nextStartsAt: `${dateKey}T04:30:00.000Z` }),
    }));
    expect(rescheduleResponse.status).toBe(200);
    expect(fixtures.update).toHaveBeenCalledWith(expect.objectContaining({ appointmentId: "unassigned-reschedule" }));
  });
  it.each(["{", "null", "[]", "42", '{"ownerIdentifier":42}', '{"targetPhone":42}', '{"serviceId":42}', '{"locationId":42}', '{"notes":42}', '{"recurrence":{"mode":"weekly","weekdayKeys":[42]}}', '{"recurrence":{"mode":"monthly","endDateKey":"2026-12-31","monthDays":[1.5]}}', '{"recurrence":{"mode":"monthly","endDateKey":"2026-12-31","monthDays":[32]}}'])("returns JSON 400 before public params access for invalid body %s", async (body) => {
    const params = { get shareCode(): string { throw new Error("Params must not be accessed"); } };
    const response = await publicApi.POST(new Request("https://trapit.in/api/apportion/SHARE", { method: "POST", body }), { params });
    expect(response.status).toBe(400);
    expect(await response.json()).toHaveProperty("error");
    expect(fixtures.create).not.toHaveBeenCalled();
    expect(fixtures.invite).not.toHaveBeenCalled();
  });
  it.each(["{", "null", "[]", "42", '{"appointmentId":42}', '{"appointmentId":"id","action":"done","notes":42}', '{"appointmentId":"id","action":"reschedule","nextStartsAt":42}', '{"appointmentId":"id","action":"send-message","message":42}'])("rejects invalid dashboard mutation body %s", async (body) => {
    const request = (method: string) => new Request("https://trapit.in/api/user/apportion", { method, body });
    const response = await dashboard.PATCH(request("PATCH"));
    expect(response.status).toBe(400);
    expect(await response.json()).toHaveProperty("error");
    if (!body.includes('"appointmentId":"id"')) expect((await dashboard.DELETE(request("DELETE"))).status).toBe(400);
    expect(fixtures.update).not.toHaveBeenCalled();
  });
  it("routes authenticated message requests through the store without accepting a client author", async () => {
    const response = await dashboard.PATCH(new Request("https://trapit.in/api/user/apportion", {
      method: "PATCH",
      body: JSON.stringify({ action: "send-message", appointmentId: "message-id", message: "Hello", authorIdentifier: OWNER }),
    }));
    expect(response.status).toBe(200);
    expect(fixtures.update).toHaveBeenCalledWith(expect.objectContaining({ action: "send-message", actorIdentifier: STAFF, appointmentId: "message-id", message: "Hello" }));
    expect(fixtures.update.mock.calls[0][0]).not.toHaveProperty("authorIdentifier");
  });
  it("returns historical staff entries and server canManage without generating a Free share code", async () => {
    fixtures.appointments = [{ id: "history", ownerIdentifier: OWNER, requesterIdentifier: "+919444444444", assignedStaffIdentifier: STAFF, canManage: false, startsAt: "2027-01-04T04:30:00Z" }];
    const result = await (await dashboard.GET(new Request("https://trapit.in/api/user/apportion"))).json();
    expect(result.ownerAppointments).toEqual(fixtures.appointments);
    expect(result.appointments[0].canManage).toBe(false);
    expect(result.requesterAppointments).toEqual([]);
    expect(result.appointmentShareCode).toBeNull();
    expect(fixtures.share).not.toHaveBeenCalled();
  });
  it("keeps staff self-bookings in both received and booked logs", async () => {
    fixtures.appointments = [{ id: "self", ownerIdentifier: OWNER, requesterIdentifier: STAFF, assignedStaffIdentifier: STAFF, canManage: true }];
    const result = await (await dashboard.GET(new Request("https://trapit.in/api/user/apportion"))).json();
    expect(result.ownerAppointments).toHaveLength(1);
    expect(result.requesterAppointments).toHaveLength(1);
  });
  it("restricts exact-phone lookup and returns only a matched registered name", async () => {
    const request = new Request("https://trapit.in/api/user/apportion?lookupPhone=9333333333");
    expect((await dashboard.GET(request)).status).toBe(403);
    fixtures.panel.businesses = [{ role: "admin", ownerCategory: "trapit-pro" }];
    expect(await (await dashboard.GET(request)).json()).toEqual({ user: { identifier: "+919333333333", name: "Registered Name" } });
    expect((await dashboard.GET(new Request("https://trapit.in/api/user/apportion?lookupPhone=333"))).status).toBe(400);
  });
  it("selects provider settings and service-scoped queues/counts", async () => {
    fixtures.appointments = [{ serviceId: "therapy", locationId: "location-1", serviceDateKey: "2027-01-04", currentStatus: "pending" }, { serviceId: "consultation", locationId: "location-1", serviceDateKey: "2027-01-04", currentStatus: "pending" }];
    const result = await (await publicApi.GET(new Request("https://trapit.in/api/apportion/SHARE?serviceId=therapy"), { params: { shareCode: "SHARE" } })).json();
    expect(result.business).toMatchObject({ serviceId: "therapy", appointmentsPerSlot: 3, justAddToList: false, slotDurationMinutes: 30 });
    expect(result.business.locations[0].workingHours).toBe("10:00 AM - 12:00 PM");
    expect(result.queueCounts).toEqual([{ locationId: "location-1", dateKey: "2027-01-04", count: 1 }]);
    expect(fixtures.counts).toHaveBeenCalledWith(OWNER, undefined, "therapy");
  });
  it("routes staff direct-link bookings through the canonical owner's assigned service", async () => {
    const date = new Date(Date.now() + 330 * 60_000);
    date.setUTCDate(date.getUTCDate() + 1);
    while (date.getUTCDay() !== 1) date.setUTCDate(date.getUTCDate() + 1);
    const dateKey = date.toISOString().slice(0, 10);
    const queryResponse = await publicApi.GET(new Request("https://trapit.in/api/apportion/STAFF-LINK?ownerIdentifier=%2B919111111111&serviceId=therapy"), { params: { shareCode: "STAFF-LINK" } });
    expect(queryResponse.status).toBe(200);
    expect((await queryResponse.json()).serviceId).toBe("therapy");

    const response = await publicApi.POST(new Request("https://trapit.in/api/apportion/STAFF-LINK", { method: "POST", body: JSON.stringify({ ownerIdentifier: OWNER, serviceId: "therapy", locationId: "location-1", slotDateKey: dateKey, startsAt: `${dateKey}T04:30:00.000Z` }) }), { params: { shareCode: "STAFF-LINK" } });
    expect(response.status).toBe(200);
    expect(fixtures.create).toHaveBeenCalledWith(expect.objectContaining({ ownerIdentifier: OWNER, serviceId: "therapy" }));

    const invalid = await publicApi.POST(new Request("https://trapit.in/api/apportion/STAFF-LINK", { method: "POST", body: JSON.stringify({ ownerIdentifier: STAFF, serviceId: "unassigned", locationId: "location-1", slotDateKey: dateKey, startsAt: `${dateKey}T04:30:00.000Z` }) }), { params: { shareCode: "STAFF-LINK" } });
    expect(invalid.status).toBe(400);
    expect(fixtures.create).toHaveBeenCalledTimes(1);
  });
  it("keeps personal branding while a staff booking code selects a linked canonical owner service", async () => {
    fixtures.linkedBusinessOwnerIdentifier = STAFF;
    fixtures.linkedBusinessBranding = normalizeWorkspaceBranding({
      instituteName: "Staff Studio",
      imageDataUrl: "data:image/png;base64,staff-logo",
      profileImageDataUrl: "data:image/png;base64,staff-profile",
      promotionalImageDataUrls: ["data:image/png;base64,staff-promotion"],
    } as never)!;
    fixtures.directServices = [
      { ownerIdentifier: STAFF, id: "consultation", name: "Personal service", businessName: "Staff Studio", locationIds: ["location-1"] },
      { ownerIdentifier: OWNER, id: "therapy", name: "Therapy", businessName: "Clinic", locationIds: ["location-1"] },
    ];

    const response = await publicApi.GET(new Request("https://trapit.in/api/apportion/STAFF-LINK?ownerIdentifier=%2B919111111111&serviceId=therapy"), { params: { shareCode: "STAFF-LINK" } });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.providerProfile).toMatchObject({ name: "Staff Studio", imageDataUrl: "data:image/png;base64,staff-logo", profileImageDataUrl: "data:image/png;base64,staff-profile", promotionalImageDataUrls: ["data:image/png;base64,staff-promotion"] });
    expect(payload.business).toMatchObject({ name: "Clinic", ownerIdentifier: OWNER, serviceId: "therapy" });
  });
  it("projects personal and assigned linked address cards together with owner-scoped location keys", async () => {
    fixtures.linkedBusinessOwnerIdentifier = STAFF;
    fixtures.linkedBusinessBranding = normalizeWorkspaceBranding({ instituteName: "Staff Studio" } as never)!;
    fixtures.personalContext = {
      business: { ownerIdentifier: STAFF, adminDelegateIdentifier: null, services: [{ id: "consultation", name: "Personal consultation", active: true, assignedIdentifier: STAFF, locationIds: ["location-1"] }] },
      ownerCategory: "trapit-pro",
      branding: normalizeWorkspaceBranding({ instituteName: "Staff Studio", appointmentLocations: [{ id: "location-1", name: "Personal address", address: "Home Street", workingDays: "Tuesday", workingHours: "8:00 AM - 11:00 AM", workingHoursSecondWindow: "" }] } as never)!,
      providerSettings: { [STAFF]: { appointmentsPerSlot: 2, justAddToList: false, slotDurationMinutes: 15 } },
      memberships: [],
      providerClosedDateKeys: { [STAFF]: ["2027-01-05"] },
    };
    fixtures.context!.providerClosedDateKeys = { [STAFF]: ["2027-01-06"] };
    fixtures.counts.mockImplementation(async (ownerIdentifier, _locationId, serviceId) => [{
      count: ownerIdentifier === OWNER ? 1 : 0,
      locationId: "location-1",
      startsAt: `${serviceId === "therapy" ? "2027-01-04" : "2027-01-05"}T04:30:00.000Z`,
    }]);
    fixtures.directServices = [
      { ownerIdentifier: STAFF, id: "consultation", name: "Personal consultation", businessName: "Staff Studio", locationIds: ["location-1"] },
      { ownerIdentifier: OWNER, id: "therapy", name: "Therapy", businessName: "Clinic", locationIds: ["location-1"] },
    ];

    const response = await publicApi.GET(new Request("https://trapit.in/api/apportion/STAFF-LINK"), { params: { shareCode: "STAFF-LINK" } });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.providerProfile.name).toBe("Staff Studio");
    expect(payload.canInvite).toBe(true);
    expect(payload.addressOptions.find((option: { key: string }) => option.key === `${OWNER}::location-1`).contexts[0].business.canInvite).toBe(false);
    const selectedForeign = await (await publicApi.GET(new Request(`https://trapit.in/api/apportion/STAFF-LINK?ownerIdentifier=${encodeURIComponent(OWNER)}&serviceId=therapy`), { params: { shareCode: "STAFF-LINK" } })).json();
    expect(selectedForeign.canInvite).toBe(false);
    expect(selectedForeign.business.canInvite).toBe(false);
    expect(payload.addressOptions.map((option: { key: string }) => option.key).sort()).toEqual([`${OWNER}::location-1`, `${STAFF}::location-1`].sort());
    expect(payload.addressOptions.find((option: { key: string }) => option.key === `${STAFF}::location-1`).contexts).toEqual(expect.arrayContaining([
      expect.objectContaining({ ownerIdentifier: STAFF, serviceId: "consultation", business: expect.objectContaining({ appointmentsPerSlot: 2, slotDurationMinutes: 15, providerClosedDateKeys: ["2027-01-05"], locations: [expect.objectContaining({ address: "Home Street" })] }), slotCounts: [expect.objectContaining({ count: 0 })] }),
    ]));
    expect(payload.addressOptions.find((option: { key: string }) => option.key === `${OWNER}::location-1`).contexts).toEqual(expect.arrayContaining([
      expect.objectContaining({ ownerIdentifier: OWNER, serviceId: "therapy", business: expect.objectContaining({ providerClosedDateKeys: ["2027-01-06"], locations: [expect.objectContaining({ workingHours: "10:00 AM - 12:00 PM" })] }), slotCounts: [expect.objectContaining({ count: 1 })] }),
    ]));
    expect(payload.addressOptions.flatMap((option: { contexts: Array<{ serviceId: string }> }) => option.contexts.map((context) => context.serviceId)).sort()).toEqual(["consultation", "therapy"]);
  });
  it("projects daily provider hours and leaves and rejects new or rescheduled bookings on leave", async () => {
    const dailyHours = Array.from({ length: 7 }, (_, weekday) => ({
      weekday,
      workingHours: weekday === 1 ? "9:00 AM - 5:00 PM" : "",
      workingHoursSecondWindow: "",
    }));
    fixtures.context!.memberships[0].dailyHours = dailyHours;
    fixtures.context!.providerClosedDateKeys = { [STAFF]: ["2027-01-04"] };
    const result = await (await publicApi.GET(new Request("https://trapit.in/api/apportion/SHARE?serviceId=therapy"), { params: { shareCode: "SHARE" } })).json();
    expect(result.business.locations[0].dailyHours).toEqual(dailyHours);
    expect(result.business.providerClosedDateKeys).toEqual(["2027-01-04"]);

    const bookingResponse = await publicApi.POST(new Request("https://trapit.in/api/apportion/SHARE", { method: "POST", body: JSON.stringify({
      serviceId: "therapy", locationId: "location-1", slotDateKey: "2027-01-04", startsAt: "2027-01-04T04:30:00.000Z",
    }) }), { params: { shareCode: "SHARE" } });
    expect(bookingResponse.status).toBe(400);
    expect(fixtures.create).not.toHaveBeenCalled();

    fixtures.appointments = [{ id: "leave-reschedule", ownerIdentifier: OWNER, requesterIdentifier: STAFF, locationId: "location-1", serviceId: "therapy", bookedSettings: { justAddToList: false, appointmentsPerSlot: 1, slotDurationMinutes: 30 } }];
    const rescheduleResponse = await dashboard.PATCH(new Request("https://trapit.in/api/user/apportion", { method: "PATCH", body: JSON.stringify({
      action: "reschedule", appointmentId: "leave-reschedule", nextServiceDateKey: "2027-01-04", nextStartsAt: "2027-01-04T04:30:00.000Z",
    }) }));
    expect(rescheduleResponse.status).toBe(400);
    expect(fixtures.update).not.toHaveBeenCalled();
  });
  it("defaults to Consultation and fails closed for Free/unknown owner services", async () => {
    const request = new Request("https://trapit.in/api/apportion/SHARE");
    expect((await (await publicApi.GET(request, { params: { shareCode: "SHARE" } })).json()).serviceId).toBe("consultation");
    fixtures.context!.ownerCategory = "unknown";
    expect((await publicApi.GET(request, { params: { shareCode: "SHARE" } })).status).toBe(400);
  });
  it("rejects queue snapshot rescheduling and unknown actions before mutation", async () => {
    fixtures.appointments = [{ id: "queue", bookedSettings: { justAddToList: true }, justAddToList: false }];
    const request = (body: unknown) => new Request("https://trapit.in/api/user/apportion", { method: "PATCH", body: JSON.stringify(body) });
    expect((await dashboard.PATCH(request({ action: "reschedule", appointmentId: "queue" }))).status).toBe(400);
    expect((await dashboard.PATCH(request({ action: "malicious", appointmentId: "queue" }))).status).toBe(400);
    expect(fixtures.update).not.toHaveBeenCalled();
  });
  it("books the selected service using provider settings rather than client capacity/mode", async () => {
    const now = new Date(Date.now() + 330 * 60_000);
    now.setUTCDate(now.getUTCDate() + 1);
    while (now.getUTCDay() !== 1) now.setUTCDate(now.getUTCDate() + 1);
    const dateKey = now.toISOString().slice(0, 10);
    const response = await publicApi.POST(new Request("https://trapit.in/api/apportion/SHARE", { method: "POST", body: JSON.stringify({ serviceId: "therapy", locationId: "location-1", slotDateKey: dateKey, startsAt: `${dateKey}T04:30:00.000Z`, appointmentsPerSlot: 999, justAddToList: true }) }), { params: { shareCode: "SHARE" } });
    expect(response.status).toBe(200);
    expect(fixtures.create).toHaveBeenCalledWith(expect.objectContaining({ serviceId: "therapy", appointmentsPerSlot: 3, justAddToList: false, startsAt: `${dateKey}T04:30:00.000Z` }));
  });
  it("rejects paused new bookings and closed provider dates before creation", async () => {
    fixtures.context!.business.services[1].active = false;
    const request = () => new Request("https://trapit.in/api/apportion/SHARE", { method: "POST", body: JSON.stringify({ serviceId: "therapy", locationId: "location-1", slotDateKey: "2027-01-04", startsAt: "2027-01-04T04:30:00.000Z" }) });
    expect((await publicApi.POST(request(), { params: { shareCode: "SHARE" } })).status).toBe(400);
    fixtures.context!.business.services[1].active = true;
    fixtures.context!.memberships[0].closedDateKeys = ["2027-01-04"];
    expect((await publicApi.POST(request(), { params: { shareCode: "SHARE" } })).status).toBe(400);
    expect(fixtures.create).not.toHaveBeenCalled();
  });
  it("validates paused-service rescheduling using the booked slot duration after downgrade", async () => {
    fixtures.context!.ownerCategory = "trapit-normal";
    fixtures.context!.business.services[1].active = false;
    fixtures.context!.providerSettings[STAFF].slotDurationMinutes = 60;
    fixtures.appointments = [{ id: "snapshot", ownerIdentifier: OWNER, requesterIdentifier: STAFF, locationId: "location-1", serviceId: "therapy", startsAt: "2027-01-04T04:30:00.000Z", justAddToList: false, bookedSettings: { justAddToList: false, appointmentsPerSlot: 2, slotDurationMinutes: 30 } }];
    const response = await dashboard.PATCH(new Request("https://trapit.in/api/user/apportion", { method: "PATCH", body: JSON.stringify({ action: "reschedule", appointmentId: "snapshot", nextServiceDateKey: "2027-01-04", nextStartsAt: "2027-01-04T05:00:00.000Z" }) }));
    expect(response.status).toBe(200);
    expect(fixtures.update).toHaveBeenCalledWith(expect.objectContaining({ appointmentsPerSlot: 2, nextStartsAt: "2027-01-04T05:00:00.000Z" }));
    expect((await response.json()).appointmentOperatingHoursById.snapshot).toMatchObject({ slotDurationMinutes: 30, workingHours: "10:00 AM - 12:00 PM" });
  });
  it("returns durable notifications without creating a Free share code", async () => {
    const response = await dashboard.GET(new Request("https://trapit.in/api/user/apportion?notifications=1"));
    expect((await response.json()).notifications).toHaveLength(1);
    expect(fixtures.share).not.toHaveBeenCalled();
  });
  it("combines appointment and durable directory notices in the notification listing", async () => {
    fixtures.scheduleNotifications = [{ id: "schedule", recipientIdentifier: STAFF, title: "Schedule updated", body: "Hours changed.", url: "/user?section=apportion", createdAt: "2026-10-04T09:00:00Z" }];
    const response = await dashboard.GET(new Request("https://trapit.in/api/user/apportion?notifications=1"));
    expect((await response.json()).notifications).toMatchObject([{ id: "schedule", title: "Schedule updated", body: "Hours changed." }, { id: "notice" }]);
  });
});

describe("Apportion targeted invitation API", () => {
  const post = (body: Record<string, unknown> = {}) => publicApi.POST(new Request("https://trapit.in/api/apportion/SHARE", {
    method: "POST",
    body: JSON.stringify({ ownerIdentifier: OWNER, serviceId: "therapy", locationId: "location-1", slotDateKey: "2026-10-05", startsAt: "2026-10-05T04:30:00.000Z", targetPhone: "9333333333", ...body }),
  }), { params: { shareCode: "SHARE" } });
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-05T00:00:00Z"));
    fixtures.actor.identifier = OWNER;
  });
  afterEach(() => vi.useRealTimers());

  it("rejects a same-suffix foreign owner for creation, lookup and invite capability", async () => {
    fixtures.actor.identifier = "+639111111111";
    expect((await post()).status).toBe(403);
    expect((await publicApi.GET(new Request("https://trapit.in/api/apportion/SHARE?lookupPhone=9333333333"), { params: { shareCode: "SHARE" } })).status).toBe(403);
    const payload = await (await publicApi.GET(new Request("https://trapit.in/api/apportion/SHARE"), { params: { shareCode: "SHARE" } })).json();
    expect(payload.canInvite).toBe(false);
    expect(payload.business.canInvite).toBe(false);
    expect(fixtures.invite).not.toHaveBeenCalled();
  });
  it.each([true, false])("never looks up or invites a foreign same-suffix target (Cognito configured: %s)", async (configured) => {
    fixtures.authConfigured = configured;
    fixtures.registeredUsers = [{ identifier: "+639333333333", label: "Foreign target" }];
    const lookup = () => publicApi.GET(new Request("https://trapit.in/api/apportion/SHARE?lookupPhone=9333333333"), { params: { shareCode: "SHARE" } });
    expect((await lookup()).status).toBe(404);
    expect((await post()).status).toBe(400);
    expect(fixtures.invite).not.toHaveBeenCalled();
    fixtures.registeredUsers.push({ identifier: "+919333333333", label: "Registered Name" });
    expect(await (await lookup()).json()).toEqual({ user: { identifier: "+919333333333", name: "Registered Name" } });
    expect((await post()).status).toBe(200);
    expect(fixtures.invite).toHaveBeenCalledWith(expect.objectContaining({ requesterIdentifier: "+919333333333" }));
  });
  it("rejects foreign owner selection and foreign owner-link invitation capability", async () => {
    const response = await publicApi.GET(new Request("https://trapit.in/api/apportion/SHARE?ownerIdentifier=%2B639111111111&serviceId=therapy"), { params: { shareCode: "SHARE" } });
    expect(response.status).toBe(404);
    expect((await post({ ownerIdentifier: "+639111111111" })).status).toBe(400);
    fixtures.linkedBusinessOwnerIdentifier = "+639111111111";
    expect((await post()).status).toBe(403);
    expect(fixtures.invite).not.toHaveBeenCalled();
  });
  it.each([true, false])("creates one invitation using fresh server identity (Cognito configured: %s)", async (configured) => {
    fixtures.authConfigured = configured;
    const response = await post({ requesterIdentifier: STAFF, requesterName: "Spoofed", requesterPhone: STAFF, actorIdentifier: STAFF });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ invitation: { id: "invitation", status: "pending" }, appointmentCount: 1, caution: null });
    expect(fixtures.invite).toHaveBeenCalledExactlyOnceWith({ actorIdentifier: OWNER, ownerIdentifier: OWNER, serviceId: "therapy", locationId: "location-1", requesterIdentifier: "+919333333333", requesterName: "Registered Name", requesterPhone: "+919333333333", notes: undefined, occurrences: [{ serviceDateKey: "2026-10-05", startsAt: "2026-10-05T04:30:00.000Z" }] });
    expect(fixtures.create).not.toHaveBeenCalled();
  });
  it("rechecks the registered target on POST even after a successful lookup", async () => {
    const lookup = await publicApi.GET(new Request("https://trapit.in/api/apportion/SHARE?lookupPhone=9333333333"), { params: { shareCode: "SHARE" } });
    expect(lookup.status).toBe(200);
    fixtures.registeredUsers = [];
    expect((await post({ requesterIdentifier: "+919333333333", requesterName: "Registered Name" })).status).toBe(400);
    expect(fixtures.invite).not.toHaveBeenCalled();
    expect(fixtures.create).not.toHaveBeenCalled();
  });
  it.each(["333", "9444444444", "", "+919333333333garbage"])("rejects unknown or malformed full target phone %s without writes", async (targetPhone) => {
    expect((await post({ targetPhone })).status).toBe(400);
    expect(fixtures.invite).not.toHaveBeenCalled();
    expect(fixtures.create).not.toHaveBeenCalled();
  });
  it.each([STAFF, "+919444444444"])("rejects staff or Admin targeted writes for %s", async (identifier) => {
    fixtures.actor.identifier = identifier;
    fixtures.context!.business.adminDelegateIdentifier = "+919444444444";
    expect((await post()).status).toBe(403);
    expect(fixtures.invite).not.toHaveBeenCalled();
    expect(fixtures.create).not.toHaveBeenCalled();
  });
  it("rejects owner invitations through a linked staff share page", async () => {
    fixtures.linkedBusinessOwnerIdentifier = STAFF;
    expect((await post()).status).toBe(403);
    expect(fixtures.invite).not.toHaveBeenCalled();
  });
  it("leaves self-target rejection to the invitation store", async () => {
    fixtures.registeredUsers = [{ identifier: OWNER, label: "Owner" }];
    fixtures.invite.mockRejectedValueOnce(new Error("Use normal booking for your own appointment."));
    expect((await post({ targetPhone: OWNER })).status).toBe(400);
    expect(fixtures.invite).toHaveBeenCalledWith(expect.objectContaining({ requesterIdentifier: OWNER }));
    expect(fixtures.create).not.toHaveBeenCalled();
  });
  it.each([OWNER, STAFF])("rejects recurrence without a targeted invitation for %s", async (identifier) => {
    fixtures.actor.identifier = identifier;
    expect((await post({ targetPhone: undefined, recurrence: { mode: "weekly", endDateKey: "2026-11-30", weekdayKeys: ["Mon"] } })).status).toBe(400);
    expect(fixtures.invite).not.toHaveBeenCalled();
    expect(fixtures.create).not.toHaveBeenCalled();
  });
  it("filters provider leave and closed dates before applying the six working-date cap", async () => {
    fixtures.context!.providerClosedDateKeys = { [STAFF]: ["2026-10-05"] };
    fixtures.context!.memberships[0].closedDateKeys = ["2026-10-12"];
    const response = await post({ recurrence: { mode: "weekly", endDateKey: "2026-12-28", weekdayKeys: ["Mon", "Tue"] } });
    expect(response.status).toBe(200);
    expect((await response.json()).appointmentCount).toBe(6);
    expect(fixtures.invite.mock.calls[0][0].occurrences).toEqual(["2026-10-19", "2026-10-26", "2026-11-02", "2026-11-09", "2026-11-16", "2026-11-23"].map((serviceDateKey) => ({ serviceDateKey, startsAt: `${serviceDateKey}T04:30:00.000Z` })));
  });
  it("omits working dates where the selected time does not fit effective master hours", async () => {
    fixtures.context!.business.services[1].assignedIdentifier = OWNER;
    fixtures.context!.providerSettings[OWNER].justAddToList = false;
    fixtures.context!.branding.appointmentDateHoursOverrides = [{ dateKey: "2026-10-12", locations: [{ locationId: "location-1", workingHours: "1:00 PM - 5:00 PM", workingHoursSecondWindow: "" }] }];
    const response = await post({ recurrence: { mode: "weekly", endDateKey: "2026-10-19", weekdayKeys: ["Mon"] } });
    expect(response.status).toBe(200);
    expect(fixtures.invite.mock.calls[0][0].occurrences).toEqual(["2026-10-05", "2026-10-19"].map((serviceDateKey) => ({ serviceDateKey, startsAt: `${serviceDateKey}T04:30:00.000Z` })));
  });
  it("supports monthly last-day deduplication and working-day filtering with at most six occurrences", async () => {
    fixtures.context!.branding.appointmentLocations![0].workingDays = "Sunday Monday Tuesday Wednesday Thursday Friday Saturday";
    fixtures.context!.memberships[0].workingDays = "Sunday Monday Tuesday Wednesday Thursday Friday Saturday";
    fixtures.context!.providerClosedDateKeys = { [STAFF]: ["2026-10-29"] };
    const response = await post({ slotDateKey: "2026-10-29", startsAt: "2026-10-29T04:30:00.000Z", recurrence: { mode: "monthly", endDateKey: "2027-03-31", monthDays: [29, 30, 31, 31] } });
    expect(response.status).toBe(200);
    expect(fixtures.invite.mock.calls[0][0].occurrences).toEqual(["2026-10-30", "2026-10-31", "2026-11-29", "2026-11-30", "2026-12-29", "2026-12-30"].map((serviceDateKey) => ({ serviceDateKey, startsAt: `${serviceDateKey}T04:30:00.000Z` })));
  });
  it("does not skip a valid working date with a capacity conflict or partially create invitations", async () => {
    fixtures.appointments = ["pending", "present-in-person", "pushed-back"].map((currentStatus) => ({ serviceId: "therapy", locationId: "location-1", serviceDateKey: "2026-10-12", startsAt: "2026-10-12T04:30:00Z", currentStatus }));
    const response = await post({ recurrence: { mode: "weekly", endDateKey: "2026-10-19", weekdayKeys: ["Mon"] } });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain("already full");
    expect(fixtures.invite).not.toHaveBeenCalled();
    expect(fixtures.create).not.toHaveBeenCalled();
  });
  it("estimates queue invitations with all active statuses and ignores unrelated services", async () => {
    fixtures.appointments = ["pending", "present-in-person", "pushed-back", "done"].map((currentStatus) => ({ serviceId: "consultation", locationId: "location-1", serviceDateKey: "2026-10-05", currentStatus }));
    fixtures.appointments.push({ serviceId: "therapy", locationId: "location-1", serviceDateKey: "2026-10-05", currentStatus: "pending" });
    expect((await post({ serviceId: "consultation", startsAt: undefined })).status).toBe(200);
    expect(fixtures.invite.mock.calls[0][0].occurrences).toEqual([{ serviceDateKey: "2026-10-05", startsAt: "2026-10-05T04:00:00.000Z" }]);
    expect(fixtures.create).not.toHaveBeenCalled();
  });
  it("preserves normal owner self-booking when no target is supplied", async () => {
    expect((await post({ targetPhone: undefined })).status).toBe(200);
    expect(fixtures.create).toHaveBeenCalledWith(expect.objectContaining({ requesterIdentifier: OWNER, requesterName: "Requester", serviceId: "therapy" }));
    expect(fixtures.invite).not.toHaveBeenCalled();
  });
});