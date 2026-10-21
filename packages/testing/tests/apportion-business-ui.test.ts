import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createElement } from "../../../apps/web/node_modules/react";
import { renderToStaticMarkup } from "../../../apps/web/node_modules/react-dom/server";
import { BusinessTimeRangeSelector } from "../../../apps/web/components/business-time-range-selector";
import { BusinessAddresses, BusinessRoles, BusinessBookingLink, LinkedHours } from "../../../apps/web/components/apportion-role-panel";
import { normalizeWorkspaceBranding } from "../src/quiz";

type Business = Parameters<typeof BusinessRoles>[0]["business"];
const owner = "+919111111111";
const branding = normalizeWorkspaceBranding({
  instituteName: "Clinic", appointmentShareCode: "OWNER-CODE", appointmentsPerSlot: 1, slotDurationMinutes: 10,
  appointmentLocations: [{ id: "location-1", name: "Main", address: "Main Street", workingDays: "Monday", workingHours: "9:00 AM - 5:00 PM", workingHoursSecondWindow: "" }],
} as never)!;
const business = (role: Business["role"], delegated: boolean): Business => ({
  role, branding, ownerCategory: "trapit-pro",
  business: { ownerIdentifier: owner, adminDelegateIdentifier: delegated ? "+919222222222" : null, services: [
    { id: "consultation", name: "Consultation", assignedIdentifier: owner, locationIds: ["location-1"], active: true },
    { id: "staff", name: "Staff service", assignedIdentifier: null, locationIds: [], active: false },
  ] },
  memberships: [],
} as Business);

describe("business panel permission surfaces", () => {
  it("uses the owner booking URL for delegated business hyperlinks and actions", () => {
    const html = renderToStaticMarkup(createElement(BusinessBookingLink, { business: business("admin", true), actions: true }));
    expect(html.match(/href="\/apportion\/OWNER-CODE"/g)).toHaveLength(2);
    expect(html).toContain('aria-label="Copy booking link"');
    expect(html).toContain('aria-label="Open booking page"');
    expect(html).toContain('aria-label="QR code unavailable"');
  });
  it("keeps delegated owner service and delegation without business-wide staff controls", () => {
    const html = renderToStaticMarkup(createElement(BusinessRoles, { business: business("owner", true), busy: false, save: async () => true }));
    expect(html).toContain("Owner service name");
    expect(html).toContain("Delegate");
    expect(html).not.toContain("Staff service");
    expect(html).not.toContain("Add service");
    expect(html).not.toMatch(/<fieldset disabled="" class="apportion-matrix-row"><div><strong>Owner/);
  });
  it("allows the delegated admin to manage staff but not the owner's service name", () => {
    const html = renderToStaticMarkup(createElement(BusinessRoles, { business: business("admin", true), busy: false, save: async () => true }));
    expect(html).toContain("Staff service");
    expect(html).toContain("Add service");
    expect(html).toMatch(/<fieldset disabled="" class="apportion-matrix-row"><div><strong>Owner/);
    expect(html).toContain('aria-label="Owner service name" readonly="" value="Consultation"');
    expect(html).toContain('aria-label="Staff 1 service name" value="Staff service"');
  });
  it("gives the admin global configuration and leaves, without address deletion or owner deactivation", () => {
    const html = renderToStaticMarkup(createElement(BusinessAddresses, { business: business("admin", true), busy: false, save: async () => true }));
    expect(html).toContain("Business-wide configuration");
    expect(html).toContain("Business leave date");
    expect(html).toContain("Business logo");
    expect(html).toContain("Promotional images");
    expect(html).toContain("Clear business-wide settings");
    expect(html).not.toContain("Remove Address");
    expect(html).not.toContain("Clear form");
    expect(html).toContain('readonly="" value="Clinic"');
    expect(html).toContain('class="business-choice-row business-duration-choices"');
    expect(html).toContain('class="field-label business-booking-type-heading">Booking type</span>');
    expect(html).not.toContain("<select");
  });
  it("keeps staff service names readonly", () => {
    const html = renderToStaticMarkup(createElement(BusinessRoles, { business: business("staff", true), busy: false, save: async () => true }));
    expect(html).toContain('aria-label="Staff 1 service name" readonly="" value="Staff service"');
    expect(html).not.toContain("Add service");
  });
  it("retains staff schedules with the readonly address above editable hours", () => {
    const html = renderToStaticMarkup(createElement(LinkedHours, {
      membership: { ownerIdentifier: owner, providerIdentifier: "+919333333333", locationId: "location-1", workingDays: "Monday", workingHours: "9:00 AM - 1:00 PM", workingHoursSecondWindow: "", closedDateKeys: [] } as Parameters<typeof LinkedHours>[0]["membership"],
      address: "Main Street", master: branding.appointmentLocations![0], blockedWeeklyIntervals: [],
      busy: false, save: async () => true,
    }));
    expect(html).toContain('readonly="" value="Main Street"');
    expect(html.indexOf('readonly=""')).toBeLessThan(html.indexOf('class="business-weekly-hours"'));
    expect(html).toContain("Save hours");
    expect(html).not.toContain("Business name");
  });
  it("hatches outside master hours as well as provider overlaps", () => {
    const html = renderToStaticMarkup(createElement(BusinessTimeRangeSelector, {
      timelineOnly: true, label: "Staff hours", value: "", onChange: () => {},
      allowedIntervals: [{ startMinutes: 540, endMinutes: 1020 }],
      blockedIntervals: [{ startMinutes: 600, endMinutes: 660 }],
    }));
    expect(html).toMatch(/aria-label="8:00 AM"[^>]*class="[^"]*is-blocked[^"]*"[^>]*disabled=""/);
    expect(html).toMatch(/aria-label="10:00 AM"[^>]*class="[^"]*is-blocked[^"]*"[^>]*disabled=""/);
    expect(html).toMatch(/aria-label="9:00 AM"[^>]*class="business-time-point is-hour"/);
  });
});

