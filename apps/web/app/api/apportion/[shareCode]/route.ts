import { getSessionDisplayName, getSessionIdentifier } from "@trapit/auth";
import { type WorkspaceBranding } from "@trapit/testing";
import { NextResponse } from "next/server";

import { createApportionAppointment, listApportionAppointmentsForOwner, listApportionSlotCounts } from "../../../../lib/apportion-store";
import { publishWorkspaceEvent } from "../../../../lib/realtime-events";
import { getWebSession } from "../../../../lib/session";
import { getWorkspaceBrandingByAppointmentShareCode } from "../../../../lib/testing-store";

const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const WEEKDAY_KEYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const IST_OFFSET_MINUTES = 5 * 60 + 30;

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

function createDateFromKey(value: string) {
  const [year, month, day] = value.split("-").map((part) => Number.parseInt(part, 10));

  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return null;
  }

  return new Date(year, month - 1, day);
}

function createDateFromKeyUtc(value: string) {
  const [year, month, day] = value.split("-").map((part) => Number.parseInt(part, 10));

  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return null;
  }

  return new Date(Date.UTC(year, month - 1, day));
}

function getWeekdayKey(value: Date) {
  return WEEKDAY_KEYS[value.getUTCDay()] ?? "Sun";
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

function getSlotStepMinutes(slotDurationMinutes: number) {
  return slotDurationMinutes <= 60 ? 15 : slotDurationMinutes;
}

function buildSlotStartsForDate(branding: WorkspaceBranding, slotDateKey: string) {
  const slotDurationMinutes = branding.slotDurationMinutes ?? 30;
  const slotStepMinutes = getSlotStepMinutes(slotDurationMinutes);
  const ranges = [branding.workingHours, branding.workingHoursSecondWindow]
    .map((range) => parseTimeRange(range))
    .filter((range): range is { durationMinutes: number; startMinutes: number } => Boolean(range));
  const effectiveRanges = ranges.length ? ranges : [{ durationMinutes: 8 * 60, startMinutes: 10 * 60 }];

  return effectiveRanges.flatMap((range) => {
    const totalSlots = Math.max(0, Math.floor((range.durationMinutes - slotDurationMinutes) / slotStepMinutes) + 1);

    return Array.from({ length: totalSlots }, (_, index) => {
      const absoluteMinutes = range.startMinutes + (index * slotStepMinutes);
      const dayOffset = Math.floor(absoluteMinutes / (24 * 60));
      const minutesOfDay = ((absoluteMinutes % (24 * 60)) + (24 * 60)) % (24 * 60);
      const startsAt = createUtcSlotIso(slotDateKey, dayOffset, minutesOfDay);

      if (!startsAt) {
        return null;
      }

      return {
        dayOffset,
        minutesOfDay,
        startsAt,
      };
    }).filter((slot): slot is { dayOffset: number; minutesOfDay: number; startsAt: string } => Boolean(slot));
  });
}

function buildRecurringDateKeys(input: {
  endDateKey: string;
  slotDateKey: string;
  weekdayKeys: string[];
}) {
  const startDate = createDateFromKeyUtc(input.slotDateKey);
  const endDate = createDateFromKeyUtc(input.endDateKey);

  if (!startDate || !endDate) {
    throw new Error("Choose a valid recurring date range.");
  }

  if (endDate.getTime() < startDate.getTime()) {
    throw new Error("Recurring end date must be on or after the selected appointment date.");
  }

  const weekdayKeys = Array.from(new Set(input.weekdayKeys.map((value) => value.trim()).filter(Boolean)));

  if (!weekdayKeys.length) {
    throw new Error("Choose at least one recurring weekday.");
  }

  const dateKeys: string[] = [];

  for (const cursor = new Date(startDate); cursor.getTime() <= endDate.getTime(); cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    if (!weekdayKeys.includes(getWeekdayKey(cursor))) {
      continue;
    }

    dateKeys.push(createDateKeyUtc(cursor));
  }

  if (!dateKeys.length) {
    throw new Error("No recurring appointments fall within the selected date range.");
  }

  return dateKeys;
}

function validateBookingDate(branding: WorkspaceBranding, slotDateKey: string) {
  const workingDays = parseWorkingDays(branding.workingDays);
  const requestedLocalDate = createDateFromKey(slotDateKey);
  const requestedDateUtc = createDateFromKeyUtc(slotDateKey);
  const advanceBookingWeeks = branding.advanceBookingWeeks ?? 4;
  const todayIstDateKey = getIstDateKey(new Date());
  const todayUtcDate = createDateFromKeyUtc(todayIstDateKey);

  if (!requestedLocalDate || !requestedDateUtc || !todayUtcDate) {
    throw new Error("Choose a valid appointment date.");
  }

  const dayName = WEEKDAY_NAMES[requestedLocalDate.getDay()];

  if (!workingDays.has(dayName)) {
    throw new Error("Choose a working day for this business.");
  }

  if (slotDateKey < todayIstDateKey) {
    throw new Error("Choose a future appointment date.");
  }

  const maxDate = new Date(todayUtcDate);
  maxDate.setUTCDate(todayUtcDate.getUTCDate() + (advanceBookingWeeks * 7) - 1);
  const maxDateKey = createDateKeyUtc(maxDate);

  if (slotDateKey > maxDateKey) {
    throw new Error("Choose a date within the allowed advance booking period.");
  }
}

function validateRequestedSlot(branding: WorkspaceBranding, startsAt: Date, slotDateKey: string) {
  validateBookingDate(branding, slotDateKey);

  const allowedSlotStarts = new Set(buildSlotStartsForDate(branding, slotDateKey).map((slot) => slot.startsAt));

  if (!allowedSlotStarts.has(startsAt.toISOString())) {
    throw new Error("Choose one of the available appointment slots.");
  }
}

function estimateQueueStart(input: {
  activeCount: number;
  appointmentsPerSlot: number;
  branding: WorkspaceBranding;
  serviceDateKey: string;
}) {
  const slotDurationMinutes = input.branding.slotDurationMinutes ?? 30;
  const slotStarts = buildSlotStartsForDate(input.branding, input.serviceDateKey);
  const slotIndex = Math.floor(input.activeCount / Math.max(1, input.appointmentsPerSlot));

  if (!slotStarts.length) {
    const fallbackDate = createDateFromKey(input.serviceDateKey) ?? new Date();
    fallbackDate.setHours(10, 0, 0, 0);
    fallbackDate.setMinutes(fallbackDate.getMinutes() + (slotIndex * slotDurationMinutes));

    return { exceedsWorkingHours: slotIndex > 0, startsAt: fallbackDate.toISOString() };
  }

  if (slotIndex < slotStarts.length) {
    return { exceedsWorkingHours: false, startsAt: slotStarts[slotIndex].startsAt };
  }

  const overflowSlot = new Date(slotStarts[slotStarts.length - 1].startsAt);
  overflowSlot.setMinutes(overflowSlot.getMinutes() + ((slotIndex - (slotStarts.length - 1)) * slotDurationMinutes));

  return {
    exceedsWorkingHours: true,
    startsAt: overflowSlot.toISOString(),
  };
}

export async function GET(
  request: Request,
  { params }: { params: { shareCode: string } },
) {
  const session = await getWebSession(request);

  if (!session) {
    return NextResponse.json({ error: "Sign in to book an appointment." }, { status: 403 });
  }

  const business = await getWorkspaceBrandingByAppointmentShareCode(params.shareCode);

  if (!business) {
    return NextResponse.json({ error: "Business booking page not found." }, { status: 404 });
  }

  const [ownerAppointments, slotCounts] = await Promise.all([
    listApportionAppointmentsForOwner(business.ownerIdentifier),
    listApportionSlotCounts(business.ownerIdentifier),
  ]);
  const queueCounts = Object.entries(
    ownerAppointments
      .filter((appointment) => appointment.currentStatus === "pending" || appointment.currentStatus === "present-in-person" || appointment.currentStatus === "pushed-back")
      .reduce<Record<string, number>>((counts, appointment) => {
        counts[appointment.serviceDateKey] = (counts[appointment.serviceDateKey] ?? 0) + 1;
        return counts;
      }, {}),
  ).map(([dateKey, count]) => ({ count, dateKey }));

  return NextResponse.json({
    business: {
      address: business.branding.address,
      advanceBookingWeeks: business.branding.advanceBookingWeeks ?? 4,
      appointmentNotesPrompt: business.branding.appointmentNotesPrompt,
      appointmentsPerSlot: business.branding.appointmentsPerSlot ?? 1,
      imageDataUrl: business.branding.imageDataUrl,
      justAddToList: business.branding.justAddToList === true,
      name: business.branding.instituteName,
      ownerIdentifier: business.ownerIdentifier,
      profileImageDataUrl: business.branding.profileImageDataUrl,
      showRemainingBookings: business.branding.showRemainingBookings,
      slotDurationMinutes: business.branding.slotDurationMinutes ?? null,
      workingDays: business.branding.workingDays,
      workingHours: business.branding.workingHours,
      workingHoursSecondWindow: business.branding.workingHoursSecondWindow,
    },
    viewerName: getSessionDisplayName(session) ?? session.phoneNumber ?? session.email ?? "Registered user",
    queueCounts,
    slotCounts,
  });
}

export async function POST(
  request: Request,
  { params }: { params: { shareCode: string } },
) {
  const session = await getWebSession(request);

  if (!session) {
    return NextResponse.json({ error: "Sign in to book an appointment." }, { status: 403 });
  }

  const requesterIdentifier = getSessionIdentifier(session) ?? session.phoneNumber ?? session.email ?? null;

  if (!requesterIdentifier) {
    return NextResponse.json({ error: "Your account needs a phone number before booking appointments." }, { status: 400 });
  }

  const business = await getWorkspaceBrandingByAppointmentShareCode(params.shareCode);

  if (!business) {
    return NextResponse.json({ error: "Business booking page not found." }, { status: 404 });
  }

  const body = (await request.json()) as {
    notes?: string | null;
    recurrence?: {
      endDateKey?: string;
      mode?: "weekly";
      weekdayKeys?: string[];
    } | null;
    slotDateKey?: string;
    startsAt?: string;
  };
  const slotDateKey = body.slotDateKey?.trim() || getIstDateKey(new Date());
  const recurrence = body.recurrence?.mode === "weekly"
    ? {
        endDateKey: body.recurrence.endDateKey?.trim() ?? "",
        weekdayKeys: body.recurrence.weekdayKeys ?? [],
      }
    : null;
  const slotDateKeys = recurrence
    ? buildRecurringDateKeys({
        endDateKey: recurrence.endDateKey,
        slotDateKey,
        weekdayKeys: recurrence.weekdayKeys,
      })
    : [slotDateKey];
  const appointments = [] as Array<{ id: string }>;
  const cautionMessages = new Set<string>();

  try {
    validateBookingDate(business.branding, slotDateKey);

    if (business.branding.justAddToList) {
      const ownerAppointments = await listApportionAppointmentsForOwner(business.ownerIdentifier);
      const activeCountsByDateKey = ownerAppointments
        .filter((appointment) => appointment.currentStatus === "pending" || appointment.currentStatus === "present-in-person" || appointment.currentStatus === "pushed-back")
        .reduce<Record<string, number>>((counts, appointment) => {
          counts[appointment.serviceDateKey] = (counts[appointment.serviceDateKey] ?? 0) + 1;
          return counts;
        }, {});

      for (const recurringDateKey of slotDateKeys) {
        validateBookingDate(business.branding, recurringDateKey);

        const activeCount = activeCountsByDateKey[recurringDateKey] ?? 0;
        const estimate = estimateQueueStart({
          activeCount,
          appointmentsPerSlot: business.branding.appointmentsPerSlot ?? 1,
          branding: business.branding,
          serviceDateKey: recurringDateKey,
        });
        const appointment = await createApportionAppointment({
          appointmentsPerSlot: business.branding.appointmentsPerSlot ?? 1,
          justAddToList: true,
          notes: body.notes,
          ownerIdentifier: business.ownerIdentifier,
          ownerName: business.branding.instituteName,
          requesterIdentifier,
          requesterName: getSessionDisplayName(session) ?? requesterIdentifier,
          requesterPhone: session.phoneNumber ?? requesterIdentifier,
          serviceDateKey: recurringDateKey,
          startsAt: estimate.startsAt,
        });

        appointments.push({ id: appointment.id });
        activeCountsByDateKey[recurringDateKey] = activeCount + 1;

        if (estimate.exceedsWorkingHours) {
          cautionMessages.add("Estimated latest availability is beyond the configured working hours for at least one booked day.");
        }
      }
    } else {
      const requestedStart = new Date(body.startsAt ?? "");

      if (Number.isNaN(requestedStart.getTime())) {
        throw new Error("Choose a valid appointment date and time.");
      }

      validateRequestedSlot(business.branding, requestedStart, slotDateKey);
      const selectedSlot = buildSlotStartsForDate(business.branding, slotDateKey).find((slot) => slot.startsAt === requestedStart.toISOString());

      if (!selectedSlot) {
        throw new Error("Choose one of the available appointment slots.");
      }

      for (const recurringDateKey of slotDateKeys) {
        validateBookingDate(business.branding, recurringDateKey);
        const recurringStartsAt = createUtcSlotIso(recurringDateKey, selectedSlot.dayOffset, selectedSlot.minutesOfDay);

        if (!recurringStartsAt) {
          throw new Error("Choose a valid appointment date and time.");
        }

        const recurringStartDate = new Date(recurringStartsAt);
        validateRequestedSlot(business.branding, recurringStartDate, recurringDateKey);
        const appointment = await createApportionAppointment({
          appointmentsPerSlot: business.branding.appointmentsPerSlot ?? 1,
          notes: body.notes,
          ownerIdentifier: business.ownerIdentifier,
          ownerName: business.branding.instituteName,
          requesterIdentifier,
          requesterName: getSessionDisplayName(session) ?? requesterIdentifier,
          requesterPhone: session.phoneNumber ?? requesterIdentifier,
          serviceDateKey: recurringDateKey,
          startsAt: recurringStartsAt,
        });

        appointments.push({ id: appointment.id });
      }
    }
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to book appointment." }, { status: 400 });
  }

  publishWorkspaceEvent("apportion");
  return NextResponse.json({
    appointment: appointments[0],
    appointmentCount: appointments.length,
    caution: cautionMessages.size ? Array.from(cautionMessages).join(" ") : null,
  });
}