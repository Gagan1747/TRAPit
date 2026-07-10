"use client";

import { useEffect, useState } from "react";

const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const WEEKDAY_SHORT_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

type BookingPayload = {
  business: {
    advanceBookingWeeks: number;
    appointmentsPerSlot: number;
    imageDataUrl: string | null;
    name: string;
    slotDurationMinutes: number | null;
    workingDays: string;
    workingHours: string;
    workingHoursSecondWindow: string;
  };
  slotCounts: Array<{ count: number; startsAt: string }>;
};

type CalendarCell =
  | { date: Date; key: string; type: "date" }
  | { key: string; type: "blank" };

async function readJson<T>(response: Response): Promise<T> {
  const payload = (await response.json()) as T & { error?: string };

  if (!response.ok) {
    throw new Error(payload.error ?? "Request failed.");
  }

  return payload;
}

function createDateKey(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function createDateFromKey(value: string) {
  const [year, month, day] = value.split("-").map((part) => Number.parseInt(part, 10));

  return new Date(year, month - 1, day);
}

function formatTime(minutes: number) {
  const hours24 = Math.floor(minutes / 60);
  const displayHour = hours24 % 12 || 12;
  const displayMinutes = String(minutes % 60).padStart(2, "0");
  const suffix = hours24 >= 12 ? "PM" : "AM";

  return `${displayHour}:${displayMinutes} ${suffix}`;
}

function parseTimeToMinutes(value: string) {
  const match = value.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?$/i);

  if (!match) {
    return null;
  }

  let hours = Number.parseInt(match[1], 10);
  const minutes = Number.parseInt(match[2] ?? "0", 10);
  const suffix = match[3]?.toUpperCase();

  if (!Number.isFinite(hours) || !Number.isFinite(minutes) || minutes > 59) {
    return null;
  }

  if (suffix === "PM" && hours < 12) {
    hours += 12;
  }

  if (suffix === "AM" && hours === 12) {
    hours = 0;
  }

  return hours * 60 + minutes;
}

function parseTimeRange(value: string) {
  const [startValue, endValue] = value.split(/\s*-\s*/);
  const startMinutes = parseTimeToMinutes(startValue ?? "");
  const endMinutes = parseTimeToMinutes(endValue ?? "");

  return startMinutes === null || endMinutes === null || startMinutes >= endMinutes
    ? null
    : { endMinutes, startMinutes };
}

function parseWorkingDays(value: string) {
  const normalizedValue = value.toLowerCase();

  if (!normalizedValue.trim()) {
    return new Set(WEEKDAY_NAMES);
  }

  return new Set(WEEKDAY_NAMES.filter((day) => normalizedValue.includes(day.toLowerCase()) || normalizedValue.includes(day.slice(0, 3).toLowerCase())));
}

function isSameDay(left: Date, right: Date) {
  return left.getFullYear() === right.getFullYear()
    && left.getMonth() === right.getMonth()
    && left.getDate() === right.getDate();
}

function createSlotIso(dateKey: string, minutes: number) {
  const date = createDateFromKey(dateKey);
  date.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);

  return date.toISOString();
}

function normalizeImageDataUrl(value: string) {
  if (!value.startsWith("data:image/svg+xml,")) {
    return value;
  }

  const [, svgText = ""] = value.split(",");

  try {
    return `data:image/svg+xml,${encodeURIComponent(decodeURIComponent(svgText))}`;
  } catch {
    return `data:image/svg+xml,${encodeURIComponent(svgText)}`;
  }
}

function createCalendarCells(startDate: Date, endDate: Date): CalendarCell[] {
  const cells: CalendarCell[] = [];
  const cursor = new Date(startDate);
  cursor.setHours(0, 0, 0, 0);
  const lastDate = new Date(endDate);
  lastDate.setHours(0, 0, 0, 0);
  let currentRowMonth: number | null = null;
  let cellsInRow = 0;

  while (cursor <= lastDate) {
    const cursorMonth = cursor.getMonth();

    if (cellsInRow === 0) {
      currentRowMonth = cursorMonth;

      for (let index = 0; index < cursor.getDay(); index += 1) {
        cells.push({ key: `blank-${createDateKey(cursor)}-${index}`, type: "blank" });
        cellsInRow += 1;
      }
    }

    if (currentRowMonth !== cursorMonth) {
      while (cellsInRow < 7) {
        cells.push({ key: `blank-month-end-${createDateKey(cursor)}-${cellsInRow}`, type: "blank" });
        cellsInRow += 1;
      }

      cellsInRow = 0;
      currentRowMonth = cursorMonth;

      for (let index = 0; index < cursor.getDay(); index += 1) {
        cells.push({ key: `blank-month-start-${createDateKey(cursor)}-${index}`, type: "blank" });
        cellsInRow += 1;
      }
    }

    cells.push({ date: new Date(cursor), key: createDateKey(cursor), type: "date" });
    cellsInRow += 1;

    if (cellsInRow === 7) {
      cellsInRow = 0;
      currentRowMonth = null;
    }

    cursor.setDate(cursor.getDate() + 1);
  }

  if (cellsInRow > 0) {
    while (cellsInRow < 7) {
      cells.push({ key: `blank-final-${cellsInRow}`, type: "blank" });
      cellsInRow += 1;
    }
  }

  return cells;
}