describe("business save and dashboard integration contracts", () => {
  const source = readFileSync(new URL("../../../apps/web/components/admin-question-workspace.tsx", import.meta.url), "utf8");
  it("saves delegated owner name and address from the global snapshot, not personal settings drafts", () => {
    const save = source.slice(source.indexOf("async function handleSaveBranding()"), source.indexOf("const appointmentsPerSlot =", source.indexOf("async function handleSaveBranding()")));
    expect(save).toContain("if (ownerDelegated)");
    expect(save).toContain("if (!workspaceBranding)");
    expect(save).toContain("...workspaceBranding,");
    expect(save).toContain("...location,");
    expect(save).toContain("instituteName: brandingInstituteName");
    expect(save).toContain("address: brandingAddress");
    for (const personalDraft of ["businessAppointmentsPerSlot", "businessSlotDurationMinutes", "businessBookingBehaviorMode", "brandingImageDataUrl", "businessDateOverrides", "businessDailyHours"]) {
      expect(save).not.toContain(personalDraft);
    }
    expect(source).toContain("updateProviderSettings: Boolean(!ownerDelegated && workspaceBranding");
    const callback = source.slice(source.indexOf("onProviderSettingsSaved={(settings)"), source.indexOf("personalBusinessForm={businessDetailsPanel}"));
    expect(callback).toContain("if (!ownerDelegated) setWorkspaceBranding(");
  });
  it("preserves the surviving saved location ID and picks an unused ID for a new second address", () => {
    const save = source.slice(source.indexOf("async function handleSaveBranding()"), source.indexOf("async function persistDelegatedBusinessDetails("));
    expect(save).toContain('id: workspaceBranding?.appointmentLocations?.[0]?.id ?? "location-1"');
    expect(save).toContain('id: workspaceBranding?.appointmentLocations?.[1]?.id ?? (workspaceBranding?.appointmentLocations?.[0]?.id === "location-2" ? "location-1" : "location-2")');
    expect(save).toContain("...(workspaceBranding.appointmentLocations ?? []).map((location, index)");
    expect(save).toContain("...location,");
    expect(save).toContain('id: workspaceBranding.appointmentLocations[0].id === "location-2" ? "location-1" : "location-2"');
    expect(save).not.toContain('id: "location-1"');
    expect(save).not.toContain('id: "location-2"');
  });
  it("uses independent processing state and prevents duplicate submission", () => {
    expect(source).toContain("if (businessSavePendingRef.current) return;");
    expect(source).toContain("aria-busy={isSavingBusiness}");
    expect(source).toContain('className="apportion-spinner"');
    expect(source).toContain("Changes apply to new bookings and reschedules. Existing appointments remain unchanged</p>");
  });
  it("persists deactivation before resetting, preserving the draft on failure", () => {
    const clear = source.slice(source.indexOf("async function handleClearBranding()"), source.indexOf("function handleSchedulePoll()"));
    expect(clear).toContain("window.confirm(");
    expect(clear.indexOf('JSON.stringify({ branding: null })')).toBeLessThan(clear.indexOf("syncBrandingDraft(payload.branding)"));
    expect(clear.slice(clear.indexOf("catch (error)"))).not.toContain("syncBrandingDraft");
    expect(clear).not.toContain('setBrandingAddress("")');
  });
  it("deletes saved addresses directly without validating unrelated draft fields", () => {
    const remove = source.slice(source.indexOf("async function handleRemoveBusinessAddress("), source.indexOf("function handleToggleBusinessDay("));
    expect(remove).toContain('operation: "remove-address", locationId');
    expect(remove).toContain("await refreshBusinessForm()");
    expect(remove).not.toContain("brandingInstituteName.trim()");
    expect(source).toContain('aria-label="Remove Address 1"');
  });
  it("shows the exact delegation-limit error in a popup", () => {
    const rolePanel = readFileSync(new URL("../../../apps/web/components/apportion-role-panel.tsx", import.meta.url), "utf8");
    expect(rolePanel).toContain('window.alert("Admin address unavailable")');
    expect(rolePanel).toContain("onOwnerDelegationChange");
    expect(rolePanel).not.toContain("Personal address allowance:");
  });
  it("removes dashboard bells while keeping an automatic prompt on the user dashboard only", () => {
    const restricted = readFileSync(new URL("../../../apps/web/components/restricted-user-dashboard-workspace.tsx", import.meta.url), "utf8");
    expect(source).not.toContain("NotificationBell");
    expect(restricted).not.toContain("NotificationBell");
    expect(source).toContain('pathname === "/user"');
    expect(source).toContain('BrowserPushPrompt mode="automatic"');
    expect(restricted).toContain('BrowserPushPrompt mode="automatic"');
  });
});
