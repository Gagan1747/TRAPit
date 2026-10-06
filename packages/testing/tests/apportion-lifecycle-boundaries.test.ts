import { describe, expect, it } from "vitest";
import { getApportionLifecycleBoundaries } from "../../../apps/web/lib/appointment-locations";

describe("Apportion lifecycle boundaries", () => {
  const location = { id: "location-1", name: "Main", address: "Main Street", workingDays: "Monday", workingHours: "9:00 AM - 5:00 PM", workingHoursSecondWindow: "" };

  it("expires a daytime service queue at the following IST midnight", () => {
    expect(getApportionLifecycleBoundaries({ location, serviceDateKey: "2026-10-05", slotDurationMinutes: 30, startsAt: "2026-10-05T04:00:00.000Z" })).toEqual({ slotEndsAt: "2026-10-05T04:30:00.000Z", queueExpiresAt: "2026-10-05T18:30:00.000Z" });
  });

  it("protects an overnight slot and clears its queue the next night", () => {
    expect(getApportionLifecycleBoundaries({ location: { ...location, workingHours: "10:00 PM - 2:00 AM" }, serviceDateKey: "2026-10-05", slotDurationMinutes: 120, startsAt: "2026-10-05T18:00:00.000Z" })).toEqual({ slotEndsAt: "2026-10-05T20:00:00.000Z", queueExpiresAt: "2026-10-06T18:30:00.000Z" });
  });

  it("preserves a 24-hour slot until its full duration has elapsed", () => {
    expect(getApportionLifecycleBoundaries({ location: { ...location, workingHours: "8:00 AM - 8:00 AM" }, serviceDateKey: "2026-10-05", slotDurationMinutes: 1440, startsAt: "2026-10-05T02:30:00.000Z" })).toEqual({ slotEndsAt: "2026-10-06T02:30:00.000Z", queueExpiresAt: "2026-10-06T18:30:00.000Z" });
  });

  it("treats 24:00 and 12 AM end boundaries identically", () => {
    const input = { serviceDateKey: "2026-10-05", slotDurationMinutes: 30, startsAt: "2026-10-05T04:00:00.000Z" };
    const first = getApportionLifecycleBoundaries({ ...input, location: { ...location, workingHours: "09:00 - 24:00" } });
    expect(first).toEqual(getApportionLifecycleBoundaries({ ...input, location: { ...location, workingHours: "9:00 AM - 12:00 AM" } }));
    expect(first.queueExpiresAt).toBe("2026-10-06T18:30:00.000Z");
    expect(getApportionLifecycleBoundaries({ ...input, location: { ...location, workingHours: "00:00 - 24:00" } }).queueExpiresAt).toBe(first.queueExpiresAt);
  });
});