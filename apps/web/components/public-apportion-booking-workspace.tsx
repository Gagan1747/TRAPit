"use client";

import { ChevronLeft, ChevronRight, LoaderCircle, Search, Send } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { findNextApportionRecurringDate, matchApportionIdentity, planApportionDateKeys, resolveApportionDailySchedule } from "@trapit/testing";

import { formatPhoneNumberForDisplay } from "../lib/privacy";
import { BrowserPushPrompt, markNotificationPromptOpportunity } from "./browser-push-prompt";

const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const WEEKDAY_SHORT_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WEEKDAY_KEYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const IST_OFFSET_MINUTES = 5 * 60 + 30;

type BookingPayload = {
  viewerIdentifier: string;
  canInvite: boolean;
  addressOptions: Array<{
    key: string;
    location: BookingPayload["business"]["locations"][number];
    contexts: Array<{
      ownerIdentifier: string;
      serviceId: string;
      serviceName: string;
      businessName: string;
      business: BookingPayload["business"];
      queueCounts: Array<{ count: number; dateKey: string; locationId: string }>;
      slotCounts: Array<{ count: number; locationId: string; startsAt: string }>;
    }>;
  }>;
  services: Array<{ businessName: string; id: string; locationIds: string[]; name: string; ownerIdentifier: string }>;
  serviceId: string;
  businessOwnerIdentifier: string;
  providerProfile: {
    address: string;
    imageDataUrl: string | null;
    name: string;
    ownerIdentifier: string;
    profileImageDataUrl: string | null;
    promotionalImageDataUrls: string[];
  };
  business: {
    address: string;
    advanceBookingWeeks: number;
    appointmentDateOverrides: {
      closedDateKeys: string[];
      openedDateKeys: string[];
    };
    appointmentDateHoursOverrides: Array<{
      dateKey: string;
      locations: Array<{ locationId: string; workingHours: string; workingHoursSecondWindow: string }>;
    }>;
    appointmentNotesPrompt: string;
    appointmentsPerSlot: number;
    appointmentWeeklyHoursOverrides: Array<{
      locations: Array<{ locationId: string; workingHours: string; workingHoursSecondWindow: string }>;
      weekday: number;
    }>;
    imageDataUrl: string | null;
    justAddToList: boolean;
    locations: Array<{
      address: string;
      dailyHours?: Array<{ weekday: number; workingHours: string; workingHoursSecondWindow: string }>;
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
    providerClosedDateKeys: string[];
  };
  viewerName: string;
  queueCounts: Array<{ count: number; dateKey: string; locationId: string }>;
  slotCounts: Array<{ count: number; locationId: string; startsAt: string }>;
};

type BookingResponse = {
  appointment?: { id: string };
  invitation?: { id: string; status: "pending" };
  appointmentCount?: number;
  caution: string | null;
};

type CalendarCell =
  | { key: string; label: string; type: "month" }
  | { date: Date; key: string; type: "date" }
  | { key: string; type: "blank" };

type BookingLocation = BookingPayload["business"]["locations"][number];

function resolveEffectiveLocation(
  business: BookingPayload["business"],
  location: BookingLocation,
  serviceDateKey: string,
) {
  if (!serviceDateKey || business.providerClosedDateKeys.includes(serviceDateKey)) {
    return null;
  }

  if (business.appointmentDateOverrides.closedDateKeys.includes(serviceDateKey)) {
    return null;
  }

  const dateOverride = business.appointmentDateHoursOverrides.find((entry) => entry.dateKey === serviceDateKey);
  if (dateOverride) {
    const hours = dateOverride.locations.find((entry) => entry.locationId === location.id);
    return hours ? { ...location, ...hours } : null;
  }

  const date = createDateFromKey(serviceDateKey);
  const weeklyOverride = business.appointmentWeeklyHoursOverrides.find((entry) => entry.weekday === date.getDay());
  if (weeklyOverride) {
    const hours = weeklyOverride.locations.find((entry) => entry.locationId === location.id);
    return hours ? { ...location, ...hours } : null;
  }

  if (location.dailyHours) {
    const hours = resolveApportionDailySchedule({ dailyHours: location.dailyHours })[date.getDay()];
    if (hours.workingHours || hours.workingHoursSecondWindow) {
      return { ...location, ...hours };
    }
  }

  const isWorkingDay = location.dailyHours
    ? false
    : parseWorkingDays(location.workingDays).has(WEEKDAY_NAMES[date.getDay()]);
  return isWorkingDay || business.appointmentDateOverrides.openedDateKeys.includes(serviceDateKey) ? location : null;
}

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

function isOpenNow(business: BookingPayload["business"], location: BookingLocation) {
  const now = new Date();
  const todayKey = getIstDateKey(now);
  const effective = resolveEffectiveLocation(business, location, todayKey);
  if (!effective) return false;
  const shiftedNow = new Date(now.getTime() + IST_OFFSET_MINUTES * 60_000);
  const currentMinute = shiftedNow.getUTCHours() * 60 + shiftedNow.getUTCMinutes();
  return [effective.workingHours, effective.workingHoursSecondWindow].some((range) => {
    const parsed = parseTimeRange(range);
    if (!parsed) return false;
    const end = parsed.startMinutes + parsed.durationMinutes;
    return currentMinute >= parsed.startMinutes && currentMinute < end
      || end > 1440 && currentMinute < end - 1440;
  });
}

function findNextAvailableBooking(input: {
  business: BookingPayload["business"];
  location: BookingLocation;
  slotCounts: BookingPayload["slotCounts"];
  queueCounts: BookingPayload["queueCounts"];
}) {
  const today = createDateFromKey(getIstDateKey(new Date()));
  const slotCounts = Object.fromEntries(input.slotCounts
    .filter((entry) => entry.locationId === input.location.id)
    .map((entry) => [entry.startsAt, entry.count]));
  const queueCounts = Object.fromEntries(input.queueCounts
    .filter((entry) => entry.locationId === input.location.id)
    .map((entry) => [entry.dateKey, entry.count]));
  const lastDate = new Date(today);
  lastDate.setMonth(lastDate.getMonth() + 6);

  for (const date = new Date(today); date <= lastDate; date.setDate(date.getDate() + 1)) {
    const dateKey = createDateKey(date);
    const effective = resolveEffectiveLocation(input.business, input.location, dateKey);
    if (!effective) continue;
    if (input.business.justAddToList) {
      const activeCount = queueCounts[dateKey] ?? 0;
      const estimate = estimateQueueStart({
        activeCount,
        appointmentsPerSlot: input.business.appointmentsPerSlot,
        selectedDateKey: dateKey,
        slotDurationMinutes: input.business.slotDurationMinutes ?? 10,
        workingHours: effective.workingHours,
        workingHoursSecondWindow: effective.workingHoursSecondWindow,
      });
      if (estimate) {
        const capacity = Math.max(1, input.business.appointmentsPerSlot);
        return {
          label: `${date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}, ${estimate.label}`,
          remainingCount: capacity - (activeCount % capacity || 0),
        };
      }
      continue;
    }
    const nextSlot = buildSlotStartsForDate({
      selectedDateKey: dateKey,
      slotDurationMinutes: input.business.slotDurationMinutes ?? 10,
      workingHours: effective.workingHours,
      workingHoursSecondWindow: effective.workingHoursSecondWindow,
    }).find((slot) => new Date(slot.startsAt).getTime() > Date.now()
      && (slotCounts[slot.startsAt] ?? 0) < input.business.appointmentsPerSlot);
    if (nextSlot) {
      return {
        label: `${date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}, ${nextSlot.label}`,
        remainingCount: Math.max(0, input.business.appointmentsPerSlot - (slotCounts[nextSlot.startsAt] ?? 0)),
      };
    }
  }
  return null;
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
  const nowMinutes = (now.getTime() - new Date(`${input.selectedDateKey}T00:00:00+05:30`).getTime()) / 60_000;
  let estimateMinutes = Math.max(ranges[0].startMinutes, nowMinutes);
  let remainingServiceMinutes = Math.floor(input.activeCount / Math.max(1, input.appointmentsPerSlot)) * input.slotDurationMinutes;

  for (const range of ranges) {
    if (estimateMinutes >= range.endMinutes) {
      continue;
    }

    estimateMinutes = Math.max(estimateMinutes, range.startMinutes);
    const availableMinutes = range.endMinutes - estimateMinutes;

    if (input.slotDurationMinutes === 1440 ? remainingServiceMinutes + 1440 <= availableMinutes : remainingServiceMinutes < availableMinutes) {
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
  initialServiceId?: string;
  initialOwnerIdentifier?: string;
  initialLocationId?: string;
};

type BookableSlot = {
  dayOffset: number;
  isAvailable: boolean;
  label: string;
  minutes: number;
  remainingCount: number;
  startsAt: string;
};

export function PublicApportionBookingWorkspace({ shareCode, initialServiceId, initialOwnerIdentifier, initialLocationId }: PublicApportionBookingWorkspaceProps) {
  const [clock, setClock] = useState(() => Date.now());
  const [recurringDuration, setRecurringDuration] = useState(1);
  useEffect(() => {
    const refresh = () => setClock(Date.now());
    const interval = window.setInterval(refresh, 15_000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => { window.clearInterval(interval); window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", refresh); };
  }, []);
  const bookingPendingRef = useRef(false);
  const lookupPendingRef = useRef(false);
  const lookupContextRef = useRef("");
  const lookupVersionRef = useRef(0);
  const [targetPhone, setTargetPhone] = useState("");
  const [verifiedTarget, setVerifiedTarget] = useState<{ identifier: string; name: string; context: string } | null>(null);
  const [isLookingUp, setIsLookingUp] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [carouselIndex, setCarouselIndex] = useState(0);
  const [failedPromotionalImages, setFailedPromotionalImages] = useState<string[]>([]);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [ticketUrl, setTicketUrl] = useState<string | null>(null);
  const [isBooking, setIsBooking] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [notes, setNotes] = useState("");
  const [payload, setPayload] = useState<BookingPayload | null>(null);
  const [recurrenceMode, setRecurrenceMode] = useState<"none" | "weekly" | "monthly">("none");
  const [recurringMonthDays, setRecurringMonthDays] = useState<number[]>([]);
  const [recurringEndDateKey, setRecurringEndDateKey] = useState("");
  const [recurringWeekdayKeys, setRecurringWeekdayKeys] = useState<string[]>([]);
  const [onceDateKey, setSelectedDateKey] = useState(getIstDateKey(new Date()));
  const [selectedServiceId, setSelectedServiceId] = useState(initialServiceId ?? "");
  const [selectedOwnerIdentifier, setSelectedOwnerIdentifier] = useState(initialOwnerIdentifier ?? "");
  const [selectedLocationId, setSelectedLocationId] = useState("");
  const [onceSlotIso, setSelectedSlotIso] = useState<string | null>(null);
  const [recurringTime, setRecurringTime] = useState<{ dayOffset: number; minutes: number } | null>(null);
  const [slotPage, setSlotPage] = useState(0);
  const [weekOffset, setWeekOffset] = useState(0);
  const normalizedTargetPhone = targetPhone.trim().replace(/[\s()-]/g, "");
  const lookupContext = JSON.stringify([shareCode, selectedOwnerIdentifier, selectedServiceId, normalizedTargetPhone]);
  lookupContextRef.current = lookupContext;
  const canInvite = Boolean(payload?.canInvite && payload.viewerIdentifier
    && matchApportionIdentity(payload.viewerIdentifier, selectedOwnerIdentifier)
    && matchApportionIdentity(payload.businessOwnerIdentifier, selectedOwnerIdentifier));
  const isTargeted = canInvite && Boolean(normalizedTargetPhone);
  const targetIsVerified = Boolean(isTargeted && verifiedTarget?.context === lookupContext);
  const recurrenceActive = isTargeted && Boolean(payload?.business.recurringBookingsEnabled) && recurrenceMode !== "none";
  const todayKey = getIstDateKey(new Date(clock));
  const horizon = createDateFromKey(todayKey);
  horizon.setMonth(horizon.getMonth() + 6);
  const recurrenceLocation = payload?.business.locations.find((location) => location.id === selectedLocationId);
  const recurrenceStart = recurrenceActive && payload && recurrenceLocation
    ? findNextApportionRecurringDate(todayKey, createDateKey(horizon), {
      mode: recurrenceMode === "monthly" ? "monthly" : "weekly", weekdayKeys: recurringWeekdayKeys, monthDays: recurringMonthDays,
    }, (dateKey) => {
      const effective = resolveEffectiveLocation(payload.business, recurrenceLocation, dateKey);
      if (!effective) return false;
      const duration = payload.business.slotDurationMinutes ?? 10;
      if (payload.business.justAddToList) return Boolean(estimateQueueStart({
        activeCount: payload.queueCounts.find((entry) => entry.locationId === selectedLocationId && entry.dateKey === dateKey)?.count ?? 0,
        appointmentsPerSlot: payload.business.appointmentsPerSlot, selectedDateKey: dateKey, slotDurationMinutes: duration,
        workingHours: effective.workingHours, workingHoursSecondWindow: effective.workingHoursSecondWindow,
      }));
      return buildSlotStartsForDate({ selectedDateKey: dateKey, slotDurationMinutes: duration, workingHours: effective.workingHours, workingHoursSecondWindow: effective.workingHoursSecondWindow })
        .some((slot) => (!recurringTime || (slot.dayOffset === recurringTime.dayOffset && slot.minutes === recurringTime.minutes))
          && new Date(slot.startsAt).getTime() > clock
          && (payload.slotCounts.find((entry) => entry.locationId === selectedLocationId && entry.startsAt === slot.startsAt)?.count ?? 0) < payload.business.appointmentsPerSlot);
    }) : null;
  const selectedDateKey = recurrenceActive ? recurrenceStart ?? "" : onceDateKey;
  const selectedSlotIso = recurrenceActive && recurringTime && selectedDateKey
    ? createUtcSlotIso(selectedDateKey, recurringTime.dayOffset, recurringTime.minutes) : onceSlotIso;

  useEffect(() => {
    lookupVersionRef.current += 1;
    setVerifiedTarget(null);
    setLookupError(null);
    setRecurrenceMode("none");
    setRecurringMonthDays([]);
    setRecurringTime(null);
  }, [targetPhone, selectedOwnerIdentifier, selectedServiceId, shareCode]);

  async function lookupTarget() {
    if (lookupPendingRef.current || !canInvite) return;
    setVerifiedTarget(null);
    setLookupError(null);
    if (!/^(?:\+[1-9]\d{7,14}|\d{10})$/.test(normalizedTargetPhone)) {
      setLookupError("Enter a full registered phone number.");
      return;
    }
    const context = lookupContext;
    const version = lookupVersionRef.current;
    lookupPendingRef.current = true;
    setIsLookingUp(true);
    try {
      const query = new URLSearchParams({ lookupPhone: normalizedTargetPhone, ownerIdentifier: selectedOwnerIdentifier, serviceId: selectedServiceId });
      const result = await readJson<{ user: { identifier: string; name: string } }>(await fetch(`/api/apportion/${encodeURIComponent(shareCode)}?${query}`));
      if (lookupVersionRef.current === version && lookupContextRef.current === context) setVerifiedTarget({ ...result.user, context });
    } catch (error) {
      if (lookupVersionRef.current === version && lookupContextRef.current === context) setLookupError(error instanceof Error ? error.message : "Unable to find this user.");
    } finally {
      lookupPendingRef.current = false;
      setIsLookingUp(false);
    }
  }

  async function loadBookingPage(ownerIdentifier = selectedOwnerIdentifier, serviceId = selectedServiceId, preserveLocation = false, preserveFeedback = false, preferredLocationId?: string) {
    setIsLoading(true);

    try {
      const query = new URLSearchParams();
      if (ownerIdentifier) query.set("ownerIdentifier", ownerIdentifier);
      if (serviceId) query.set("serviceId", serviceId);
      const nextPayload = await readJson<BookingPayload>(
        await fetch(`/api/apportion/${encodeURIComponent(shareCode)}${query.size ? `?${query}` : ""}`),
      );
      setPayload(nextPayload);
      setSelectedServiceId(nextPayload.serviceId);
      setSelectedOwnerIdentifier(nextPayload.businessOwnerIdentifier);
      setRecurrenceMode("none");
      setRecurringEndDateKey("");
      setRecurringWeekdayKeys([]);
      const requestedLocation = preferredLocationId
        ? nextPayload.business.locations.find((location) => location.id === preferredLocationId)
        : initialLocationId
          ? nextPayload.business.locations.find((location) => location.id === initialLocationId || location.address === initialLocationId)
        : undefined;
      const previousLocation = preserveLocation
        ? nextPayload.business.locations.find((location) => location.id === selectedLocationId)
        : undefined;
      setSelectedLocationId(requestedLocation?.id ?? previousLocation?.id ?? nextPayload.business.locations[0]?.id ?? "");
      setSelectedSlotIso(null);
      setRecurringTime(null);
      setSlotPage(0);
      setCarouselIndex(0);
      setFailedPromotionalImages([]);
      setWeekOffset(0);
      if (!preserveFeedback) setFeedback(null);
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Unable to load this booking page.");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void loadBookingPage();
  }, [shareCode, initialOwnerIdentifier, initialServiceId, initialLocationId]);

  useEffect(() => {
    if (!payload) {
      return;
    }
    if (recurrenceActive) return;

    if (!payload.business.recurringBookingsEnabled) {
      setRecurrenceMode("none");
      setRecurringEndDateKey("");
      setRecurringWeekdayKeys([]);
    }

    const selectedLocation = payload.business.locations.find((location) => location.id === selectedLocationId);

    if (!selectedLocation) {
      return;
    }

    const today = createDateFromKey(getIstDateKey(new Date(clock)));

    const maxDate = new Date(today);
    maxDate.setMonth(today.getMonth() + 6);
    const dayCount = Math.ceil((maxDate.getTime() - today.getTime()) / (24 * 60 * 60 * 1000)) + 1;
    const queueCountsByDate = Object.fromEntries(payload.queueCounts
      .filter((entry) => entry.locationId === selectedLocation.id)
      .map((entry) => [entry.dateKey, entry.count]));
    const dateAvailable = (key: string) => {
      const effective = resolveEffectiveLocation(payload.business, selectedLocation, key);
      if (!effective) return false;
      if (payload.business.justAddToList) return Boolean(estimateQueueStart({ activeCount: queueCountsByDate[key] ?? 0, appointmentsPerSlot: payload.business.appointmentsPerSlot, selectedDateKey: key, slotDurationMinutes: payload.business.slotDurationMinutes ?? 10, workingHours: effective.workingHours, workingHoursSecondWindow: effective.workingHoursSecondWindow }));
      return buildSlotStartsForDate({ selectedDateKey: key, slotDurationMinutes: payload.business.slotDurationMinutes ?? 10, workingHours: effective.workingHours, workingHoursSecondWindow: effective.workingHoursSecondWindow }).some((slot) => new Date(slot.startsAt).getTime() > clock && (payload.slotCounts.find((entry) => entry.locationId === selectedLocation.id && entry.startsAt === slot.startsAt)?.count ?? 0) < payload.business.appointmentsPerSlot);
    };
    if (dateAvailable(selectedDateKey) && selectedDateKey <= createDateKey(maxDate)) return;
    setSelectedSlotIso(null);
    const nextWorkingDate = Array.from({ length: dayCount }, (_, offset) => {
      const date = new Date(today);
      date.setDate(today.getDate() + offset);
      return date;
    }).find((date) => {
      const key = createDateKey(date);
      const effectiveLocation = resolveEffectiveLocation(payload.business, selectedLocation, key);
      const isWorkingDate = Boolean(effectiveLocation);

      if (!isWorkingDate) return false;
      if (payload.business.justAddToList) return Boolean(estimateQueueStart({
          activeCount: queueCountsByDate[key] ?? 0,
          appointmentsPerSlot: payload.business.appointmentsPerSlot,
          selectedDateKey: key,
          slotDurationMinutes: payload.business.slotDurationMinutes ?? 10,
          workingHours: effectiveLocation?.workingHours ?? "",
          workingHoursSecondWindow: effectiveLocation?.workingHoursSecondWindow ?? "",
        }));
      const counts = Object.fromEntries(payload.slotCounts
        .filter((entry) => entry.locationId === selectedLocation.id)
        .map((entry) => [entry.startsAt, entry.count]));
      return buildSlotStartsForDate({
        selectedDateKey: key,
        slotDurationMinutes: payload.business.slotDurationMinutes ?? 10,
        workingHours: effectiveLocation?.workingHours ?? "",
        workingHoursSecondWindow: effectiveLocation?.workingHoursSecondWindow ?? "",
      }).some((slot) => new Date(slot.startsAt).getTime() > Date.now()
        && (counts[slot.startsAt] ?? 0) < payload.business.appointmentsPerSlot);
    });

    if (nextWorkingDate) {
      setSelectedDateKey(createDateKey(nextWorkingDate));
      setRecurringEndDateKey(createDateKey(nextWorkingDate));
      setRecurringWeekdayKeys([WEEKDAY_KEYS[nextWorkingDate.getDay()] ?? "Sun"]);
    } else setSelectedDateKey("");
  }, [payload, selectedLocationId, selectedDateKey, clock, recurrenceActive]);

  useEffect(() => {
    if (!payload || payload.business.justAddToList || !selectedLocationId || !selectedDateKey) return;
    const location = payload.business.locations.find((entry) => entry.id === selectedLocationId);
    if (!location) return;
    const effective = resolveEffectiveLocation(payload.business, location, selectedDateKey);
    if (!effective) { setSelectedSlotIso(null); return; }
    const counts = Object.fromEntries(payload.slotCounts
      .filter((entry) => entry.locationId === selectedLocationId)
      .map((entry) => [entry.startsAt, entry.count]));
    const firstAvailable = buildSlotStartsForDate({
      selectedDateKey,
      slotDurationMinutes: payload.business.slotDurationMinutes ?? 10,
      workingHours: effective.workingHours,
      workingHoursSecondWindow: effective.workingHoursSecondWindow,
    }).find((slot) => new Date(slot.startsAt).getTime() > Date.now()
      && (counts[slot.startsAt] ?? 0) < payload.business.appointmentsPerSlot);
    if (!firstAvailable) {
      setSelectedSlotIso(null);
      setSlotPage(0);
      return;
    }
    if (!selectedSlotIso || !buildSlotStartsForDate({
      selectedDateKey,
      slotDurationMinutes: payload.business.slotDurationMinutes ?? 10,
      workingHours: effective.workingHours,
      workingHoursSecondWindow: effective.workingHoursSecondWindow,
    }).some((slot) => slot.startsAt === selectedSlotIso && new Date(slot.startsAt).getTime() > Date.now()
      && (counts[slot.startsAt] ?? 0) < payload.business.appointmentsPerSlot)) {
      setSelectedSlotIso(firstAvailable.startsAt);
    }
  }, [payload, selectedDateKey, selectedLocationId, selectedSlotIso, clock]);

  useEffect(() => {
    const imageCount = payload?.providerProfile.promotionalImageDataUrls
      .map(normalizeImageDataUrl)
      .filter((imageUrl) => !failedPromotionalImages.includes(imageUrl)).length ?? 0;

    setCarouselIndex((current) => imageCount ? current % imageCount : 0);

    if (imageCount < 2 || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }

    const intervalId = window.setInterval(() => {
      setCarouselIndex((current) => (current + 1) % imageCount);
    }, 8000);

    return () => window.clearInterval(intervalId);
  }, [failedPromotionalImages, payload]);

  async function handleBookAppointment() {
    if (bookingPendingRef.current) return;
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

    if (isTargeted && !targetIsVerified) {
      setFeedback("Verify the registered phone number before sending an invitation.");
      return;
    }

    if (isTargeted && recurrenceMode !== "none") {
      if (!payload.business.recurringBookingsEnabled || !canInvite) {
        setFeedback("Recurring bookings are disabled for this business.");
        return;
      }

      if (recurrenceMode === "weekly" ? !effectiveRecurringWeekdays.length : !recurringMonthDays.length) {
        setFeedback("Choose at least one recurring day.");
        return;
      }

      if (recurrenceError || !plannedDateKeys.length) {
        setFeedback(recurrenceError || "Choose a valid appointment duration.");
        return;
      }
    }

    bookingPendingRef.current = true;
    setIsBooking(true);
    setTicketUrl(null);

    try {
      const bookingPayload = await readJson<BookingResponse>(
        await fetch(`/api/apportion/${encodeURIComponent(shareCode)}`, {
          body: JSON.stringify({
            ownerIdentifier: selectedOwnerIdentifier,
            serviceId: selectedServiceId,
            locationId: selectedLocationId,
            slotDateKey: selectedDateKey,
            notes,
            targetPhone: isTargeted ? normalizedTargetPhone : undefined,
            recurrence: isTargeted && recurrenceMode !== "none" && canInvite
              && payload.business.recurringBookingsEnabled
              ? {
                  durationCount: recurringDuration,
                  mode: recurrenceMode,
                  ...(recurrenceMode === "weekly" ? { weekdayKeys: effectiveRecurringWeekdays } : { monthDays: recurringMonthDays }),
                }
              : null,
            startsAt: selectedSlot?.startsAt,
          }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        }),
      );
      const successLabel = bookingPayload.invitation ? "Invitation sent." : bookingPayload.appointmentCount && bookingPayload.appointmentCount > 1
        ? `${bookingPayload.appointmentCount} appointments booked.`
        : "Appointment booked.";

      const ticketUrl = bookingPayload.invitation
        ? `/user?tab=apportion&invitationId=${encodeURIComponent(bookingPayload.invitation.id)}`
        : bookingPayload.appointment ? `/user?tab=apportion&appointmentId=${encodeURIComponent(bookingPayload.appointment.id)}` : "/user?tab=apportion";
      setFeedback(bookingPayload.caution ? `${successLabel} ${bookingPayload.caution}` : successLabel);
      setTicketUrl(ticketUrl);
      markNotificationPromptOpportunity();
      setNotes("");
      setTargetPhone("");
      setVerifiedTarget(null);
      setRecurrenceMode("none");
      setRecurringEndDateKey(selectedDateKey);
      setRecurringWeekdayKeys([getWeekdayKeyForDateKey(selectedDateKey)]);
      setSelectedSlotIso(null);
      await loadBookingPage(selectedOwnerIdentifier, selectedServiceId, true, true);
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Unable to book the appointment.");
    } finally {
      bookingPendingRef.current = false;
      setIsBooking(false);
    }
  }

  if (isLoading) {
    return <div className="empty-state"><p className="muted-text">Loading appointment page...</p></div>;
  }

  if (!payload) {
    return <div className="empty-state"><p className="muted-text">{feedback ?? "Unable to load this appointment page."}</p></div>;
  }

  const today = createDateFromKey(getIstDateKey(new Date(clock)));
  today.setHours(0, 0, 0, 0);
  const selectedLocation = payload.business.locations.find((location) => location.id === selectedLocationId) ?? null;
  const effectiveSelectedLocation = selectedLocation
    ? resolveEffectiveLocation(payload.business, selectedLocation, selectedDateKey)
    : null;
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
  weekStartDate.setDate(today.getDate() - today.getDay() + (weekOffset * 7));
  const weekDates = Array.from({ length: 7 }, (_, dayOffset) => {
    const date = new Date(weekStartDate);
    date.setDate(weekStartDate.getDate() + dayOffset);
    return date;
  });
  const workingHoursText = [effectiveSelectedLocation?.workingHours, effectiveSelectedLocation?.workingHoursSecondWindow].filter(Boolean).join(" and ");
  const availableSlots = effectiveSelectedLocation ? buildSlotStartsForDate({
    selectedDateKey,
    slotDurationMinutes,
    workingHours: effectiveSelectedLocation.workingHours,
    workingHoursSecondWindow: effectiveSelectedLocation.workingHoursSecondWindow,
  }).map((slot) => {
    const startsAt = slot.startsAt;
    const isPast = new Date(startsAt).getTime() <= Date.now();
    const bookedCount = slotCountsByIso[startsAt] ?? 0;
    const remainingCount = Math.max(0, payload.business.appointmentsPerSlot - bookedCount);
    return {
      dayOffset: slot.dayOffset,
      isAvailable: !isPast && bookedCount < payload.business.appointmentsPerSlot,
      label: slot.label,
      minutes: slot.minutes,
      remainingCount,
      startsAt,
    };
  }).filter((slot) => slot.isAvailable) : [];
  const visibleSlots = availableSlots.slice(slotPage * 6, slotPage * 6 + 6);
  const pageCount = Math.ceil(availableSlots.length / 6);
  const selectedSlot = availableSlots.find((slot) => slot.startsAt === selectedSlotIso) ?? null;
  const logoDataUrl = payload.providerProfile.imageDataUrl ? normalizeImageDataUrl(payload.providerProfile.imageDataUrl) : null;
  const profileImageDataUrl = payload.providerProfile.profileImageDataUrl ? normalizeImageDataUrl(payload.providerProfile.profileImageDataUrl) : null;
  const promotionalImageDataUrls = payload.providerProfile.promotionalImageDataUrls
    .map(normalizeImageDataUrl)
    .filter((imageUrl) => !failedPromotionalImages.includes(imageUrl));
  const queueEstimate = payload.business.justAddToList
    && effectiveSelectedLocation
    ? estimateQueueStart({
        activeCount: queueCountsByDateKey[selectedDateKey] ?? 0,
        appointmentsPerSlot: payload.business.appointmentsPerSlot,
        selectedDateKey,
        slotDurationMinutes,
        workingHours: effectiveSelectedLocation.workingHours,
        workingHoursSecondWindow: effectiveSelectedLocation.workingHoursSecondWindow,
      })
    : null;
  const queueCountForSelectedDate = queueCountsByDateKey[selectedDateKey] ?? 0;
  const selectedDateLabel = createDateFromKey(selectedDateKey).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  const businessContactText = [formatPhoneNumberForDisplay(payload.providerProfile.ownerIdentifier, { showFullPhoneNumber: true }), payload.providerProfile.address]
    .filter(Boolean)
    .join(" • ");
  const selectedAddressKey = `${selectedOwnerIdentifier}::${selectedLocationId}`;
  const selectedAddressOption = payload.addressOptions.find((option) => option.key === selectedAddressKey);
  const addressServices = selectedAddressOption?.contexts ?? [];
  const recurringAllowed = isTargeted && payload.business.recurringBookingsEnabled;
  const recurringWorkingWeekdays = WEEKDAY_KEYS.filter((_, weekday) => {
    if (!selectedLocation) return false;
    const weeklyOverride = payload.business.appointmentWeeklyHoursOverrides.find((entry) => entry.weekday === weekday);
    if (weeklyOverride) {
      const hours = weeklyOverride.locations.find((entry) => entry.locationId === selectedLocation.id);
      return Boolean(hours?.workingHours || hours?.workingHoursSecondWindow);
    }
    if (selectedLocation.dailyHours) {
      const hours = resolveApportionDailySchedule({ dailyHours: selectedLocation.dailyHours })[weekday];
      return Boolean(hours.workingHours || hours.workingHoursSecondWindow);
    }
    return parseWorkingDays(selectedLocation.workingDays).has(WEEKDAY_NAMES[weekday]);
  });
  const effectiveRecurringWeekdays = recurringWeekdayKeys.filter((day) => recurringWorkingWeekdays.includes(day as typeof WEEKDAY_KEYS[number]));
  let plannedDateKeys: string[] = [];
  let recurrenceError: string | null = null;
  if (recurringAllowed && recurrenceMode !== "none") {
    try {
      if (!recurrenceStart) throw new Error("No available upcoming date matches the selected recurring days and time.");
      plannedDateKeys = planApportionDateKeys(selectedDateKey, {
        mode: recurrenceMode,
        durationCount: recurringDuration,
        ...(recurrenceMode === "weekly" ? { weekdayKeys: effectiveRecurringWeekdays } : { monthDays: recurringMonthDays }),
      }, (dateKey) => {
        const effective = selectedLocation && resolveEffectiveLocation(payload.business, selectedLocation, dateKey);
        if (!effective) return false;
        if (payload.business.justAddToList || !selectedSlot) return true;
        return buildSlotStartsForDate({ selectedDateKey: dateKey, slotDurationMinutes, workingHours: effective.workingHours, workingHoursSecondWindow: effective.workingHoursSecondWindow }).some((slot) => slot.dayOffset === selectedSlot.dayOffset && slot.minutes === selectedSlot.minutes);
      }, createDateKey(maxBookableDate));
    } catch (error) {
      recurrenceError = error instanceof Error ? error.message : "Choose valid recurring dates.";
    }
  }

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
            <h1>{payload.providerProfile.name || payload.business.name || "Business appointment"}</h1>
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
              <div className="apportion-carousel-stage">
                {promotionalImageDataUrls.map((imageUrl, index) => (
                  <img
                    alt={index === carouselIndex ? `Business promotion ${index + 1} of ${promotionalImageDataUrls.length}` : ""}
                    aria-hidden={index !== carouselIndex}
                    className={`apportion-carousel-slide${index === carouselIndex ? " is-active" : ""}`}
                    key={imageUrl}
                    src={imageUrl}
                    onError={() => setFailedPromotionalImages((current) => current.includes(imageUrl) ? current : [...current, imageUrl])}
                  />
                ))}
              </div>
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
            {canInvite ? (
              <div className="field apportion-invitation-target">
                <label htmlFor="apportion-target-phone">Customer phone</label>
                <div className="apportion-target-lookup">
                  <input autoComplete="tel" id="apportion-target-phone" inputMode="tel" type="tel" value={targetPhone} onChange={(event) => {
                    lookupVersionRef.current += 1;
                    setTargetPhone(event.target.value);
                    setVerifiedTarget(null);
                    setLookupError(null);
                    setRecurrenceMode("none");
                  }} />
                  <button className="button-secondary" disabled={isLookingUp || !normalizedTargetPhone || isBooking} type="button" onClick={() => void lookupTarget()}>
                    <Search aria-hidden="true" size={18} />{isLookingUp ? "Checking..." : "Verify"}
                  </button>
                </div>
                {targetIsVerified ? <strong role="status">{verifiedTarget?.name}</strong> : null}
                {lookupError ? <p className="apportion-queue-warning" role="alert">{lookupError}</p> : null}
              </div>
            ) : null}
            {recurringAllowed ? (
              <div className="field apportion-recurrence-controls">
                <span className="field-label">Repeat</span>
                <div className="apportion-recurrence-grid" role="group" aria-label="Repeat">
                  {(["none", "weekly", "monthly"] as const).map((mode) => <button className="apportion-recurrence-choice" aria-pressed={recurrenceMode === mode} key={mode} type="button" onClick={() => {
                    setRecurrenceMode(mode);
                    setRecurringTime(null);
                    setSelectedSlotIso(null);
                    setSlotPage(0);
                    setRecurringWeekdayKeys([getWeekdayKeyForDateKey(onceDateKey || todayKey)]);
                    setRecurringMonthDays([createDateFromKey(onceDateKey || todayKey).getDate()]);
                    setFeedback(null);
                  }}>{mode === "none" ? "Once" : mode === "weekly" ? "Weekly" : "Monthly"}</button>)}
                </div>
                {recurrenceMode !== "none" ? <>
                  <span className="field-label">Duration</span>
                  <div className="apportion-recurrence-grid is-duration" role="group" aria-label="Duration">{[1, 2, 3, 4, 5, 6].map((count) => <button className="apportion-recurrence-choice" aria-pressed={recurringDuration === count} key={count} type="button" onClick={() => setRecurringDuration(count)}>{count}{recurrenceMode === "weekly" ? "W" : "M"}</button>)}</div>
                  <div className={`apportion-repeat-days${recurrenceMode === "monthly" ? " is-monthly" : ""}`} role="group" aria-label={recurrenceMode === "weekly" ? "Recurring weekdays" : "Recurring month dates"}>
                    {recurrenceMode === "weekly" ? WEEKDAY_KEYS.map((day) => (
                      <button aria-pressed={effectiveRecurringWeekdays.includes(day)} className="apportion-recurrence-choice" disabled={!recurringWorkingWeekdays.includes(day)} key={day} type="button" onClick={() => { setSlotPage(0); setRecurringWeekdayKeys((days) => days.includes(day) ? days.filter((entry) => entry !== day) : [...days, day]); }}>{day}</button>
                    )) : Array.from({ length: 31 }, (_, index) => index + 1).map((day) => (
                      <button aria-pressed={recurringMonthDays.includes(day)} className="apportion-recurrence-choice" key={day} type="button" onClick={() => { setSlotPage(0); setRecurringMonthDays((days) => days.includes(day) ? days.filter((entry) => entry !== day) : [...days, day]); }}>{day}</button>
                    ))}
                  </div>
                  <p className="muted-text" role="status">{recurrenceStart ? `Starts ${recurrenceStart} · ` : ""}{plannedDateKeys.length} appointments</p>
                  {plannedDateKeys.length ? <details><summary>Dates</summary><ol>{plannedDateKeys.map((dateKey) => <li key={dateKey}>{dateKey}</li>)}</ol></details> : null}
                  {recurrenceError ? <p className="apportion-queue-warning" role="alert">{recurrenceError}</p> : null}
                </> : null}
              </div>
            ) : null}
            {addressServices.length > 1 ? (
              <div className="field">
                <label htmlFor="apportion-service">Service</label>
                {addressServices.length > 4 ? (
                  <select
                    className="select-field"
                    id="apportion-service"
                    value={`${selectedOwnerIdentifier}::${selectedServiceId}`}
                    onChange={(event) => {
                      const service = addressServices.find((entry) => `${entry.ownerIdentifier}::${entry.serviceId}` === event.target.value);
                      if (!service) return;
                      setSelectedOwnerIdentifier(service.ownerIdentifier);
                      setSelectedServiceId(service.serviceId);
                      setSelectedLocationId("");
                      setFeedback(null);
                      void loadBookingPage(service.ownerIdentifier, service.serviceId, false, false, selectedLocationId);
                    }}
                  >
                    {addressServices.map((service) => (
                      <option key={`${service.ownerIdentifier}::${service.serviceId}`} value={`${service.ownerIdentifier}::${service.serviceId}`}>
                        {service.serviceName} · {service.businessName}
                      </option>
                    ))}
                  </select>
                ) : (
                  <div className="apportion-service-choices" role="group" aria-label="Choose a service">
                    {addressServices.map((service) => {
                      const isSelected = service.ownerIdentifier === selectedOwnerIdentifier && service.serviceId === selectedServiceId;
                      return (
                        <button
                          aria-pressed={isSelected}
                          className={`apportion-service-choice${isSelected ? " is-selected" : ""}`}
                          key={`${service.ownerIdentifier}::${service.serviceId}`}
                          type="button"
                          onClick={() => {
                            if (isSelected) return;
                            setSelectedOwnerIdentifier(service.ownerIdentifier);
                            setSelectedServiceId(service.serviceId);
                            setFeedback(null);
                            void loadBookingPage(service.ownerIdentifier, service.serviceId, false, false, selectedLocationId);
                          }}
                        >
                          <strong>{service.serviceName}</strong>
                          <span>{service.businessName}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            ) : null}

            <div className="field apportion-location-selector">
              <label>Business address</label>
              <div className="apportion-location-cards">
                {payload.addressOptions.map((option) => {
                  const selected = option.key === selectedAddressKey;
                  const activeContext = option.contexts.find((context) => context.ownerIdentifier === selectedOwnerIdentifier && context.serviceId === selectedServiceId) ?? option.contexts[0];
                  if (!activeContext) return null;
                  const location = activeContext.business.locations[0];
                  if (!location) return null;
                  return (
                    <button
                      aria-pressed={selected}
                      className={`apportion-location-card${selected ? " is-selected" : ""}`}
                      key={option.key}
                      type="button"
                      onClick={() => {
                        const context = option.contexts.find((entry) => entry.ownerIdentifier === selectedOwnerIdentifier && entry.serviceId === selectedServiceId) ?? option.contexts[0];
                        if (!context) return;
                        setSelectedLocationId(location.id);
                        setSelectedOwnerIdentifier(context.ownerIdentifier);
                        setSelectedServiceId(context.serviceId);
                        setSelectedSlotIso(null);
                        setRecurringTime(null);
                        setSlotPage(0);
                        setWeekOffset(0);
                        setFeedback(null);
                        if (context.ownerIdentifier !== selectedOwnerIdentifier || context.serviceId !== selectedServiceId) {
                          void loadBookingPage(context.ownerIdentifier, context.serviceId, false, false, location.id);
                        }
                      }}
                    >
                      {!matchApportionIdentity(payload.providerProfile.ownerIdentifier, activeContext.ownerIdentifier) ? <strong>{Array.from(new Set(option.contexts.map((context) => context.serviceName))).join(" · ")}</strong> : null}
                      <span>{option.location.address}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {selectedLocation && !recurrenceActive ? (
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
                    const effectiveDateLocation = resolveEffectiveLocation(payload.business, selectedLocation, dateKey);
                    const isDateInWindow = Boolean(effectiveDateLocation) && date <= maxBookableDate;
                    const hasQueueCapacity = !payload.business.justAddToList || Boolean(estimateQueueStart({
                      activeCount: queueCountsByDateKey[dateKey] ?? 0,
                      appointmentsPerSlot: payload.business.appointmentsPerSlot,
                      selectedDateKey: dateKey,
                      slotDurationMinutes,
                      workingHours: effectiveDateLocation?.workingHours ?? "",
                      workingHoursSecondWindow: effectiveDateLocation?.workingHoursSecondWindow ?? "",
                    }));
                    const hasSlotCapacity = payload.business.justAddToList || Boolean(effectiveDateLocation && buildSlotStartsForDate({ selectedDateKey: dateKey, slotDurationMinutes, workingHours: effectiveDateLocation.workingHours, workingHoursSecondWindow: effectiveDateLocation.workingHoursSecondWindow }).some((slot) => new Date(slot.startsAt).getTime() > clock && (slotCountsByIso[slot.startsAt] ?? 0) < payload.business.appointmentsPerSlot));
                    const isAvailableDate = isDateInWindow && hasQueueCapacity && hasSlotCapacity;
                    const disabledReason = date > maxBookableDate ? "Outside booking horizon" : !effectiveDateLocation ? "Closed or provider on leave" : date < today && !isAvailableDate ? "Past service day" : "No remaining availability";
                    const isSelected = dateKey === selectedDateKey;

                    return (
                      <button
                        className={`apportion-calendar-day${isAvailableDate ? " is-working" : " is-unavailable"}${isSelected && isAvailableDate ? " is-selected" : ""}`}
                        aria-label={`${dateKey}${isAvailableDate ? "" : `: ${disabledReason}`}`}
                        title={isAvailableDate ? dateKey : disabledReason}
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
                <p className="muted-text">Queue size: {queueCountForSelectedDate}</p>
                {queueEstimate ? <p className="muted-text">Estimated start time: {queueEstimate.label}</p> : null}
                {selectedLocation && !queueEstimate ? <p className="muted-text apportion-queue-warning">Queue booking is unavailable for this date.</p> : null}
              </div>
            ) : (
              <div className="field">
                <label htmlFor="apportion-appointment-time">Appointment time</label>
                <div className="apportion-slot-pager">
                  <button aria-label="Previous times" className="icon-button button-secondary" disabled={slotPage === 0} type="button" onClick={() => setSlotPage((page) => Math.max(0, page - 1))}>
                    <ChevronLeft aria-hidden="true" size={18} />
                  </button>
                  <span className="muted-text">{pageCount ? `${slotPage + 1} / ${pageCount}` : "0 times"}</span>
                  <button aria-label="Next times" className="icon-button button-secondary" disabled={slotPage + 1 >= pageCount} type="button" onClick={() => setSlotPage((page) => Math.min(pageCount - 1, page + 1))}>
                    <ChevronRight aria-hidden="true" size={18} />
                  </button>
                </div>
                {visibleSlots.length ? (
                  <div className="apportion-slot-grid" role="group" aria-label="Available appointment times">
                    {visibleSlots.map((slot) => (
                      <button
                        aria-pressed={selectedSlotIso === slot.startsAt}
                        className={`apportion-slot-chip${selectedSlotIso === slot.startsAt ? " is-selected" : ""}`}
                        key={slot.startsAt}
                        type="button"
                        onClick={() => { setSelectedSlotIso(slot.startsAt); if (recurrenceActive) setRecurringTime({ dayOffset: slot.dayOffset, minutes: slot.minutes }); setFeedback(null); }}
                      >
                        {slot.label}
                        {payload.business.showRemainingBookings && payload.business.appointmentsPerSlot > 1 ? <span>{slot.remainingCount} left</span> : null}
                      </button>
                    ))}
                  </div>
                ) : <p className="muted-text apportion-queue-warning">No availability for this date.</p>}
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
            {feedback ? <p className="muted-text" role="status">{feedback}{ticketUrl ? <> <a href={ticketUrl}>My Dashboard</a></> : null}</p> : null}
            <div className="inline-actions">
              <button className="button" disabled={isBooking || isLookingUp || (isTargeted && !targetIsVerified) || !selectedLocation || !selectedDateKey || (!payload.business.justAddToList && !selectedSlot) || (payload.business.justAddToList && !queueEstimate) || (recurringAllowed && recurrenceMode !== "none" && (!!recurrenceError || !plannedDateKeys.length))} type="button" onClick={() => void handleBookAppointment()}>
                {isBooking ? <LoaderCircle aria-hidden="true" className="apportion-spinner" size={18} /> : isTargeted ? <Send aria-hidden="true" size={18} /> : null}{isBooking ? isTargeted ? "Sending..." : "Booking..." : isTargeted ? "Send Invitation" : payload.business.justAddToList ? "Join appointment queue" : "Book appointment"}
              </button>
              <a className="button-secondary" href="/user?tab=apportion">My Dashboard</a>
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