"use client";

import { Clock3, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

type TimeRange = {
  endMinutes: number;
  startMinutes: number;
};

type MinuteInterval = TimeRange;

type BusinessTimeRangeSelectorProps = {
  allowedRanges?: string[];
  allowedIntervals?: MinuteInterval[];
  blockedRanges?: string[];
  blockedIntervals?: MinuteInterval[];
  label: string;
  onChange: (value: string) => void;
  value: string;
};

const MINUTES_PER_DAY = 24 * 60;
const STEP_MINUTES = 30;

function parseTime(value: string) {
  const match = value.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!match) return null;

  let hours = Number(match[1]);
  const minutes = Number(match[2]);
  const suffix = match[3].toUpperCase();
  if (hours < 1 || hours > 12 || minutes > 59) return null;
  if (suffix === "PM" && hours < 12) hours += 12;
  if (suffix === "AM" && hours === 12) hours = 0;
  return (hours * 60) + minutes;
}

function parseRange(value: string): TimeRange | null {
  const [startValue, endValue, extra] = value.split(/\s*-\s*/);
  const startMinutes = parseTime(startValue ?? "");
  let endMinutes = parseTime(endValue ?? "");
  if (extra !== undefined || startMinutes === null || endMinutes === null) return null;
  if (endMinutes <= startMinutes) endMinutes += MINUTES_PER_DAY;
  return { endMinutes, startMinutes };
}

