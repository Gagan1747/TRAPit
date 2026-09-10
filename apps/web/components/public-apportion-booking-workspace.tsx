"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";

import { formatPhoneNumberForDisplay } from "../lib/privacy";
import { BrowserPushPrompt, markNotificationPromptOpportunity } from "./browser-push-prompt";

const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const WEEKDAY_SHORT_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WEEKDAY_KEYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const IST_OFFSET_MINUTES = 5 * 60 + 30;

type BookingPayload = {
  business: {
    address: string;
    advanceBookingWeeks: number;
    appointmentDateOverrides: {
      closedDateKeys: string[];
      openedDateKeys: string[];
    };
    appointmentNotesPrompt: string;
    appointmentsPerSlot: number;
    imageDataUrl: string | null;
    justAddToList: boolean;
    locations: Array<{
      address: string;
      id: string;
      name: string;
      workingDays: string;
      workingHours: string;
      workingHoursSecondWindow: string;
    }>;
    name: string;
    ownerIdentifier: string;
    profileImageDataUrl: string | null;
    promotionalImageDataUrls: string[];
    recurringBookingLimit: number | null;
    recurringBookingsEnabled: boolean;
    showRemainingBookings: boolean;
    slotDurationMinutes: number | null;
    workingDays: string;
    workingHours: string;
    workingHoursSecondWindow: string;
  };
  viewerName: string;
  queueCounts: Array<{ count: number; dateKey: string; locationId: string }>;
  slotCounts: Array<{ count: number; locationId: string; startsAt: string }>;
};

type BookingResponse = {
  appointment: { id: string };
  appointmentCount?: number;
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

function createDateKeyUtc(value: Date) {
  const year = value.getUTCFullYear();
  const month = String(value.getUTCMonth() + 1).padStart(2, "0");
  const day = String(value.getUTCDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function getIstDateKey(value: Date) {
  const shifted = new Date(value.getTime() + (IST_OFFSET_MINUTES * 60 * 1000));
  return createDateKeyUtc(shifted);
}

function createDateFromKey(value: string) {
  const [year, month, day] = value.split("-").map((part) => Number.parseInt(part, 10));

  return new Date(year, month - 1, day);
}

function getWeekdayKeyForDateKey(value: string) {
  const date = createDateFromKey(value);

  return WEEKDAY_KEYS[date.getDay()] ?? "Sun";
}

function createUtcSlotIso(slotDateKey: string, dayOffset: number, minutesOfDay: number) {
  const [year, month, day] = slotDateKey.split("-").map((part) => Number.parseInt(part, 10));

  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return null;
  }

  const slotDate = new Date(Date.UTC(
    year,
    month - 1,
    day + dayOffset,
    Math.floor(minutesOfDay / 60),
    minutesOfDay % 60,
    0,
    0,
  ) - (IST_OFFSET_MINUTES * 60 * 1000));

  return slotDate.toISOString();
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

function getSlotStepMinutes(slotDurationMinutes: number) {
  return slotDurationMinutes;
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
      const startsAt = createUtcSlotIso(input.selectedDateKey, dayOffset, minutesOfDay);

      if (!startsAt) {
        return null;
      }

      return {
        dayOffset,
        label: `${formatTime(minutesOfDay)}${dayOffset > 0 ? ` (+${dayOffset} day${dayOffset === 1 ? "" : "s"})` : ""}`,
        minutes: minutesOfDay,
        startsAt,
      };
    },
  )).filter((slot): slot is { dayOffset: number; label: string; minutes: number; startsAt: string } => Boolean(slot));
}

