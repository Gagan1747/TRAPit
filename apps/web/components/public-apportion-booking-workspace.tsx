"use client";

import { useEffect, useState } from "react";

import { formatPhoneNumberForDisplay } from "../lib/privacy";
import { BrowserPushPrompt, markNotificationPromptOpportunity } from "./browser-push-prompt";

const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const WEEKDAY_SHORT_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

type BookingPayload = {
  business: {
    address: string;
    advanceBookingWeeks: number;
    appointmentNotesPrompt: string;
    appointmentsPerSlot: number;
    imageDataUrl: string | null;
    justAddToList: boolean;
    name: string;
    ownerIdentifier: string;
    profileImageDataUrl: string | null;
    showRemainingBookings: boolean;
    slotDurationMinutes: number | null;
    workingDays: string;
    workingHours: string;
    workingHoursSecondWindow: string;
  };
  queueCounts: Array<{ count: number; dateKey: string }>;
  slotCounts: Array<{ count: number; startsAt: string }>;
};

type BookingResponse = {
  appointment: { id: string };
  caution: string | null;
};

type CalendarCell =
  | { key: string; label: string; type: "month" }
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

  if (startMinutes === null || endMinutes === null) {
    return null;
  }

  if (startMinutes === endMinutes) {
    return { durationMinutes: 24 * 60, startMinutes };
  }

  if (startMinutes < endMinutes) {
    return { durationMinutes: endMinutes - startMinutes, startMinutes };
  }

  return { durationMinutes: (24 * 60) - startMinutes + endMinutes, startMinutes };
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

function getSlotStepMinutes(slotDurationMinutes: number) {
  return slotDurationMinutes <= 60 ? 15 : slotDurationMinutes;
}

function buildSlotStartsForDate(input: {
  selectedDateKey: string;
  slotDurationMinutes: number;
  workingHours: string;
  workingHoursSecondWindow: string;
}) {
  const workingRanges = [input.workingHours, input.workingHoursSecondWindow]
    .map((range) => parseTimeRange(range))
    .filter((range): range is { durationMinutes: number; startMinutes: number } => Boolean(range));
  const effectiveWorkingRanges = workingRanges.length ? workingRanges : [{ durationMinutes: 8 * 60, startMinutes: 10 * 60 }];
  const slotStepMinutes = getSlotStepMinutes(input.slotDurationMinutes);

  return effectiveWorkingRanges.flatMap((range) => Array.from(
    { length: Math.max(0, Math.floor((range.durationMinutes - input.slotDurationMinutes) / slotStepMinutes) + 1) },
    (_, index) => {
      const absoluteMinutes = range.startMinutes + (index * slotStepMinutes);
      const dayOffset = Math.floor(absoluteMinutes / (24 * 60));
      const minutesOfDay = ((absoluteMinutes % (24 * 60)) + (24 * 60)) % (24 * 60);
      const slotDate = createDateFromKey(input.selectedDateKey);
      slotDate.setDate(slotDate.getDate() + dayOffset);
      slotDate.setHours(Math.floor(minutesOfDay / 60), minutesOfDay % 60, 0, 0);

      return {
        dayOffset,
        label: `${formatTime(minutesOfDay)}${dayOffset > 0 ? ` (+${dayOffset} day${dayOffset === 1 ? "" : "s"})` : ""}`,
        minutes: minutesOfDay,
        startsAt: slotDate.toISOString(),
      };
    },
  ));
}

