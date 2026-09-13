"use client";

import type { AppointmentDateHoursOverride, AppointmentLocation, AppointmentLocationHoursOverride } from "@trapit/testing";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";

import { BusinessTimeRangeSelector } from "./business-time-range-selector";

type DateOverrides = {
  closedDateKeys: string[];
  openedDateKeys: string[];
};

type BusinessDateExceptionCalendarProps = {
  dateHoursOverrides: AppointmentDateHoursOverride[];
  locations: AppointmentLocation[];
  onChange: (value: DateOverrides) => void;
  onDateHoursOverridesChange: (value: AppointmentDateHoursOverride[]) => void;
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

function updateDateLocationHours(
  value: AppointmentDateHoursOverride[],
  selectedDateKey: string,
  locationId: string,
  update: Partial<AppointmentLocationHoursOverride> | null,
) {
  const existing = value.find((entry) => entry.dateKey === selectedDateKey);
  const locations = existing?.locations ?? [];
  const nextLocations = update === null
    ? locations.filter((entry) => entry.locationId !== locationId)
    : locations.some((entry) => entry.locationId === locationId)
      ? locations.map((entry) => entry.locationId === locationId ? { ...entry, ...update } : entry)
      : [...locations, { locationId, workingHours: "", workingHoursSecondWindow: "", ...update }];

  if (!nextLocations.length) {
    return value.filter((entry) => entry.dateKey !== selectedDateKey);
  }

  return existing
    ? value.map((entry) => entry.dateKey === selectedDateKey ? { ...entry, locations: nextLocations } : entry)
    : [...value, { dateKey: selectedDateKey, locations: nextLocations }];
}

export function BusinessDateExceptionCalendar({
  dateHoursOverrides,
  locations,
  onChange,
  onDateHoursOverridesChange,
  value,
  workingDays,
}: BusinessDateExceptionCalendarProps) {
  const [weekOffset, setWeekOffset] = useState(0);
  const [selectedDateKey, setSelectedDateKey] = useState<string | null>(null);
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
      const willClose = !isClosed;
      onChange({
        closedDateKeys: willClose ? [...value.closedDateKeys, key] : value.closedDateKeys.filter((entry) => entry !== key),
        openedDateKeys: value.openedDateKeys.filter((entry) => entry !== key),
      });
      if (willClose) {
        onDateHoursOverridesChange(dateHoursOverrides.filter((entry) => entry.dateKey !== key));
        setSelectedDateKey((current) => current === key ? null : current);
      }
      return;
    }

    const willOpen = !isOpened;
    onChange({
      closedDateKeys: value.closedDateKeys.filter((entry) => entry !== key),
      openedDateKeys: willOpen ? [...value.openedDateKeys, key] : value.openedDateKeys.filter((entry) => entry !== key),
    });
    if (willOpen) {
      setSelectedDateKey(key);
    } else {
      onDateHoursOverridesChange(dateHoursOverrides.filter((entry) => entry.dateKey !== key));
      setSelectedDateKey((current) => current === key ? null : current);
    }
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
      {selectedDateKey && value.openedDateKeys.includes(selectedDateKey) ? (
        <div className="form-stack business-leave-date-editor">
          <strong>Custom hours for {selectedDateKey}</strong>
          {locations.map((location) => {
            const hours = dateHoursOverrides
              .find((entry) => entry.dateKey === selectedDateKey)
              ?.locations.find((entry) => entry.locationId === location.id);
            return (
              <div className="business-leave-location" key={location.id}>
                <label className="checkbox-row">
                  <input
                    checked={Boolean(hours)}
                    type="checkbox"
                    onChange={(event) => onDateHoursOverridesChange(updateDateLocationHours(
                      dateHoursOverrides,
                      selectedDateKey,
                      location.id,
                      event.target.checked ? { workingHours: "", workingHoursSecondWindow: "" } : null,
                    ))}
                  />
                  <span>{location.name}</span>
                </label>
                {hours ? (
                  <div className="form-stack">
                    <BusinessTimeRangeSelector
                      label={`${location.name} leave-day hours`}
                      value={hours.workingHours}
                      onChange={(workingHours) => onDateHoursOverridesChange(updateDateLocationHours(
                        dateHoursOverrides,
                        selectedDateKey,
                        location.id,
                        { workingHours },
                      ))}
                    />
                    <BusinessTimeRangeSelector
                      blockedRanges={hours.workingHours ? [hours.workingHours] : []}
                      label={`${location.name} leave-day hours 2`}
                      value={hours.workingHoursSecondWindow}
                      onChange={(workingHoursSecondWindow) => onDateHoursOverridesChange(updateDateLocationHours(
                        dateHoursOverrides,
                        selectedDateKey,
                        location.id,
                        { workingHoursSecondWindow },
                      ))}
                    />
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}
      <p className="muted-text">Mark leave dates by de-selecting working dates</p>
    </div>
  );
}
