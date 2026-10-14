import { describe, expect, it } from "vitest";
import { createElement } from "../../../apps/web/node_modules/react";
import { renderToStaticMarkup } from "../../../apps/web/node_modules/react-dom/server";
import { BusinessHoursGrid } from "../../../apps/web/components/business-hours-grid";
import { ApportionAppointmentLog, type ApportionLogAppointment } from "../../../apps/web/components/apportion-appointment-log";

describe("Apportion UI contracts", () => {
  it("renders one reserved timeline and seven day buttons rather than checkboxes", () => {
    const html = renderToStaticMarkup(createElement(BusinessHoursGrid, {
      label: "Main", dailyHours: [], activeWeekdays: [1, 2], onDayToggle: () => {}, onHoursChange: () => {},
    }));
    expect(html.match(/class="business-time-bar"/g)).toHaveLength(1);
    expect(html.match(/aria-label="Main works on /g)).toHaveLength(7);
    expect(html).not.toContain('type="checkbox"');
    expect(html.indexOf('class="business-shared-timeline"')).toBeLessThan(html.indexOf('class="business-hours-grid"'));
  });

  const message = "Full latest message\n" + "Untruncated notes ".repeat(120);
  function appointment(justAddToList: boolean): ApportionLogAppointment {
    return {
      id: "appointment", currentStatus: justAddToList ? "pending" : "delayed", justAddToList,
      canManage: true, canMessage: true, ownerIdentifier: "+919111111111", requesterIdentifier: "+919222222222",
      requesterName: "Customer", requesterPhone: "+919222222222", ownerName: "Clinic", scope: "owner",
      startsAt: "2026-10-08T04:00:00Z", createdAt: "2026-10-07T04:00:00Z", statusUpdatedAt: "2026-10-08T04:30:00Z",
      serviceDateKey: "2026-10-08", locationName: "Main", locationAddress: "Main Street", notes: null,
      messages: [{ id: "message", authorIdentifier: "+919111111111", createdAt: "2026-10-08T04:00:00Z", body: message }],
      history: [], queuePosition: null, serialLabel: "1",
    };
  }
  function render(justAddToList: boolean) {
    return renderToStaticMarkup(createElement(ApportionAppointmentLog, {
      currentIdentifier: "+919111111111", appointments: [appointment(justAddToList)],
      isActive: (status) => status === "pending" || status === "delayed", isRequester: () => false,
      formatDateTime: (value) => value, getStatusLabel: (entry) => entry.currentStatus === "delayed" ? "Delayed" : "Pending",
      onAction: async () => {}, onCancel: async () => {}, onRefresh: () => {}, isUpdating: false,
    }));
  }
  it("shows Done without Absent for delayed slots, with full notes and unstruck time", () => {
    const html = render(false);
    expect(html).toContain(">Done</button>");
    expect(html).not.toContain(">Absent</button>");
    expect(html).toContain('is-delayed');
    expect(html).toContain(message);
    expect(html).not.toContain("<s>");
  });
  it("preserves queue Absent", () => {
    expect(render(true)).toContain(">Absent</button>");
  });
  function renderEntries(entries: ApportionLogAppointment[]) {
    return renderToStaticMarkup(createElement(ApportionAppointmentLog, {
      currentIdentifier: "+919222222222", appointments: entries,
      isActive: (status) => status === "pending" || status === "delayed", isRequester: () => true,
      formatDateTime: (value) => value, getStatusLabel: (entry) => entry.currentStatus,
      onAction: async () => {}, onCancel: async () => {}, onRefresh: () => {}, isUpdating: false,
    }));
  }
  it("uses service buttons through four business/service IDs and a dropdown beyond four", () => {
    const entries = Array.from({ length: 5 }, (_, index) => ({ ...appointment(false), id: `entry-${index}`, serviceId: `service-${index}`, serviceName: `Service ${index}` }));
    const four = renderEntries(entries.slice(0, 4));
    expect(four).toContain('aria-pressed="true"');
    expect(four).not.toContain("<select");
    const five = renderEntries(entries);
    expect(five).toContain('aria-label="Filter service"');
    expect(five).toContain("<select");
    expect(five).toContain(">All services</option>");
  });
  it("renders snapshot hierarchy and assigned staff customer contact rather than business contact", () => {
    const html = renderEntries([{ ...appointment(false), scope: "requester", serviceName: "Therapy", assignedStaffName: "Booked Therapist", assignedStaffPhone: "+919555555555" }]);
    expect(html).toContain("<strong>Booked Therapist</strong>");
    expect(html).toContain("+919555555555");
    expect(html.indexOf(">Clinic</span>")).toBeLessThan(html.indexOf(">Therapy</span>"));
    expect(html.indexOf(">Therapy</span>")).toBeLessThan(html.indexOf(">Main Street</span>"));
    expect(html).toContain(">Cancel</button>");
  });
  it("does not allow a business viewer without controller authority to cancel", () => {
    const html = renderToStaticMarkup(createElement(ApportionAppointmentLog, {
      currentIdentifier: "+919111111111", appointments: [{ ...appointment(false), canManage: false }],
      isActive: () => true, isRequester: () => false, formatDateTime: (value) => value,
      getStatusLabel: () => "Pending", onAction: async () => {}, onCancel: async () => {}, onRefresh: () => {}, isUpdating: false,
    }));
    expect(html).not.toContain(">Cancel</button>");
  });
});
