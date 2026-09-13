"use client";

import type {
  AppointmentLocation,
  AppointmentLocationHoursOverride,
  AppointmentWeeklyHoursOverride,
} from "@trapit/testing";

import { BusinessTimeRangeSelector } from "./business-time-range-selector";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function worksOnWeekday(location: AppointmentLocation, weekday: number) {
  const normalized = location.workingDays.toLowerCase();
  const day = WEEKDAYS[weekday];
  return normalized.includes(day.toLowerCase()) || normalized.includes(day.slice(0, 3).toLowerCase());
}

type BusinessLeaveHoursEditorProps = {
  locations: AppointmentLocation[];
  onChange: (value: AppointmentWeeklyHoursOverride[]) => void;
  value: AppointmentWeeklyHoursOverride[];
};

function updateLocationHours(
  value: AppointmentWeeklyHoursOverride[],
  weekday: number,
  locationId: string,
  update: Partial<AppointmentLocationHoursOverride> | null,
) {
  const existing = value.find((entry) => entry.weekday === weekday);
  const locations = existing?.locations ?? [];
  const nextLocations = update === null
    ? locations.filter((entry) => entry.locationId !== locationId)
    : locations.some((entry) => entry.locationId === locationId)
      ? locations.map((entry) => entry.locationId === locationId ? { ...entry, ...update } : entry)
      : [...locations, { locationId, workingHours: "", workingHoursSecondWindow: "", ...update }];

  if (!nextLocations.length) {
    return value.filter((entry) => entry.weekday !== weekday);
  }

  return existing
    ? value.map((entry) => entry.weekday === weekday ? { ...entry, locations: nextLocations } : entry)
    : [...value, { locations: nextLocations, weekday }];
}

export function BusinessLeaveHoursEditor({ locations, onChange, value }: BusinessLeaveHoursEditorProps) {
  return (
    <div className="form-stack business-leave-hours-editor">
      <p className="muted-text">Set recurring hours for weekly off days. These hours are separate from regular operating hours.</p>
      {WEEKDAYS.map((weekdayName, weekday) => {
        const override = value.find((entry) => entry.weekday === weekday);

        if (!override && locations.every((location) => worksOnWeekday(location, weekday))) {
          return null;
        }

        return (
          <details className="business-leave-day" key={weekdayName} open={Boolean(override)}>
            <summary>{weekdayName}</summary>
            <div className="form-stack">
              {locations.map((location) => {
                const hours = override?.locations.find((entry) => entry.locationId === location.id);
                const isRegularWorkingDay = worksOnWeekday(location, weekday);
                return (
                  <div className="business-leave-location" key={location.id}>
                    <label className="checkbox-row">
                      <input
                        checked={Boolean(hours)}
                        disabled={isRegularWorkingDay && !hours}
                        type="checkbox"
                        onChange={(event) => onChange(updateLocationHours(
                          value,
                          weekday,
                          location.id,
                          event.target.checked ? { workingHours: "", workingHoursSecondWindow: "" } : null,
                        ))}
                      />
                      <span>{location.name}{isRegularWorkingDay ? " (regular working day)" : ""}</span>
                    </label>
                    {hours ? (
                      <div className="form-stack">
                        <BusinessTimeRangeSelector
                          label={`${weekdayName} ${location.name} leave-day hours`}
                          value={hours.workingHours}
                          onChange={(workingHours) => onChange(updateLocationHours(value, weekday, location.id, { workingHours }))}
                        />
                        <BusinessTimeRangeSelector
                          blockedRanges={hours.workingHours ? [hours.workingHours] : []}
                          label={`${weekdayName} ${location.name} leave-day hours 2`}
                          value={hours.workingHoursSecondWindow}
                          onChange={(workingHoursSecondWindow) => onChange(updateLocationHours(value, weekday, location.id, { workingHoursSecondWindow }))}
                        />
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </details>
        );
      })}
    </div>
  );
}
