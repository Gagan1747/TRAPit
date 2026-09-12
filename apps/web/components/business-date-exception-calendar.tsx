"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";

type DateOverrides = {
  closedDateKeys: string[];
  openedDateKeys: string[];
};

type BusinessDateExceptionCalendarProps = {
  onChange: (value: DateOverrides) => void;
  value: DateOverrides;
  workingDays: string;
};

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function dateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function parseWorkingDays(value: string) {
  const normalized = value.toLowerCase();
  return new Set(WEEKDAYS.flatMap((day, index) =>
    normalized.includes(day.toLowerCase()) || normalized.includes(day.slice(0, 3).toLowerCase()) ? [index] : [],
  ));
}

export function BusinessDateExceptionCalendar({ onChange, value, workingDays }: BusinessDateExceptionCalendarProps) {
  const [weekOffset, setWeekOffset] = useState(0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const maxDate = new Date(today.getFullYear(), today.getMonth() + 6, today.getDate());
  const workingDayIndexes = parseWorkingDays(workingDays);
  const weekStartDate = new Date(today);
  weekStartDate.setDate(today.getDate() + (weekOffset * 7));
  const dates = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(weekStartDate);
    date.setDate(weekStartDate.getDate() + index);
    return date;
  });
  const nextWeekStart = new Date(weekStartDate);
  nextWeekStart.setDate(weekStartDate.getDate() + 7);
  const rangeLabel = `${dates[0].toLocaleDateString(undefined, { day: "numeric", month: "short" })} - ${dates[6].toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}`;

  function toggleDate(date: Date) {
    const key = dateKey(date);
    const isBaselineActive = workingDayIndexes.has(date.getDay());
    const isClosed = value.closedDateKeys.includes(key);
    const isOpened = value.openedDateKeys.includes(key);

    if (isBaselineActive) {
      onChange({
        closedDateKeys: isClosed ? value.closedDateKeys.filter((entry) => entry !== key) : [...value.closedDateKeys, key],
        openedDateKeys: value.openedDateKeys.filter((entry) => entry !== key),
      });
      return;
    }

    onChange({
      closedDateKeys: value.closedDateKeys.filter((entry) => entry !== key),
      openedDateKeys: isOpened ? value.openedDateKeys.filter((entry) => entry !== key) : [...value.openedDateKeys, key],
    });
  }

  return (
    <div className="business-exception-calendar">
      <div className="business-exception-calendar-head">
        <button aria-label="Previous week" className="button-secondary icon-button" disabled={weekOffset === 0} type="button" onClick={() => setWeekOffset((current) => Math.max(0, current - 1))}>
          <ChevronLeft aria-hidden="true" size={18} />
        </button>
        <strong>{rangeLabel}</strong>
        <button aria-label="Next week" className="button-secondary icon-button" disabled={nextWeekStart > maxDate} type="button" onClick={() => setWeekOffset((current) => current + 1)}>
          <ChevronRight aria-hidden="true" size={18} />
        </button>
      </div>
      <div className="business-exception-grid">
        {dates.map((date) => {
          const key = dateKey(date);
          const isBaselineActive = workingDayIndexes.has(date.getDay());
          const isClosed = value.closedDateKeys.includes(key);
          const isOpened = value.openedDateKeys.includes(key);
          const isActive = (isBaselineActive && !isClosed) || isOpened;
          const isDisabled = date < today || date > maxDate;
          return (
            <button
              aria-label={`${date.toLocaleDateString()} ${isActive ? "working" : "non-working"}`}
              aria-pressed={isActive}
              className={`business-exception-date${isActive ? " is-active" : " is-inactive"}${isClosed ? " is-closed" : ""}${isOpened ? " is-opened" : ""}`}
              disabled={isDisabled}
              key={key}
              type="button"
              onClick={() => toggleDate(date)}
            >
              <span>{WEEKDAYS[date.getDay()].slice(0, 3)}</span>
              <strong>{date.getDate()}</strong>
            </button>
          );
        })}
      </div>
      <p className="muted-text">Highlighted dates are working days. Select a date to open or close it for the whole business.</p>
    </div>
  );
}
