import { describe, expect, it } from "vitest";

import { buildApportionBookingPath } from "../../../apps/web/lib/apportion-booking-path";

describe("public Apportion auth handoff path", () => {
  it("preserves the canonical booking path and selected service/address query", () => {
    expect(buildApportionBookingPath("STAFF-LINK", {
      serviceId: "therapy",
      locationId: "location-1",
      ownerIdentifier: "+919111111111",
    })).toBe("/apportion/STAFF-LINK?serviceId=therapy&locationId=location-1&ownerIdentifier=%2B919111111111");
  });
});