function estimateQueueStart(input: {
  activeCount: number;
  appointmentsPerSlot: number;
  selectedDateKey: string;
  slotDurationMinutes: number;
  workingHours: string;
  workingHoursSecondWindow: string;
}) {
  const ranges = [input.workingHours, input.workingHoursSecondWindow]
    .map((range) => parseTimeRange(range))
    .filter((range): range is { durationMinutes: number; startMinutes: number } => Boolean(range))
    .map((range) => ({ endMinutes: range.startMinutes + range.durationMinutes, startMinutes: range.startMinutes }))
    .sort((left, right) => left.startMinutes - right.startMinutes);

  if (!ranges.length) {
    return null;
  }

  const now = new Date();
  const nowIst = new Date(now.getTime() + (IST_OFFSET_MINUTES * 60 * 1000));
  const nowMinutes = nowIst.getUTCHours() * 60 + nowIst.getUTCMinutes() + (nowIst.getUTCSeconds() / 60);
  let estimateMinutes = Math.max(ranges[0].startMinutes, nowMinutes);
  let remainingServiceMinutes = Math.floor(input.activeCount / Math.max(1, input.appointmentsPerSlot)) * input.slotDurationMinutes;

  for (const range of ranges) {
    if (estimateMinutes >= range.endMinutes) {
      continue;
    }

    estimateMinutes = Math.max(estimateMinutes, range.startMinutes);
    const availableMinutes = range.endMinutes - estimateMinutes;

    if (remainingServiceMinutes < availableMinutes) {
      estimateMinutes += remainingServiceMinutes;
      return {
        exceedsWorkingHours: false,
        label: formatTime(Math.floor(estimateMinutes % (24 * 60))),
        startsAt: createUtcSlotIso(input.selectedDateKey, Math.floor(estimateMinutes / (24 * 60)), Math.floor(estimateMinutes % (24 * 60))) ?? "",
      };
    }

    remainingServiceMinutes -= availableMinutes;
    estimateMinutes = range.endMinutes;
  }

  return null;
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
  const [carouselIndex, setCarouselIndex] = useState(0);
  const [failedPromotionalImages, setFailedPromotionalImages] = useState<string[]>([]);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [isBooking, setIsBooking] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [notes, setNotes] = useState("");
  const [payload, setPayload] = useState<BookingPayload | null>(null);
  const [recurrenceMode, setRecurrenceMode] = useState<"none" | "weekly">("none");
  const [recurringEndDateKey, setRecurringEndDateKey] = useState("");
  const [recurringWeekdayKeys, setRecurringWeekdayKeys] = useState<string[]>([]);
  const [selectedDateKey, setSelectedDateKey] = useState(getIstDateKey(new Date()));
  const [selectedLocationId, setSelectedLocationId] = useState("");
  const [selectedSlotIso, setSelectedSlotIso] = useState<string | null>(null);
  const [weekOffset, setWeekOffset] = useState(0);

  async function loadBookingPage() {
    setIsLoading(true);

    try {
      const nextPayload = await readJson<BookingPayload>(
        await fetch(`/api/apportion/${encodeURIComponent(shareCode)}`),
      );
      setPayload(nextPayload);
      setRecurrenceMode("none");
      setRecurringEndDateKey("");
      setRecurringWeekdayKeys([]);
      setSelectedLocationId(nextPayload.business.locations.length === 1 ? nextPayload.business.locations[0].id : "");
      setSelectedSlotIso(null);
      setCarouselIndex(0);
      setFailedPromotionalImages([]);
      setWeekOffset(0);
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

    if (!payload.business.recurringBookingsEnabled) {
      setRecurrenceMode("none");
      setRecurringEndDateKey("");
      setRecurringWeekdayKeys([]);
    }

    const selectedLocation = payload.business.locations.find((location) => location.id === selectedLocationId);

    if (!selectedLocation) {
      return;
    }

    const workingDays = parseWorkingDays(selectedLocation.workingDays);
    const today = createDateFromKey(getIstDateKey(new Date()));

    if (payload.business.justAddToList) {
      setSelectedDateKey(createDateKey(today));
      return;
    }
    const maxDate = new Date(today);
    maxDate.setMonth(today.getMonth() + 6);
    const dayCount = Math.ceil((maxDate.getTime() - today.getTime()) / (24 * 60 * 60 * 1000)) + 1;
    const closedDateKeys = new Set(payload.business.appointmentDateOverrides.closedDateKeys);
    const openedDateKeys = new Set(payload.business.appointmentDateOverrides.openedDateKeys);
    const nextWorkingDate = Array.from({ length: dayCount }, (_, offset) => {
      const date = new Date(today);
      date.setDate(today.getDate() + offset);
      return date;
    }).find((date) => {
      const key = createDateKey(date);
      return !closedDateKeys.has(key)
        && (workingDays.has(WEEKDAY_NAMES[date.getDay()]) || openedDateKeys.has(key));
    });

    if (nextWorkingDate) {
      setSelectedDateKey(createDateKey(nextWorkingDate));
      setRecurringEndDateKey(createDateKey(nextWorkingDate));
      setRecurringWeekdayKeys([WEEKDAY_KEYS[nextWorkingDate.getDay()] ?? "Sun"]);
    }
  }, [payload, selectedLocationId]);

  useEffect(() => {
    const imageCount = payload?.business.promotionalImageDataUrls
      .map(normalizeImageDataUrl)
      .filter((imageUrl) => !failedPromotionalImages.includes(imageUrl)).length ?? 0;

    setCarouselIndex((current) => imageCount ? current % imageCount : 0);

    if (imageCount < 2 || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }

    const intervalId = window.setInterval(() => {
      setCarouselIndex((current) => (current + 1) % imageCount);
    }, 5000);

    return () => window.clearInterval(intervalId);
  }, [failedPromotionalImages, payload]);

  useEffect(() => {
    if (recurrenceMode !== "weekly") {
      return;
    }

    if (!recurringEndDateKey) {
      setRecurringEndDateKey(selectedDateKey);
    }

    if (!recurringWeekdayKeys.length) {
      setRecurringWeekdayKeys([getWeekdayKeyForDateKey(selectedDateKey)]);
    }
  }, [recurrenceMode, recurringEndDateKey, recurringWeekdayKeys, selectedDateKey]);

  async function handleBookAppointment() {
    if (!payload) {
      setFeedback("Unable to load this booking page.");
      return;
    }

    if (!selectedLocationId) {
      setFeedback("Choose a business location before booking.");
      return;
    }

    const selectedSlot = availableSlots.find((slot) => slot.startsAt === selectedSlotIso) ?? null;

    if (!payload.business.justAddToList && !selectedSlot) {
      setFeedback("Choose an appointment date and time.");
      return;
    }

    if (recurrenceMode === "weekly") {
      if (!payload.business.recurringBookingsEnabled) {
        setFeedback("Recurring bookings are disabled for this business.");
        return;
      }

      if (!recurringWeekdayKeys.length) {
        setFeedback("Choose at least one weekday for recurring booking.");
        return;
      }

      if (!recurringEndDateKey) {
        setFeedback("Choose an end date for recurring booking.");
        return;
      }
    }

    setIsBooking(true);

    try {
      const bookingPayload = await readJson<BookingResponse>(
        await fetch(`/api/apportion/${encodeURIComponent(shareCode)}`, {
          body: JSON.stringify({
            locationId: selectedLocationId,
            slotDateKey: selectedDateKey,
            notes,
            recurrence: recurrenceMode === "weekly"
              && payload.business.recurringBookingsEnabled
              ? {
                  endDateKey: recurringEndDateKey,
                  mode: "weekly",
                  weekdayKeys: recurringWeekdayKeys,
                }
              : null,
            startsAt: selectedSlot?.startsAt,
          }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        }),
      );
      const successLabel = bookingPayload.appointmentCount && bookingPayload.appointmentCount > 1
        ? `${bookingPayload.appointmentCount} appointments booked.`
        : "Appointment booked.";

      setFeedback(bookingPayload.caution
        ? `${successLabel} ${bookingPayload.caution}`
        : `${successLabel} You can see it in the Apportion tab on your dashboard.`);
      markNotificationPromptOpportunity();
      setNotes("");
      setRecurrenceMode("none");
      setRecurringEndDateKey(selectedDateKey);
      setRecurringWeekdayKeys([getWeekdayKeyForDateKey(selectedDateKey)]);
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

  const today = createDateFromKey(getIstDateKey(new Date()));
  today.setHours(0, 0, 0, 0);
  const selectedLocation = payload.business.locations.find((location) => location.id === selectedLocationId) ?? null;
  const workingDays = parseWorkingDays(selectedLocation?.workingDays ?? "none");
  const slotDurationMinutes = payload.business.slotDurationMinutes ?? 30;
  const slotCountsByIso = Object.fromEntries(payload.slotCounts
    .filter((slot) => slot.locationId === selectedLocationId)
    .map((slot) => [slot.startsAt, slot.count]));
  const queueCountsByDateKey = Object.fromEntries(payload.queueCounts
    .filter((slot) => slot.locationId === selectedLocationId)
    .map((slot) => [slot.dateKey, slot.count]));
  const maxBookableDate = new Date(today);
  maxBookableDate.setMonth(today.getMonth() + 6);
  const closedDateKeys = new Set(payload.business.appointmentDateOverrides.closedDateKeys);
  const openedDateKeys = new Set(payload.business.appointmentDateOverrides.openedDateKeys);
  const weekStartDate = new Date(today);
  weekStartDate.setDate(today.getDate() + (weekOffset * 7));
  const weekDates = Array.from({ length: 7 }, (_, dayOffset) => {
    const date = new Date(weekStartDate);
    date.setDate(weekStartDate.getDate() + dayOffset);
    return date;
  });
  const workingHoursText = [selectedLocation?.workingHours, selectedLocation?.workingHoursSecondWindow].filter(Boolean).join(" and ");
  const availableSlots = (selectedLocation ? buildSlotStartsForDate({
    selectedDateKey,
    slotDurationMinutes,
    workingHours: selectedLocation.workingHours,
    workingHoursSecondWindow: selectedLocation.workingHoursSecondWindow,
  }) : []).map((slot) => {
    const startsAt = slot.startsAt;
    const isPast = new Date(startsAt).getTime() <= Date.now();
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
  const promotionalImageDataUrls = payload.business.promotionalImageDataUrls
    .map(normalizeImageDataUrl)
    .filter((imageUrl) => !failedPromotionalImages.includes(imageUrl));
  const queueEstimate = payload.business.justAddToList
    && selectedLocation
    && !closedDateKeys.has(selectedDateKey)
    && (workingDays.has(WEEKDAY_NAMES[today.getDay()]) || openedDateKeys.has(selectedDateKey))
    ? estimateQueueStart({
        activeCount: queueCountsByDateKey[selectedDateKey] ?? 0,
        appointmentsPerSlot: payload.business.appointmentsPerSlot,
        selectedDateKey,
        slotDurationMinutes,
        workingHours: selectedLocation.workingHours,
        workingHoursSecondWindow: selectedLocation.workingHoursSecondWindow,
      })
    : null;
  const queueCountForSelectedDate = queueCountsByDateKey[selectedDateKey] ?? 0;
  const selectedDateLabel = createDateFromKey(selectedDateKey).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  const businessContactText = [payload.business.name, formatPhoneNumberForDisplay(payload.business.ownerIdentifier, { showFullPhoneNumber: true })]
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
          <div className="apportion-promotion-carousel" aria-label="Business promotional images">
            {promotionalImageDataUrls.length ? (
              <img
                alt={`Business promotion ${carouselIndex + 1} of ${promotionalImageDataUrls.length}`}
                src={promotionalImageDataUrls[carouselIndex]}
                onError={() => {
                  const failedImageUrl = promotionalImageDataUrls[carouselIndex];
                  if (failedImageUrl) {
                    setFailedPromotionalImages((current) => current.includes(failedImageUrl) ? current : [...current, failedImageUrl]);
                  }
                }}
              />
            ) : (
              <div className="apportion-promotion-empty">
                <strong>{payload.business.name || "Business appointment"}</strong>
              </div>
            )}
            {promotionalImageDataUrls.length > 1 ? (
              <>
                <button
                  aria-label="Previous promotional image"
                  className="apportion-carousel-control is-previous"
                  type="button"
                  onClick={() => setCarouselIndex((current) => (current - 1 + promotionalImageDataUrls.length) % promotionalImageDataUrls.length)}
                >
                  <ChevronLeft aria-hidden="true" size={22} />
                </button>
                <button
                  aria-label="Next promotional image"
                  className="apportion-carousel-control is-next"
                  type="button"
                  onClick={() => setCarouselIndex((current) => (current + 1) % promotionalImageDataUrls.length)}
                >
                  <ChevronRight aria-hidden="true" size={22} />
                </button>
                <div className="apportion-carousel-indicators" aria-label="Promotional image position">
                  {promotionalImageDataUrls.map((_, index) => (
                    <button
                      aria-label={`Show promotional image ${index + 1}`}
                      className={index === carouselIndex ? "is-active" : ""}
                      key={index}
                      type="button"
                      onClick={() => setCarouselIndex(index)}
                    />
                  ))}
                </div>
              </>
            ) : null}
          </div>
          <div className="form-stack apportion-booking-right-column">
            {payload.business.locations.length > 1 ? (
              <div className="field apportion-location-selector">
                <label htmlFor="apportion-location">Business location</label>
                <select
                  className="select-field"
                  id="apportion-location"
                  required
                  value={selectedLocationId}
                  onChange={(event) => {
                    setSelectedLocationId(event.target.value);
                    setSelectedSlotIso(null);
                    setRecurrenceMode("none");
                    setRecurringEndDateKey("");
                    setRecurringWeekdayKeys([]);
                    setWeekOffset(0);
                    setFeedback(null);
                  }}
                >
                  <option value="">Select a location</option>
                  {payload.business.locations.map((location) => (
                    <option key={location.id} value={location.id}>{location.address}</option>
                  ))}
                </select>
                {selectedLocation ? <p className="muted-text">{selectedLocation.address}</p> : null}
              </div>
            ) : selectedLocation ? <p className="muted-text apportion-single-location">{selectedLocation.address}</p> : null}

            {!payload.business.justAddToList ? (
              <div className="apportion-week-calendar-shell">
                <div className="apportion-week-calendar-head">
                  <button
                    aria-label="Previous week"
                    className="icon-button button-secondary"
                    disabled={weekOffset === 0}
                    type="button"
                    onClick={() => setWeekOffset((current) => Math.max(0, current - 1))}
                  >
                    <ChevronLeft aria-hidden="true" size={20} />
                  </button>
                  <strong>{weekStartDate.toLocaleDateString(undefined, { month: "short", year: "numeric" })}</strong>
                  <button
                    aria-label="Next week"
                    className="icon-button button-secondary"
                    disabled={weekDates[6] >= maxBookableDate}
                    type="button"
                    onClick={() => setWeekOffset((current) => current + 1)}
                  >
                    <ChevronRight aria-hidden="true" size={20} />
                  </button>
                </div>
                <div className="apportion-calendar" aria-label="Appointment calendar">
                  {weekDates.map((date) => {
                    const dateKey = createDateKey(date);
                    const isWorkingDay = workingDays.has(WEEKDAY_NAMES[date.getDay()]);
                    const isAvailableDate = !closedDateKeys.has(dateKey)
                      && (isWorkingDay || openedDateKeys.has(dateKey))
                      && date >= today
                      && date <= maxBookableDate;
                    const isSelected = dateKey === selectedDateKey;

                    return (
                      <button
                        className={`apportion-calendar-day${isAvailableDate ? " is-working" : ""}${isSelected ? " is-selected" : ""}`}
                        disabled={!isAvailableDate}
                        key={dateKey}
                        type="button"
                        onClick={() => {
                          setSelectedDateKey(dateKey);
                          setSelectedSlotIso(null);
                        }}
                      >
                        <small>{WEEKDAY_SHORT_NAMES[date.getDay()]}</small>
                        <strong>{date.getDate()}</strong>
                        {isSameDay(date, new Date()) ? <small>Today</small> : null}
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}

            <div className="form-stack apportion-booking-form">
            {selectedLocation ? <p className="muted-text apportion-working-hours">Working hours: {workingHoursText || "Not provided"}</p> : null}
            {payload.business.justAddToList ? (
              <div className="field">
                <label>{selectedDateLabel}</label>
                <p className="muted-text">Queue size: {queueCountForSelectedDate}</p>
                {queueEstimate ? <p className="muted-text">Estimated start time: {queueEstimate.label}</p> : null}
                {selectedLocation && !queueEstimate ? <p className="muted-text apportion-queue-warning">Queue booking is closed for today.</p> : null}
              </div>
            ) : (
              <div className="field">
                <label htmlFor="apportion-appointment-time">Appointment time</label>
                <select
                  className="select-field"
                  disabled={!selectedLocation}
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
                {selectedSlot ? (
                  <p className="muted-text">
                    {selectedSlot.label} selected{payload.business.showRemainingBookings ? `, ${selectedSlot.remainingCount} booking${selectedSlot.remainingCount === 1 ? "" : "s"} left` : ""}
                  </p>
                ) : null}
              </div>
            )}
            <div className="field">
              <div className="apportion-notes-label-row">
                <label htmlFor="apportion-notes">Notes</label>
                <span className="muted-text">{payload.business.appointmentNotesPrompt || "Share a brief about appointment purpose"}</span>
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
              <button className="button" disabled={isBooking || !selectedLocation || (payload.business.justAddToList && !queueEstimate)} type="button" onClick={() => void handleBookAppointment()}>
                {isBooking ? "Booking..." : payload.business.justAddToList ? "Join appointment queue" : "Book appointment"}
              </button>
              <a className="button-secondary" href="/user?tab=apportion">Go to dashboard</a>
            </div>
            <p className="muted-text">Booking user: {payload.viewerName}</p>
            </div>
          </div>
        </div>
      </section>

      <p className="apportion-identity-mark">www.TRAPit.in</p>

    </div>
  );
}