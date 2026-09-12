import { describe, expect, it } from "vitest";

import {
  buildPollRecurrenceCycles,
  countPendingPollRecurrenceCycles,
  findActivePollRecurrenceCycle,
} from "./quiz";

describe("poll recurrence cycles", () => {
  it("builds contiguous weekly cycles", () => {
    const cycles = buildPollRecurrenceCycles({
      cycleCount: 3,
      frequency: "weekly",
      startsAt: "2026-09-14T04:30:00.000Z",
    });

    expect(cycles).toEqual([
      { cycleIndex: 0, startsAt: "2026-09-14T04:30:00.000Z", endsAt: "2026-09-21T04:30:00.000Z" },
      { cycleIndex: 1, startsAt: "2026-09-21T04:30:00.000Z", endsAt: "2026-09-28T04:30:00.000Z" },
      { cycleIndex: 2, startsAt: "2026-09-28T04:30:00.000Z", endsAt: "2026-10-05T04:30:00.000Z" },
    ]);
  });

  it("builds contiguous bi-weekly cycles", () => {
    const cycles = buildPollRecurrenceCycles({
      cycleCount: 2,
      frequency: "biweekly",
      startsAt: "2026-09-14T04:30:00.000Z",
    });

    expect(cycles[0]?.endsAt).toBe("2026-09-28T04:30:00.000Z");
    expect(cycles[1]?.startsAt).toBe(cycles[0]?.endsAt);
    expect(cycles[1]?.endsAt).toBe("2026-10-12T04:30:00.000Z");
  });

  it("clamps monthly cycles at month end and keeps them contiguous", () => {
    const cycles = buildPollRecurrenceCycles({
      cycleCount: 3,
      frequency: "monthly",
      startsAt: "2027-01-31T04:30:00.000Z",
    });

    expect(cycles).toEqual([
      { cycleIndex: 0, startsAt: "2027-01-31T04:30:00.000Z", endsAt: "2027-02-28T04:30:00.000Z" },
      { cycleIndex: 1, startsAt: "2027-02-28T04:30:00.000Z", endsAt: "2027-03-28T04:30:00.000Z" },
      { cycleIndex: 2, startsAt: "2027-03-28T04:30:00.000Z", endsAt: "2027-04-28T04:30:00.000Z" },
    ]);
  });

  it("finds the active cycle and counts only unstarted cycles", () => {
    const cycles = buildPollRecurrenceCycles({
      cycleCount: 3,
      frequency: "weekly",
      startsAt: "2026-09-14T04:30:00.000Z",
    });
    const nowMs = Date.parse("2026-09-22T04:30:00.000Z");

    expect(findActivePollRecurrenceCycle(cycles, nowMs)?.cycleIndex).toBe(1);
    expect(countPendingPollRecurrenceCycles(cycles, nowMs)).toBe(1);
  });
});