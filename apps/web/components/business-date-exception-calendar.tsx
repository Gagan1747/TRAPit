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
  const [monthOffset, setMonthOffset] = useState(0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const month = new Date(today.getFullYear(), today.getMonth() + monthOffset, 1);
  const lastDay = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const maxDate = new Date(today.getFullYear(), today.getMonth() + 6, today.getDate());
  const workingDayIndexes = parseWorkingDays(workingDays);
  const cells = [
    ...Array.from({ length: month.getDay() }, () => null),
    ...Array.from({ length: lastDay }, (_, index) => new Date(month.getFullYear(), month.getMonth(), index + 1)),
  ];

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
        <button aria-label="Previous month" className="button-secondary icon-button" disabled={monthOffset === 0} type="button" onClick={() => setMonthOffset((current) => Math.max(0, current - 1))}>
          <ChevronLeft aria-hidden="true" size={18} />
        </button>
        <strong>{month.toLocaleDateString(undefined, { month: "long", year: "numeric" })}</strong>
        <button aria-label="Next month" className="button-secondary icon-button" disabled={monthOffset === 6} type="button" onClick={() => setMonthOffset((current) => Math.min(6, current + 1))}>
          <ChevronRight aria-hidden="true" size={18} />
        </button>
      </div>
      <div className="business-exception-weekdays" aria-hidden="true">
        {WEEKDAYS.map((day) => <span key={day}>{day.slice(0, 2)}</span>)}
      </div>
      <div className="business-exception-grid">
        {cells.map((date, index) => {
          if (!date) return <span key={`blank-${index}`} />;
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
              {date.getDate()}
            </button>
          );
        })}
      </div>
      <p className="muted-text">Highlighted dates are working days. Select a date to open or close it for the whole business.</p>
    </div>
  );
}
