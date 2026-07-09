"use client";

import { useEffect, useState } from "react";

const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const WEEKDAY_SHORT_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

type BookingPayload = {
  business: {
    appointmentsPerSlot: number;
    breakHours: string;
    imageDataUrl: string | null;
    name: string;
    slotDurationMinutes: number | null;
    workingDays: string;
    workingHours: string;
  };
  slotCounts: Array<{ count: number; startsAt: string }>;
};

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
    }).find((date) => workingDays.has(WEEKDAY_NAMES[date.getDay()]));

    if (nextWorkingDate) {
      setSelectedDateKey(createDateKey(nextWorkingDate));
    }
  }, [payload]);

  async function handleBookAppointment() {
    if (!selectedSlotIso) {
      setFeedback("Choose an appointment date and time.");
      return;
    }

    setIsBooking(true);

    try {
      await readJson(
        await fetch(`/api/apportion/${encodeURIComponent(shareCode)}`, {
          body: JSON.stringify({
            notes,
            startsAt: selectedSlotIso,
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
  const workingRange = parseTimeRange(payload.business.workingHours) ?? { endMinutes: 18 * 60, startMinutes: 10 * 60 };
  const breakRange = parseTimeRange(payload.business.breakHours);
  const slotDurationMinutes = payload.business.slotDurationMinutes ?? 30;
  const slotCountsByIso = Object.fromEntries(payload.slotCounts.map((slot) => [slot.startsAt, slot.count]));
  const calendarDays = Array.from({ length: 28 }, (_, offset) => {
    const date = new Date(today);
    date.setDate(today.getDate() + offset);
    return date;
  });
  const availableSlots = Array.from(
    { length: Math.max(0, Math.floor((workingRange.endMinutes - workingRange.startMinutes) / slotDurationMinutes)) },
    (_, index) => workingRange.startMinutes + (index * slotDurationMinutes),
  ).filter((minutes) => {
    const slotEnd = minutes + slotDurationMinutes;

    return !breakRange || minutes >= breakRange.endMinutes || slotEnd <= breakRange.startMinutes;
  }).map((minutes) => {
    const startsAt = createSlotIso(selectedDateKey, minutes);
    const slotDate = new Date(startsAt);
    const isPast = slotDate.getTime() <= Date.now();
    const isFull = (slotCountsByIso[startsAt] ?? 0) >= payload.business.appointmentsPerSlot;

    return {
      isAvailable: !isPast && !isFull,
      label: formatTime(minutes),
      startsAt,
    };
  });

  return (
    <div className="workspace-card-stack">
      <section className="workspace-card apportion-booking-hero">
        {payload.business.imageDataUrl ? (
          <img alt="Business logo" className="branding-preview-image" src={payload.business.imageDataUrl} />
        ) : null}
        <div>
          <p className="eyebrow">Apportion booking</p>
          <h1>{payload.business.name || "Business appointment"}</h1>
          <p className="muted-text">Working days: {payload.business.workingDays || "Not specified"}</p>
          <p className="muted-text">Working hours: {payload.business.workingHours || "Not specified"}</p>
          {payload.business.breakHours ? <p className="muted-text">Break hour: {payload.business.breakHours}</p> : null}
          <p className="muted-text">Slot duration: {payload.business.slotDurationMinutes ? `${payload.business.slotDurationMinutes} mins` : "Not specified"}</p>
        </div>
      </section>

      <section className="workspace-card apportion-booking-panel">
        <p className="eyebrow">Choose appointment</p>
        <div className="form-stack">
          <div className="apportion-calendar" aria-label="Appointment calendar">
            {calendarDays.map((date) => {
              const dateKey = createDateKey(date);
              const isWorkingDay = workingDays.has(WEEKDAY_NAMES[date.getDay()]);
              const isSelected = dateKey === selectedDateKey;

              return (
                <button
                  className={`apportion-calendar-day${isWorkingDay ? " is-working" : ""}${isSelected ? " is-selected" : ""}`}
                  disabled={!isWorkingDay}
                  key={dateKey}
                  type="button"
                  onClick={() => {
                    setSelectedDateKey(dateKey);
                    setSelectedSlotIso(null);
                  }}
                >
                  <span>{WEEKDAY_SHORT_NAMES[date.getDay()]}</span>
                  <strong>{date.getDate()}</strong>
                  {isSameDay(date, new Date()) ? <small>Today</small> : null}
                </button>
              );
            })}
            <p className="muted-text apportion-calendar-note">Slot duration: {slotDurationMinutes} mins</p>
          </div>
          <div className="apportion-slot-grid" aria-label="Available time slots">
            {availableSlots.length ? availableSlots.map((slot) => (
              <button
                className={`apportion-slot-chip${selectedSlotIso === slot.startsAt ? " is-selected" : ""}`}
                disabled={!slot.isAvailable}
                key={slot.startsAt}
                type="button"
                onClick={() => {
                  setSelectedSlotIso(slot.startsAt);
                  setFeedback(null);
                }}
              >
                {slot.label}
                {!slot.isAvailable ? <span>Unavailable</span> : null}
              </button>
            )) : <p className="muted-text">No available slots for this date.</p>}
          </div>
          <div className="field">
            <label htmlFor="apportion-notes">Notes</label>
            <textarea
              id="apportion-notes"
              placeholder="Tell us a bit about the student's current math level or goals!"
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
            <a className="button-secondary" href="/user?tab=apportion">Open Apportion dashboard</a>
          </div>
        </div>
      </section>

    </div>
  );
}