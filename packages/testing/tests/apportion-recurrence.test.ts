import { describe, expect, it } from "vitest";
import { planApportionDateKeys } from "../src/apportion-recurrence";

describe("Apportion invitation recurrence", () => {
  it("limits the entire weekly series to six working dates", () => {
    expect(planApportionDateKeys("2026-10-05", { mode: "weekly", endDateKey: "2026-11-30", weekdayKeys: ["Mon", "Wed"] }, (date) => date !== "2026-10-07")).toEqual(["2026-10-05", "2026-10-12", "2026-10-14", "2026-10-19", "2026-10-21", "2026-10-26"]);
  });
  it("uses month end for missing dates and deduplicates overlapping choices", () => {
    expect(planApportionDateKeys("2027-01-30", { mode: "monthly", endDateKey: "2027-04-30", monthDays: [30, 31] }, () => true)).toEqual(["2027-01-30", "2027-01-31", "2027-02-28", "2027-03-30", "2027-03-31", "2027-04-30"]);
  });
  it("rejects malformed, empty and reversed recurrence choices", () => {
    expect(() => planApportionDateKeys("2027-02-30", null, () => true)).toThrow("valid recurrence dates");
    expect(() => planApportionDateKeys("2026-10-05", { mode: "weekly", endDateKey: "2026-10-01", weekdayKeys: ["Mon"] }, () => true)).toThrow("within six months");
    expect(() => planApportionDateKeys("2026-10-05", { mode: "monthly", endDateKey: "2026-11-01", monthDays: [32] }, () => true)).toThrow("monthly dates");
    expect(() => planApportionDateKeys("2026-10-05", null, () => false)).toThrow("No working dates");
  });
});