function estimateQueueStart(input: {
  activeCount: number;
  appointmentsPerSlot: number;
  selectedDateKey: string;
  slotDurationMinutes: number;
  workingHours: string;
  workingHoursSecondWindow: string;
}) {
  const slotStarts = buildSlotStartsForDate({
    selectedDateKey: input.selectedDateKey,
    slotDurationMinutes: input.slotDurationMinutes,
    workingHours: input.workingHours,
    workingHoursSecondWindow: input.workingHoursSecondWindow,
  });
  const slotIndex = Math.floor(input.activeCount / Math.max(1, input.appointmentsPerSlot));

  if (!slotStarts.length) {
    const fallbackDate = createDateFromKey(input.selectedDateKey);
    fallbackDate.setHours(10, 0, 0, 0);
    fallbackDate.setMinutes(fallbackDate.getMinutes() + (slotIndex * input.slotDurationMinutes));

    return {
      exceedsWorkingHours: slotIndex > 0,
      label: formatTime(fallbackDate.getHours() * 60 + fallbackDate.getMinutes()),
      startsAt: fallbackDate.toISOString(),
    };
  }

  if (slotIndex < slotStarts.length) {
    return {
      exceedsWorkingHours: false,
      label: slotStarts[slotIndex].label,
      startsAt: slotStarts[slotIndex].startsAt,
    };
  }

  const overflowDate = new Date(slotStarts[slotStarts.length - 1].startsAt);
  overflowDate.setMinutes(overflowDate.getMinutes() + ((slotIndex - (slotStarts.length - 1)) * input.slotDurationMinutes));

  return {
    exceedsWorkingHours: true,
    label: `${formatTime(overflowDate.getHours() * 60 + overflowDate.getMinutes())}${createDateKey(overflowDate) !== input.selectedDateKey ? " (+1 day)" : ""}`,
    startsAt: overflowDate.toISOString(),
  };
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
  const emittedMonthKeys = new Set<string>();
  let currentRowMonth: number | null = null;
  let cellsInRow = 0;

  while (cursor <= lastDate) {
    const cursorMonth = cursor.getMonth();
    const cursorMonthKey = `${cursor.getFullYear()}-${cursorMonth}`;
    const monthLabel = cursor.toLocaleDateString(undefined, { month: "long", year: "numeric" });

    if (cellsInRow === 0) {
      if (!emittedMonthKeys.has(cursorMonthKey)) {
        cells.push({ key: `month-${createDateKey(cursor)}`, label: monthLabel, type: "month" });
        emittedMonthKeys.add(cursorMonthKey);
      }

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

      if (!emittedMonthKeys.has(cursorMonthKey)) {
        cells.push({ key: `month-${createDateKey(cursor)}`, label: monthLabel, type: "month" });
        emittedMonthKeys.add(cursorMonthKey);
      }

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
    if (!payload) {
      setFeedback("Unable to load this booking page.");
      return;
    }

    const selectedSlot = availableSlots.find((slot) => slot.startsAt === selectedSlotIso) ?? null;

    if (!payload.business.justAddToList && !selectedSlot) {
      setFeedback("Choose an appointment date and time.");
      return;
    }

    setIsBooking(true);

    try {
      const bookingPayload = await readJson<BookingResponse>(
        await fetch(`/api/apportion/${encodeURIComponent(shareCode)}`, {
          body: JSON.stringify({
            slotDateKey: selectedDateKey,
            notes,
            startsAt: selectedSlot?.startsAt,
          }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        }),
      );
      setFeedback(bookingPayload.caution
        ? `Appointment booked. ${bookingPayload.caution}`
        : "Appointment booked. You can see it in the Apportion tab on your dashboard.");
      markNotificationPromptOpportunity();
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
  const slotDurationMinutes = payload.business.slotDurationMinutes ?? 30;
  const slotCountsByIso = Object.fromEntries(payload.slotCounts.map((slot) => [slot.startsAt, slot.count]));
  const queueCountsByDateKey = Object.fromEntries(payload.queueCounts.map((slot) => [slot.dateKey, slot.count]));
  const maxBookableDate = new Date(today);
  maxBookableDate.setDate(today.getDate() + (payload.business.advanceBookingWeeks * 7) - 1);
  const calendarCells = createCalendarCells(today, maxBookableDate);
  const workingHoursText = [payload.business.workingHours, payload.business.workingHoursSecondWindow].filter(Boolean).join(" and ");
  const availableSlots = buildSlotStartsForDate({
    selectedDateKey,
    slotDurationMinutes,
    workingHours: payload.business.workingHours,
    workingHoursSecondWindow: payload.business.workingHoursSecondWindow,
  }).map((slot) => {
    const startsAt = slot.startsAt;
    const slotDate = new Date(startsAt);
    const isPast = slotDate.getTime() <= Date.now();
    const bookedCount = slotCountsByIso[startsAt] ?? 0;
    const remainingCount = Math.max(0, payload.business.appointmentsPerSlot - bookedCount);
    const isFull = bookedCount >= payload.business.appointmentsPerSlot;

    return {
      dayOffset: slot.dayOffset,
      isAvailable: !isPast && !isFull,
      label: slot.label,
      minutes: slot.minutes,
      remainingCount,
      startsAt,
    };
  });
  const selectedSlot = availableSlots.find((slot) => slot.startsAt === selectedSlotIso) ?? null;
  const logoDataUrl = payload.business.imageDataUrl ? normalizeImageDataUrl(payload.business.imageDataUrl) : null;
  const profileImageDataUrl = payload.business.profileImageDataUrl ? normalizeImageDataUrl(payload.business.profileImageDataUrl) : null;
  const queueEstimate = payload.business.justAddToList
    ? estimateQueueStart({
        activeCount: queueCountsByDateKey[selectedDateKey] ?? 0,
        appointmentsPerSlot: payload.business.appointmentsPerSlot,
        selectedDateKey,
        slotDurationMinutes,
        workingHours: payload.business.workingHours,
        workingHoursSecondWindow: payload.business.workingHoursSecondWindow,
      })
    : null;
  const businessContactText = [payload.business.address, payload.business.name, formatPhoneNumberForDisplay(payload.business.ownerIdentifier, { showFullPhoneNumber: true })]
    .filter(Boolean)
    .join(" • ");

  return (
    <div className="workspace-card-stack">
      <BrowserPushPrompt publicKey={process.env.NEXT_PUBLIC_WEB_PUSH_PUBLIC_KEY ?? null} />
      <section className="workspace-card apportion-booking-hero">
        <div className="apportion-booking-hero-row">
          <div className="apportion-business-image-slot left-slot">
            {profileImageDataUrl ? (
              <img alt="Business profile" className="apportion-business-logo is-profile" src={profileImageDataUrl} />
            ) : null}
          </div>
          <div className="apportion-booking-title-block">
            <p className="eyebrow">Apportion booking</p>
            <h1>{payload.business.name || "Business appointment"}</h1>
            {businessContactText ? <p className="apportion-booking-subtitle">{businessContactText}</p> : null}
          </div>
          <div className="apportion-business-image-slot right-slot">
            {logoDataUrl ? (
              <img alt="Business logo" className="apportion-business-logo" src={logoDataUrl} />
            ) : null}
          </div>
        </div>
      </section>

      <section className="workspace-card apportion-booking-panel">
        <p className="eyebrow">{payload.business.justAddToList ? "Join the list" : "Choose appointment"}</p>
        <div className="apportion-booking-grid">
          <div className="apportion-calendar" aria-label="Appointment calendar">
            {WEEKDAY_SHORT_NAMES.map((dayName) => (
              <span className="apportion-calendar-weekday" key={dayName}>{dayName}</span>
            ))}
            {calendarCells.map((cell) => {
              if (cell.type === "month") {
                return <span className="apportion-calendar-month" key={cell.key}>{cell.label}</span>;
              }

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
            {payload.business.justAddToList ? (
              <div className="field">
                <label>Approximate latest appointment time</label>
                <p className="muted-text apportion-working-hours">Working hours: {workingHoursText || "Not specified"}</p>
                <p className="apportion-queue-estimate">{queueEstimate?.label ?? "Not available"}</p>
                <p className="muted-text">
                  You do not need to select a slot for this business. Joining the list places you in the live queue for the selected day.
                </p>
                {queueEstimate?.exceedsWorkingHours ? (
                  <p className="muted-text apportion-queue-warning">
                    Caution: the estimated latest availability is beyond the configured working hours for this day.
                  </p>
                ) : null}
              </div>
            ) : (
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
                      {slot.label} - {slot.isAvailable ? `Available${payload.business.showRemainingBookings ? ` (${slot.remainingCount} left)` : ""}` : "Unavailable"}
                    </option>
                  ))}
                </select>
                <p className="muted-text">{selectedSlot ? `${selectedSlot.label} selected${payload.business.showRemainingBookings ? `, ${selectedSlot.remainingCount} booking${selectedSlot.remainingCount === 1 ? "" : "s"} left` : ""}` : "Filled slots are greyed out in the list."}</p>
              </div>
            )}
            <div className="field">
              <div className="apportion-notes-label-row">
                <label htmlFor="apportion-notes">Notes</label>
                <span>{payload.business.appointmentNotesPrompt || "Share a brief about appointment purpose"}</span>
              </div>
              <textarea
                id="apportion-notes"
                rows={3}
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
              />
            </div>
            {feedback ? <p className="muted-text">{feedback}</p> : null}
            <div className="inline-actions">
              <button className="button" disabled={isBooking} type="button" onClick={() => void handleBookAppointment()}>
                {isBooking ? "Booking..." : payload.business.justAddToList ? "Join appointment list" : "Book appointment"}
              </button>
              <a className="button-secondary" href="/user?tab=apportion">Open my dashboard</a>
            </div>
          </div>
        </div>
      </section>

      <p className="apportion-identity-mark">www.TRAPit.in</p>

    </div>
  );
}