type PublicApportionBookingWorkspaceProps = {
  shareCode: string;
};

export function PublicApportionBookingWorkspace({ shareCode }: PublicApportionBookingWorkspaceProps) {
  const [feedback, setFeedback] = useState<string | null>(null);
  const [isBooking, setIsBooking] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [notes, setNotes] = useState("");
  const [payload, setPayload] = useState<BookingPayload | null>(null);
  const [selectedDateKey, setSelectedDateKey] = useState(createDateKey(new Date()));
  const [selectedSlotIso, setSelectedSlotIso] = useState<string | null>(null);

  async function loadBookingPage() {
    setIsLoading(true);

    try {
      const nextPayload = await readJson<BookingPayload>(
        await fetch(`/api/apportion/${encodeURIComponent(shareCode)}`),
      );
      setPayload(nextPayload);
      setSelectedSlotIso(null);
      setFeedback(null);
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Unable to load this booking page.");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void loadBookingPage();
  }, [shareCode]);

  useEffect(() => {
    if (!payload) {
      return;
    }

    const workingDays = parseWorkingDays(payload.business.workingDays);
    const today = new Date();
    const nextWorkingDate = Array.from({ length: 28 }, (_, offset) => {
      const date = new Date(today);
      date.setDate(today.getDate() + offset);
      return date;
    }).find((date) => {
      const maxDate = new Date(today);
      maxDate.setDate(today.getDate() + (payload.business.advanceBookingWeeks * 7) - 1);

      return workingDays.has(WEEKDAY_NAMES[date.getDay()]) && date <= maxDate;
    });

    if (nextWorkingDate) {
      setSelectedDateKey(createDateKey(nextWorkingDate));
    }
  }, [payload]);

  async function handleBookAppointment() {
    const selectedSlot = availableSlots.find((slot) => slot.startsAt === selectedSlotIso) ?? null;

    if (!selectedSlot) {
      setFeedback("Choose an appointment date and time.");
      return;
    }

    setIsBooking(true);

    try {
      await readJson(
        await fetch(`/api/apportion/${encodeURIComponent(shareCode)}`, {
          body: JSON.stringify({
            slotDateKey: selectedDateKey,
            slotMinutes: selectedSlot.minutes,
            notes,
            startsAt: selectedSlot.startsAt,
          }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        }),
      );
      setFeedback("Appointment booked. You can see it in the Apportion tab on your dashboard.");
      setNotes("");
      setSelectedSlotIso(null);
      await loadBookingPage();
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Unable to book the appointment.");
    } finally {
      setIsBooking(false);
    }
  }

  if (isLoading) {
    return <div className="empty-state"><p className="muted-text">Loading appointment page...</p></div>;
  }

  if (!payload) {
    return <div className="empty-state"><p className="muted-text">{feedback ?? "Unable to load this appointment page."}</p></div>;
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const workingDays = parseWorkingDays(payload.business.workingDays);
  const workingRanges = [payload.business.workingHours, payload.business.workingHoursSecondWindow]
    .map((range) => parseTimeRange(range))
    .filter((range): range is { endMinutes: number; startMinutes: number } => Boolean(range));
  const effectiveWorkingRanges = workingRanges.length ? workingRanges : [{ endMinutes: 18 * 60, startMinutes: 10 * 60 }];
  const slotDurationMinutes = payload.business.slotDurationMinutes ?? 30;
  const slotStepMinutes = slotDurationMinutes === 60 ? 30 : 15;
  const slotCountsByIso = Object.fromEntries(payload.slotCounts.map((slot) => [slot.startsAt, slot.count]));
  const maxBookableDate = new Date(today);
  maxBookableDate.setDate(today.getDate() + (payload.business.advanceBookingWeeks * 7) - 1);
  const calendarCells = createCalendarCells(today, maxBookableDate);
  const workingHoursText = [payload.business.workingHours, payload.business.workingHoursSecondWindow].filter(Boolean).join(" and ");
  const availableSlots = effectiveWorkingRanges.flatMap((range) => Array.from(
    { length: Math.max(0, Math.floor((range.endMinutes - range.startMinutes - slotDurationMinutes) / slotStepMinutes) + 1) },
    (_, index) => range.startMinutes + (index * slotStepMinutes),
  )).map((minutes) => {
    const startsAt = createSlotIso(selectedDateKey, minutes);
    const slotDate = new Date(startsAt);
    const isPast = slotDate.getTime() <= Date.now();
    const isFull = (slotCountsByIso[startsAt] ?? 0) >= payload.business.appointmentsPerSlot;

    return {
      isAvailable: !isPast && !isFull,
      label: formatTime(minutes),
      minutes,
      startsAt,
    };
  });
  const selectedSlot = availableSlots.find((slot) => slot.startsAt === selectedSlotIso) ?? null;
  const logoDataUrl = payload.business.imageDataUrl ? normalizeImageDataUrl(payload.business.imageDataUrl) : null;

  return (
    <div className="workspace-card-stack">
      <section className="workspace-card apportion-booking-hero">
        {logoDataUrl ? (
          <img alt="Business logo" className="apportion-business-logo" src={logoDataUrl} />
        ) : null}
        <div className="apportion-booking-title-block">
          <p className="eyebrow">Apportion booking</p>
          <h1>{payload.business.name || "Business appointment"}</h1>
        </div>
      </section>

      <section className="workspace-card apportion-booking-panel">
        <p className="eyebrow">Choose appointment</p>
        <div className="apportion-booking-grid">
          <div className="apportion-calendar" aria-label="Appointment calendar">
            {WEEKDAY_SHORT_NAMES.map((dayName) => (
              <span className="apportion-calendar-weekday" key={dayName}>{dayName}</span>
            ))}
            {calendarCells.map((cell) => {
              if (cell.type === "blank") {
                return <span aria-hidden="true" className="apportion-calendar-blank" key={cell.key} />;
              }

              const date = cell.date;
              const dateKey = createDateKey(date);
              const isWorkingDay = workingDays.has(WEEKDAY_NAMES[date.getDay()]);
              const isPastDate = date < today;
              const isWithinAdvanceBooking = date <= maxBookableDate;
              const isSelected = dateKey === selectedDateKey;
              const isAvailableDate = isWorkingDay && !isPastDate && isWithinAdvanceBooking;
              const isAlternateMonth = date.getMonth() !== today.getMonth();

              return (
                <button
                  className={`apportion-calendar-day${isAvailableDate ? " is-working" : ""}${isSelected ? " is-selected" : ""}${isAlternateMonth ? " is-next-month" : ""}`}
                  disabled={!isAvailableDate}
                  key={dateKey}
                  type="button"
                  onClick={() => {
                    setSelectedDateKey(dateKey);
                    setSelectedSlotIso(null);
                  }}
                >
                  <strong>{date.getDate()}</strong>
                  {isSameDay(date, new Date()) ? <small>Today</small> : null}
                </button>
              );
            })}
            <p className="muted-text apportion-calendar-note">Available dates are highlighted for the next {payload.business.advanceBookingWeeks} week{payload.business.advanceBookingWeeks === 1 ? "" : "s"}.</p>
          </div>
          <div className="form-stack apportion-booking-form">
            <div className="field">
              <label htmlFor="apportion-appointment-time">Appointment time</label>
              <p className="muted-text apportion-working-hours">Working hours: {workingHoursText || "Not specified"}</p>
              <select
                className="select-field"
                id="apportion-appointment-time"
                value={selectedSlotIso ?? ""}
                onChange={(event) => {
                  setSelectedSlotIso(event.target.value || null);
                  setFeedback(null);
                }}
              >
                <option value="">Select a time</option>
                {availableSlots.map((slot) => (
                  <option disabled={!slot.isAvailable} key={slot.startsAt} value={slot.startsAt}>
                    {slot.label} - {slot.isAvailable ? "Available" : "Unavailable"}
                  </option>
                ))}
              </select>
              <p className="muted-text">{selectedSlot ? `${selectedSlot.label} selected` : "Filled slots are greyed out in the list."}</p>
            </div>
            <div className="field">
              <label htmlFor="apportion-notes">Notes</label>
              <textarea
                id="apportion-notes"
                placeholder="Share a brief about appointment purpose"
                rows={3}
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
              />
            </div>
            {feedback ? <p className="muted-text">{feedback}</p> : null}
            <div className="inline-actions">
              <button className="button" disabled={isBooking} type="button" onClick={() => void handleBookAppointment()}>
                {isBooking ? "Booking..." : "Book appointment"}
              </button>
              <a className="button-secondary" href="/user?tab=apportion">Open my dashboard</a>
            </div>
          </div>
        </div>
      </section>

    </div>
  );
}