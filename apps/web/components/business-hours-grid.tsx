"use client";

import { useState } from "react";
import { X } from "lucide-react";
import type { AppointmentDailyHours, ApportionWeeklyInterval } from "@trapit/testing";
import { BusinessTimeRangeSelector } from "./business-time-range-selector";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const FIELDS = ["workingHours", "workingHoursSecondWindow"] as const;
type HoursField = typeof FIELDS[number];

function intervalsForDay(intervals: ApportionWeeklyInterval[], weekday: number) {
  const dayStart = weekday * 1440;
  return [-10080, 0, 10080].flatMap((offset) => intervals.map((interval) => ({
    startMinutes: interval.startMinute + offset - dayStart,
    endMinutes: interval.endMinute + offset - dayStart,
  }))).filter((interval) => interval.endMinutes > 0 && interval.startMinutes < 2880);
}

export function BusinessHoursGrid({
  dailyHours, activeWeekdays, disabledWeekdays = [], allowedWeeklyIntervals, blockedWeeklyIntervals = [],
  label, onDayToggle, onHoursChange,
}: {
  dailyHours: AppointmentDailyHours[];
  activeWeekdays: number[];
  disabledWeekdays?: number[];
  allowedWeeklyIntervals?: ApportionWeeklyInterval[];
  blockedWeeklyIntervals?: ApportionWeeklyInterval[];
  label: string;
  onDayToggle: (weekday: number) => void;
  onHoursChange: (weekday: number, field: HoursField, value: string) => void;
}) {
  const [selection, setSelection] = useState<{ weekday: number; field: HoursField } | null>(null);
  const selectedHours = dailyHours.find((entry) => entry.weekday === selection?.weekday);
  const enabled = selection !== null && activeWeekdays.includes(selection.weekday) && !disabledWeekdays.includes(selection.weekday);
  const fieldLabel = selection
    ? `${label} ${DAYS[selection.weekday]} operating hours ${selection.field === "workingHours" ? 1 : 2}`
    : "Select an operating-hours button below";

  return <div className="business-weekly-hours" role="group" aria-label={`${label} weekdays`}>
    <div className="business-shared-timeline">
      <BusinessTimeRangeSelector
        key={selection ? `${selection.weekday}:${selection.field}:${enabled}` : "none"}
        timelineOnly
        disabled={!enabled}
        label={fieldLabel}
        value={selection ? selectedHours?.[selection.field] ?? "" : ""}
        allowedIntervals={selection && allowedWeeklyIntervals ? intervalsForDay(allowedWeeklyIntervals, selection.weekday) : undefined}
        blockedIntervals={selection ? intervalsForDay(blockedWeeklyIntervals, selection.weekday) : []}
        blockedRanges={selection ? [selectedHours?.[selection.field === "workingHours" ? "workingHoursSecondWindow" : "workingHours"] ?? ""].filter(Boolean) : []}
        onChange={(value) => { if (selection && enabled) onHoursChange(selection.weekday, selection.field, value); }}
      />
    </div>
    <div className="business-hours-grid">
      <div className="business-hours-grid-head"><span>Day</span><span>Operating hours 1</span><span>Operating hours 2</span></div>
      {DAYS.map((day, weekday) => {
        const active = activeWeekdays.includes(weekday);
        const hours = dailyHours.find((entry) => entry.weekday === weekday);
        return <div className="business-hours-grid-row" key={day}>
          <button className="business-choice-button business-hours-day" aria-label={`${label} works on ${day}`} aria-pressed={active} disabled={disabledWeekdays.includes(weekday)} type="button" onClick={() => onDayToggle(weekday)}>{day.slice(0, 3)}</button>
          {FIELDS.map((field, index) => <div key={field}>
            <button className="business-choice-button business-hours-trigger" aria-pressed={selection?.weekday === weekday && selection.field === field} aria-label={`Edit ${label} ${day} operating hours ${index + 1}`} disabled={!active || disabledWeekdays.includes(weekday)} type="button" onClick={() => setSelection({ weekday, field })}>{hours?.[field] || "Set hours"}</button>
            {hours?.[field] ? <button className="button-secondary icon-button business-hours-clear" aria-label={`Clear ${label} ${day} operating hours ${index + 1}`} disabled={!active || disabledWeekdays.includes(weekday)} type="button" onClick={() => { setSelection(null); onHoursChange(weekday, field, ""); }}><X aria-hidden="true" size={14} /></button> : null}
          </div>)}
        </div>;
      })}
    </div>
  </div>;
}
