"use client";

import { Clock3, X } from "lucide-react";
import { useState } from "react";

type TimeRange = {
  endMinutes: number;
  startMinutes: number;
};

type BusinessTimeRangeSelectorProps = {
  blockedRanges?: string[];
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

function formatHour(minutes: number) {
  return formatTime(minutes).replace(":00", "");
}

function rangesOverlap(left: TimeRange, right: TimeRange) {
  const rightCandidates = [right, { startMinutes: right.startMinutes + MINUTES_PER_DAY, endMinutes: right.endMinutes + MINUTES_PER_DAY }];
  return rightCandidates.some((candidate) => left.startMinutes < candidate.endMinutes && candidate.startMinutes < left.endMinutes);
}

export function BusinessTimeRangeSelector({ blockedRanges = [], label, onChange, value }: BusinessTimeRangeSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [firstPoint, setFirstPoint] = useState<number | null>(null);
  const blocked = blockedRanges.map(parseRange).filter((range): range is TimeRange => Boolean(range));
  const points = Array.from({ length: (MINUTES_PER_DAY / STEP_MINUTES) + 1 }, (_, index) => index * STEP_MINUTES);

  function choosePoint(minutes: number) {
    if (firstPoint === null) {
      setFirstPoint(minutes);
      return;
    }

    if (firstPoint === minutes) return;
    const range = {
      endMinutes: Math.max(firstPoint, minutes),
      startMinutes: Math.min(firstPoint, minutes),
    };

    if (blocked.some((blockedRange) => rangesOverlap(range, blockedRange))) return;

    onChange(`${formatTime(range.startMinutes)} - ${formatTime(range.endMinutes)}`);
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
          <p className="muted-text">{firstPoint === null ? "Select the first time." : "Select the second time."}</p>
          <div className="business-time-bar" role="group" aria-label={`${label} time range`}>
            {points.map((minutes) => {
              const isHour = minutes % 60 === 0;
              const isBlocked = blocked.some((range) => minutes > range.startMinutes && minutes < range.endMinutes);
              const isSelected = firstPoint === minutes;
              return (
                <button
                  aria-label={formatTime(minutes)}
                  aria-pressed={isSelected}
                  className={`business-time-point${isHour ? " is-hour" : " is-half-hour"}${isBlocked ? " is-blocked" : ""}${isSelected ? " is-selected" : ""}`}
                  disabled={isBlocked}
                  key={minutes}
                  type="button"
                  onClick={() => choosePoint(minutes)}
                >
                  <span className="business-time-tick" />
                  {isHour ? <span className="business-time-label">{formatHour(minutes)}</span> : null}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