function formatTime(minutes: number) {
  const normalizedMinutes = ((minutes % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  const hours24 = Math.floor(normalizedMinutes / 60);
  const displayHours = hours24 % 12 || 12;
  const suffix = hours24 >= 12 ? "PM" : "AM";
  return `${displayHours}:${String(normalizedMinutes % 60).padStart(2, "0")} ${suffix}`;
}

function formatTimelineTime(minutes: number, use24Hour: boolean) {
  const dayOffset = Math.floor(minutes / MINUTES_PER_DAY);
  const minutesOfDay = minutes % MINUTES_PER_DAY;
  const time = use24Hour
    ? `${String(Math.floor(minutesOfDay / 60)).padStart(2, "0")}:${String(minutesOfDay % 60).padStart(2, "0")}`
    : formatTime(minutesOfDay);
  return `${time}${dayOffset ? ` (+${dayOffset} day${dayOffset === 1 ? "" : "s"})` : ""}`;
}

function rangesOverlap(left: TimeRange, right: TimeRange) {
  return [-MINUTES_PER_DAY, 0, MINUTES_PER_DAY].some((offset) => {
    const startMinutes = right.startMinutes + offset;
    const endMinutes = right.endMinutes + offset;
    return left.startMinutes < endMinutes && startMinutes < left.endMinutes;
  });
}

function mergeIntervals(intervals: MinuteInterval[]) {
  const merged: MinuteInterval[] = [];
  for (const interval of [...intervals].sort((first, second) => first.startMinutes - second.startMinutes)) {
    const previous = merged[merged.length - 1];
    if (previous && interval.startMinutes <= previous.endMinutes) {
      previous.endMinutes = Math.max(previous.endMinutes, interval.endMinutes);
    } else {
      merged.push({ ...interval });
    }
  }
  return merged;
}

export function BusinessTimeRangeSelector({ allowedRanges, allowedIntervals, blockedRanges = [], blockedIntervals = [], label, onChange, value }: BusinessTimeRangeSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [firstPoint, setFirstPoint] = useState<number | null>(null);
  const [use24Hour, setUse24Hour] = useState(false);
  const timelineRef = useRef<HTMLDivElement | null>(null);
  const blocked = [...blockedRanges.map(parseRange).filter((range): range is TimeRange => Boolean(range)), ...blockedIntervals];
  const allowed = mergeIntervals([
    ...(allowedRanges?.map(parseRange).filter((range): range is TimeRange => Boolean(range)) ?? []),
    ...(allowedIntervals ?? []),
  ]);
  const savedRange = parseRange(value);
  const points = Array.from({ length: (2 * MINUTES_PER_DAY / STEP_MINUTES) + 1 }, (_, index) => index * STEP_MINUTES);

  useEffect(() => {
    if (isOpen && timelineRef.current) timelineRef.current.scrollLeft = (8 * 60 / STEP_MINUTES) * 42;
  }, [isOpen]);

  function overlapsBlockedRange(startMinutes: number, endMinutes: number) {
    const interval = { endMinutes, startMinutes };
    return blocked.some((range) => rangesOverlap(interval, range));
  }

  function fitsAllowedRange(startMinutes: number, endMinutes: number) {
    if (allowedRanges === undefined && allowedIntervals === undefined) return true;
    return allowed.some((range) => startMinutes >= range.startMinutes && endMinutes <= range.endMinutes);
  }

  function isAllowedStart(minutes: number) {
    if (allowedRanges === undefined && allowedIntervals === undefined) return true;
    return allowed.some((range) => minutes >= range.startMinutes && minutes < range.endMinutes);
  }

  function choosePoint(minutes: number) {
    if (firstPoint === null) {
      if (minutes >= MINUTES_PER_DAY || !isAllowedStart(minutes) || overlapsBlockedRange(minutes, minutes + 1)) return;
      setFirstPoint(minutes);
      return;
    }

    if (minutes <= firstPoint || minutes > firstPoint + MINUTES_PER_DAY) return;
    if (overlapsBlockedRange(firstPoint, minutes) || !fitsAllowedRange(firstPoint, minutes)) return;
    onChange(`${formatTime(firstPoint)} - ${formatTime(minutes % MINUTES_PER_DAY)}`);
    setFirstPoint(null);
    setIsOpen(false);
  }

  return (
    <div className="business-time-selector">
      <div className="business-time-selector-actions">
        <button
          aria-expanded={isOpen}
          className="button-secondary business-time-trigger"
          type="button"
          onClick={() => {
            setFirstPoint(null);
            setIsOpen((current) => !current);
          }}
        >
          <Clock3 aria-hidden="true" size={18} />
          <span>{value || `Set ${label}`}</span>
        </button>
        {value ? (
          <button aria-label={`Clear ${label}`} className="button-secondary icon-button" title={`Clear ${label}`} type="button" onClick={() => onChange("")}>
            <X aria-hidden="true" size={18} />
          </button>
        ) : null}
      </div>

      {isOpen ? (
        <div className="business-time-bar-shell">
          <div className="business-time-bar-tools">
            <strong>{label}</strong>
            <div className="business-time-format" role="group" aria-label="Time display format">
              <button aria-pressed={!use24Hour} type="button" onClick={() => setUse24Hour(false)}>12h</button>
              <button aria-pressed={use24Hour} type="button" onClick={() => setUse24Hour(true)}>24h</button>
            </div>
            <button className="button-secondary" type="button" disabled={firstPoint === null || overlapsBlockedRange(firstPoint, firstPoint + MINUTES_PER_DAY) || !fitsAllowedRange(firstPoint, firstPoint + MINUTES_PER_DAY)} onClick={() => {
              if (firstPoint !== null) choosePoint(firstPoint + MINUTES_PER_DAY);
            }}>24 hours</button>
          </div>
          <div className="business-time-bar" ref={timelineRef} role="group" aria-label={`${label} time range`}>
            {points.map((minutes) => {
              const isHour = minutes % 60 === 0;
              const isNextDay = minutes >= MINUTES_PER_DAY;
              const isBlocked = firstPoint === null
                ? overlapsBlockedRange(minutes, minutes + 1)
                : overlapsBlockedRange(firstPoint, minutes);
              const isOutOfSelection = firstPoint !== null && (minutes <= firstPoint || minutes > firstPoint + MINUTES_PER_DAY);
              const isOutsideAllowed = (allowedRanges !== undefined || allowedIntervals !== undefined) && (firstPoint === null
                ? !isAllowedStart(minutes)
                : !fitsAllowedRange(firstPoint, minutes));
              const isSelected = firstPoint === minutes || (firstPoint === null && Boolean(savedRange && minutes >= savedRange.startMinutes && minutes <= savedRange.endMinutes));
              return (
                <button
                  aria-label={formatTimelineTime(minutes, use24Hour)}
                  aria-pressed={isSelected}
                  className={`business-time-point${isHour ? " is-hour" : " is-half-hour"}${isBlocked ? " is-blocked" : ""}${isSelected ? " is-selected" : ""}${isNextDay ? " is-next-day" : ""}`}
                  disabled={isBlocked || isOutOfSelection || isOutsideAllowed || (firstPoint === null && isNextDay)}
                  key={minutes}
                  type="button"
                  onClick={() => choosePoint(minutes)}
                >
                  <span className="business-time-tick" />
                  {isHour ? <span className="business-time-label">{formatTimelineTime(minutes, use24Hour)}</span> : null}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
