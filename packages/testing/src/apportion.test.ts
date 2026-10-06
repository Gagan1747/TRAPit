import { describe, expect, it } from "vitest";
import {
  autofillApportionDailyHours, clipApportionDailySchedule, getApportionWeeklyIntervals,
  intersectApportionWeeklyIntervals, resolveApportionDailySchedule,
  assertApportionAddressCapacity, assertApportionServiceAssignment,
  getApportionBookableServices, migrateApportionDirectory,
  normalizeApportionProviderSettings, resolveApportionController,
  type ApportionBusiness,
} from "./apportion";
import { normalizeWorkspaceBranding } from "./quiz";

const business: ApportionBusiness = {
  ownerIdentifier: "+919582372662",
  adminDelegateIdentifier: "admin",
  services: [{ id: "consultation", name: "Consultation", active: true, assignedIdentifier: "+919582372662", locationIds: ["location-1"] }],
};

describe("Apportion roles and migration", () => {
  it("migrates without changing branding or replacing saved settings", () => {
    const branding = normalizeWorkspaceBranding({ instituteName: "Clinic", address: "Address", workingDays: "Monday", workingHours: "9:00 AM - 5:00 PM", appointmentShareCode: "OLD-QR", justAddToList: false, appointmentsPerSlot: 3, slotDurationMinutes: 30 } as never)!;
    const original = structuredClone(branding);
    const first = migrateApportionDirectory({ owner: branding });
    expect(first.businesses.owner.services[0]).toMatchObject({ id: "consultation", assignedIdentifier: "owner", locationIds: ["location-1"] });
    expect(first.providerSettings.owner).toEqual({ appointmentsPerSlot: 3, justAddToList: false, slotDurationMinutes: 30 });
    expect(migrateApportionDirectory({ owner: branding }, first)).toEqual(first);
    expect(branding).toEqual(original);
    expect(branding.appointmentShareCode).toBe("OLD-QR");
  });

  it("preserves closed dates and durable schedule notifications through migration", () => {
    const existing = {
      providerClosedDateKeys: { staff: ["2026-10-04"] },
      scheduleNotifications: [{
        id: "notification-1",
        recipientIdentifier: "staff",
        message: "Schedule updated",
        createdAt: "2026-10-04T09:00:00.000Z",
        deliveredAt: "2026-10-04T09:01:00.000Z",
      }],
    };
    expect(migrateApportionDirectory({}, existing)).toMatchObject(existing);
  });

  it("uses queue, one appointment and ten minutes only for new settings", () => {
    expect(normalizeApportionProviderSettings()).toEqual({ appointmentsPerSlot: 1, justAddToList: true, slotDurationMinutes: 10 });
    expect(normalizeApportionProviderSettings({ slotDurationMinutes: 1440 }).slotDurationMinutes).toBe(1440);
  });

  it("routes assigned services to staff and unassigned services to delegate or owner", () => {
    expect(resolveApportionController(business, business.services[0])).toBe(business.ownerIdentifier);
    const unassigned = { ...business.services[0], assignedIdentifier: null };
    expect(resolveApportionController(business, unassigned)).toBe("admin");
    expect(resolveApportionController({ ...business, adminDelegateIdentifier: null }, unassigned)).toBe(business.ownerIdentifier);
  });

  it("books only the first four active rows on downgrade and excludes disabled rows", () => {
    const services = Array.from({ length: 7 }, (_, index) => ({ ...business.services[0], id: `service-${index}`, active: index !== 1 }));
    expect(getApportionBookableServices({ ...business, services }, "trapit-pro").map((service) => service.id)).toEqual(["service-0", "service-2", "service-3", "service-4"]);
    expect(getApportionBookableServices({ ...business, services }, "trapit-normal")).toEqual([]);
    expect(services).toHaveLength(7);
  });

  it("enforces active quotas and normalized person uniqueness", () => {
    expect(() => assertApportionServiceAssignment(business, { ...business.services[0], id: "duplicate", assignedIdentifier: "9582372662" }, "trapit-pro")).toThrow("only one service");
    const full = { ...business, services: Array.from({ length: 4 }, (_, index) => ({ ...business.services[0], id: `service-${index}`, assignedIdentifier: null })) };
    expect(() => assertApportionServiceAssignment(full, { ...business.services[0], id: "new", assignedIdentifier: null }, "trapit-pro")).toThrow("Upgrade");
    expect(() => assertApportionServiceAssignment({ ...full, services: full.services.map((service) => ({ ...service, active: false })) }, { ...business.services[0], id: "new" }, "trapit-pro")).not.toThrow();
  });

  it("counts distinct linked addresses, not services or delegation", () => {
    const memberships = [{ ownerIdentifier: "owner", locationId: "location-1", providerIdentifier: "staff", workingDays: "Monday", workingHours: "9:00 AM - 5:00 PM", workingHoursSecondWindow: "", closedDateKeys: [] }];
    const input = { providerIdentifier: "staff", ownerIdentifier: "owner", locationIds: ["location-1", "location-2"], personalLocations: [], memberships };
    expect(() => assertApportionAddressCapacity(input)).not.toThrow();
    expect(() => assertApportionAddressCapacity({ ...input, locationIds: ["location-1", "location-2", "location-3"] })).toThrow("Staff address unavailable");
  });

  it("resolves legacy working days and hours without changing the shared weekly schedule", () => {
    expect(resolveApportionDailySchedule({ workingDays: "Monday, Wednesday", workingHours: "9:00 AM - 5:00 PM" }).slice(0, 4))
      .toEqual([
        { weekday: 0, workingHours: "", workingHoursSecondWindow: "" },
        { weekday: 1, workingHours: "9:00 AM - 5:00 PM", workingHoursSecondWindow: "" },
        { weekday: 2, workingHours: "", workingHoursSecondWindow: "" },
        { weekday: 3, workingHours: "9:00 AM - 5:00 PM", workingHoursSecondWindow: "" },
      ]);
  });

  it("uses each daily schedule and emits separate intervals for two windows", () => {
    const schedule = { dailyHours: [
      { weekday: 1, workingHours: "9:00 AM - 12:00 PM", workingHoursSecondWindow: "1:00 PM - 5:00 PM" },
      { weekday: 2, workingHours: "10:00 AM - 2:00 PM", workingHoursSecondWindow: "" },
    ] };
    expect(resolveApportionDailySchedule(schedule)[1]).toEqual(schedule.dailyHours[0]);
    expect(getApportionWeeklyIntervals(schedule)).toEqual([
      { startMinute: 1980, endMinute: 2160 },
      { startMinute: 2220, endMinute: 2460 },
      { startMinute: 3480, endMinute: 3720 },
    ]);
  });

  it("merges adjacent windows and clips provider hours to two master windows", () => {
    const provider = { dailyHours: [{ weekday: 1, workingHours: "8:00 AM - 12:00 PM", workingHoursSecondWindow: "12:00 PM - 6:00 PM" }] };
    const master = { dailyHours: [{ weekday: 1, workingHours: "9:00 AM - 11:00 AM", workingHoursSecondWindow: "12:00 PM - 4:00 PM" }] };
    expect(intersectApportionWeeklyIntervals(
      [{ startMinute: 540, endMinute: 660 }, { startMinute: 660, endMinute: 720 }],
      [{ startMinute: 540, endMinute: 720 }],
    )).toEqual([{ startMinute: 540, endMinute: 720 }]);
    expect(clipApportionDailySchedule(provider, master)[1]).toEqual({
      weekday: 1,
      workingHours: "9:00 AM - 11:00 AM",
      workingHoursSecondWindow: "12:00 PM - 4:00 PM",
    });
  });

  it("wraps overnight intervals across Sunday and handles a full 24-hour day", () => {
    const overnight = getApportionWeeklyIntervals({
      dailyHours: [{ weekday: 6, workingHours: "10:00 PM - 2:00 AM", workingHoursSecondWindow: "" }],
    });
    expect(overnight).toEqual([
      { startMinute: 0, endMinute: 120 },
      { startMinute: 10080 - 120, endMinute: 10080 },
    ]);
    expect(getApportionWeeklyIntervals({
      dailyHours: [{ weekday: 3, workingHours: "12:00 AM - 12:00 AM", workingHoursSecondWindow: "" }],
    })).toEqual([{ startMinute: 4320, endMinute: 5760 }]);
  });

  it("updates copied hours on source changes while preserving custom and inactive saved days", () => {
    const input = [
      { weekday: 0, workingHours: "9:00 AM - 5:00 PM", workingHoursSecondWindow: "1:00 PM - 2:00 PM" },
      { weekday: 1, workingHours: "9:00 AM - 5:00 PM", workingHoursSecondWindow: "1:00 PM - 2:00 PM" },
      { weekday: 2, workingHours: "10:00 AM - 3:00 PM", workingHoursSecondWindow: "" },
      { weekday: 3, workingHours: "9:00 AM - 5:00 PM", workingHoursSecondWindow: "1:00 PM - 2:00 PM" },
      { weekday: 6, workingHours: "11:00 AM - 1:00 PM", workingHoursSecondWindow: "" },
    ];
    const changedSource = input.map((entry) => entry.weekday === 0
      ? { ...entry, workingHours: "8:00 AM - 4:00 PM" }
      : entry);
    const filled = autofillApportionDailyHours(changedSource, 0, [0, 1, 2, 3], [2]);

    expect(filled[0]).toEqual({ weekday: 0, workingHours: "8:00 AM - 4:00 PM", workingHoursSecondWindow: "1:00 PM - 2:00 PM" });
    expect(filled[1]).toEqual({ weekday: 1, workingHours: "8:00 AM - 4:00 PM", workingHoursSecondWindow: "1:00 PM - 2:00 PM" });
    expect(filled[2]).toEqual(input[2]);
    expect(filled[3]).toEqual({ weekday: 3, workingHours: "8:00 AM - 4:00 PM", workingHoursSecondWindow: "1:00 PM - 2:00 PM" });
    expect(filled[6]).toEqual(input[4]);

    const inactiveRequestedSource = autofillApportionDailyHours(input, 6, [0, 1, 2, 3], [2]);
    expect(inactiveRequestedSource[1]).toEqual({ ...input[0], weekday: 1 });

    const clearedSource = autofillApportionDailyHours(
      filled.map((entry) => entry.weekday === 0 ? { ...entry, workingHours: "", workingHoursSecondWindow: "" } : entry),
      0,
      [0, 1, 2, 3],
      [2],
    );
    expect(clearedSource[1]).toEqual({ weekday: 1, workingHours: "", workingHoursSecondWindow: "" });
    expect(clearedSource[2]).toEqual(input[2]);
    expect(clearedSource[3]).toEqual({ weekday: 3, workingHours: "", workingHoursSecondWindow: "" });
    expect(clearedSource[6]).toEqual(input[4]);
  });
});