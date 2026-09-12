import { describe, expect, it } from "vitest";

import { normalizeWorkspaceBranding, type WorkspaceBranding } from "./quiz";

describe("normalizeWorkspaceBranding", () => {
  it("preserves appointment locations and ordered promotional images", () => {
    const branding: WorkspaceBranding = {
      address: "Primary address",
      advanceBookingWeeks: 4,
      appointmentDateOverrides: { closedDateKeys: [], openedDateKeys: [] },
      appointmentLocations: [
        {
          address: "Primary address",
          id: "location-1",
          name: "Location 1",
          workingDays: "Monday",
          workingHours: "9:00 AM - 5:00 PM",
          workingHoursSecondWindow: "",
        },
      ],
      appointmentNotesPrompt: "Appointment notes",
      appointmentShareCode: "TRAPIT-APPT-TEST",
      appointmentsPerSlot: 1,
      breakHours: "",
      imageDataUrl: null,
      instituteName: "Example Business",
      justAddToList: false,
      profileImageDataUrl: null,
      promotionalImageDataUrls: ["data:image/png;base64,first", "data:image/png;base64,second"],
      recurringBookingLimit: null,
      recurringBookingsEnabled: false,
      showRemainingBookings: true,
      slotDurationMinutes: 30,
      workingDays: "Monday",
      workingHours: "9:00 AM - 5:00 PM",
      workingHoursSecondWindow: "",
    };

    const normalized = normalizeWorkspaceBranding(branding);

    expect(normalized?.appointmentLocations).toEqual(branding.appointmentLocations);
    expect(normalized?.promotionalImageDataUrls).toEqual(branding.promotionalImageDataUrls);
  });
});