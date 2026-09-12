import { getSessionDisplayName, getSessionIdentifier } from "@trapit/auth";
import { type WorkspaceBranding } from "@trapit/testing";
import { NextResponse } from "next/server";

import { createApportionAppointment, listApportionAppointmentsForOwner, listApportionAppointmentsForRequester, listApportionSlotCounts } from "../../../../lib/apportion-store";
import { publishWorkspaceEvent } from "../../../../lib/realtime-events";
import { getWebSession } from "../../../../lib/session";
import { getWorkspaceBrandingByAppointmentShareCode } from "../../../../lib/testing-store";

const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const WEEKDAY_KEYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const IST_OFFSET_MINUTES = 5 * 60 + 30;

function supportsRecurringAppointments() {
  return false;
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
  return slotDurationMinutes;
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
  const requestedDateUtc = createDateFromKeyUtc(slotDateKey);
  const todayIstDateKey = getIstDateKey(new Date());
  const todayUtcDate = createDateFromKeyUtc(todayIstDateKey);

  if (!requestedDateUtc || !todayUtcDate) {
    throw new Error("Choose a valid appointment date.");
  }

  const dayName = WEEKDAY_NAMES[requestedDateUtc.getUTCDay()];
  const closedDateKeys = new Set(branding.appointmentDateOverrides?.closedDateKeys ?? []);
  const openedDateKeys = new Set(branding.appointmentDateOverrides?.openedDateKeys ?? []);

  if (closedDateKeys.has(slotDateKey)) {
    throw new Error("This business is closed on the selected date.");
  }

  if (!workingDays.has(dayName) && !openedDateKeys.has(slotDateKey)) {
    throw new Error("Choose a working day for this business.");
  }

  if (slotDateKey < todayIstDateKey) {
    throw new Error("Choose a future appointment date.");
  }

  const maxDate = new Date(todayUtcDate);
  maxDate.setUTCMonth(todayUtcDate.getUTCMonth() + 6);
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
  const ranges = [input.branding.workingHours, input.branding.workingHoursSecondWindow]
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
  const isToday = input.serviceDateKey === getIstDateKey(now);
  let estimateMinutes = isToday ? Math.max(ranges[0].startMinutes, nowMinutes) : ranges[0].startMinutes;
  let remainingServiceMinutes = Math.floor(input.activeCount / Math.max(1, input.appointmentsPerSlot)) * slotDurationMinutes;

  for (const range of ranges) {
    if (estimateMinutes >= range.endMinutes) {
      continue;
    }

    estimateMinutes = Math.max(estimateMinutes, range.startMinutes);
    const availableMinutes = range.endMinutes - estimateMinutes;

    if (remainingServiceMinutes < availableMinutes) {
      estimateMinutes += remainingServiceMinutes;
      const startsAt = createUtcSlotIso(input.serviceDateKey, Math.floor(estimateMinutes / (24 * 60)), Math.floor(estimateMinutes % (24 * 60)));
      return startsAt ? { exceedsWorkingHours: false, startsAt } : null;
    }

    remainingServiceMinutes -= availableMinutes;
    estimateMinutes = range.endMinutes;
  }

  return null;
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
        const key = `${appointment.locationId}::${appointment.serviceDateKey}`;
        counts[key] = (counts[key] ?? 0) + 1;
        return counts;
      }, {}),
  ).map(([key, count]) => {
    const [locationId, dateKey] = key.split("::");
    return { count, dateKey, locationId };
  });

  return NextResponse.json({
    business: {
      address: business.branding.address,
      advanceBookingWeeks: business.branding.advanceBookingWeeks ?? 4,
      appointmentDateOverrides: business.branding.appointmentDateOverrides ?? { closedDateKeys: [], openedDateKeys: [] },
      appointmentNotesPrompt: business.branding.appointmentNotesPrompt,
      appointmentsPerSlot: business.branding.appointmentsPerSlot ?? 1,
      imageDataUrl: business.branding.imageDataUrl,
      justAddToList: business.branding.justAddToList === true,
      locations: business.branding.appointmentLocations ?? [],
      name: business.branding.instituteName,
      ownerIdentifier: business.ownerIdentifier,
      profileImageDataUrl: business.branding.profileImageDataUrl,
      promotionalImageDataUrls: business.branding.promotionalImageDataUrls ?? [],
      recurringBookingLimit: null,
      recurringBookingsEnabled: false,
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
    locationId?: string;
    notes?: string | null;
    recurrence?: {
      endDateKey?: string;
      mode?: "weekly";
      weekdayKeys?: string[];
    } | null;
    slotDateKey?: string;
    startsAt?: string;
  };
  const locationId = body.locationId?.trim() ?? "";
  const location = business.branding.appointmentLocations?.find((entry) => entry.id === locationId);

  if (!locationId || !location) {
    return NextResponse.json({ error: "Choose a business location before booking." }, { status: 400 });
  }

  const locationBranding: WorkspaceBranding = {
    ...business.branding,
    address: location.address,
    workingDays: location.workingDays,
    workingHours: location.workingHours,
    workingHoursSecondWindow: location.workingHoursSecondWindow,
  };
  const slotDateKey = body.slotDateKey?.trim() || getIstDateKey(new Date());
  const recurrence = body.recurrence?.mode === "weekly"
    ? {
        endDateKey: body.recurrence.endDateKey?.trim() ?? "",
        weekdayKeys: body.recurrence.weekdayKeys ?? [],
      }
    : null;

  if (recurrence && !supportsRecurringAppointments()) {
    return NextResponse.json({ error: "Recurring appointments are no longer supported." }, { status: 400 });
  }

  const recurringBookingLimit = business.branding.recurringBookingLimit ?? 6;
  const slotDateKeys = recurrence
    ? buildRecurringDateKeys({
        endDateKey: recurrence.endDateKey,
        slotDateKey,
        weekdayKeys: recurrence.weekdayKeys,
      }).slice(0, recurringBookingLimit)
    : [slotDateKey];
  const appointments = [] as Array<{ id: string }>;
  const cautionMessages = new Set<string>();

  try {
    validateBookingDate(locationBranding, slotDateKey);
    const [ownerAppointments, requesterAppointments] = await Promise.all([
      listApportionAppointmentsForOwner(business.ownerIdentifier),
      recurrence ? listApportionAppointmentsForRequester(requesterIdentifier) : Promise.resolve([]),
    ]);
    const activeOwnerAppointments = ownerAppointments.filter((appointment) =>
      appointment.locationId === location.id
      && (appointment.currentStatus === "pending"
        || appointment.currentStatus === "present-in-person"
        || appointment.currentStatus === "pushed-back"),
    );

    if (recurrence) {
      const conflictingDateKey = slotDateKeys.find((recurringDateKey) => requesterAppointments.some((appointment) =>
        appointment.ownerIdentifier.trim().toLowerCase() === business.ownerIdentifier.trim().toLowerCase()
        && appointment.locationId === location.id
        && appointment.serviceDateKey === recurringDateKey
        && (appointment.currentStatus === "pending"
          || appointment.currentStatus === "present-in-person"
          || appointment.currentStatus === "pushed-back"),
      ));

      if (conflictingDateKey) {
        throw new Error(`You already have an active appointment with this business on ${conflictingDateKey}.`);
      }
    }

    const plannedAppointments: Array<{ justAddToList: boolean; serviceDateKey: string; startsAt: string }> = [];

    if (business.branding.justAddToList) {
      const activeCountsByDateKey = activeOwnerAppointments
        .reduce<Record<string, number>>((counts, appointment) => {
          counts[appointment.serviceDateKey] = (counts[appointment.serviceDateKey] ?? 0) + 1;
          return counts;
        }, {});

      for (const recurringDateKey of slotDateKeys) {
        validateBookingDate(locationBranding, recurringDateKey);

        const activeCount = activeCountsByDateKey[recurringDateKey] ?? 0;
        const estimate = estimateQueueStart({
          activeCount,
          appointmentsPerSlot: business.branding.appointmentsPerSlot ?? 1,
          branding: locationBranding,
          serviceDateKey: recurringDateKey,
        });

        if (!estimate) {
          throw new Error(`Queue booking is unavailable for ${recurringDateKey}.`);
        }

        plannedAppointments.push({
          justAddToList: true,
          serviceDateKey: recurringDateKey,
          startsAt: estimate.startsAt,
        });
        activeCountsByDateKey[recurringDateKey] = activeCount + 1;

      }
    } else {
      const requestedStart = new Date(body.startsAt ?? "");

      if (Number.isNaN(requestedStart.getTime())) {
        throw new Error("Choose a valid appointment date and time.");
      }

      validateRequestedSlot(locationBranding, requestedStart, slotDateKey);
      const selectedSlot = buildSlotStartsForDate(locationBranding, slotDateKey).find((slot) => slot.startsAt === requestedStart.toISOString());

      if (!selectedSlot) {
        throw new Error("Choose one of the available appointment slots.");
      }

      const activeCountsBySlot = activeOwnerAppointments.reduce<Record<string, number>>((counts, appointment) => {
        counts[appointment.startsAt] = (counts[appointment.startsAt] ?? 0) + 1;
        return counts;
      }, {});

      for (const recurringDateKey of slotDateKeys) {
        validateBookingDate(locationBranding, recurringDateKey);
        const recurringStartsAt = createUtcSlotIso(recurringDateKey, selectedSlot.dayOffset, selectedSlot.minutesOfDay);

        if (!recurringStartsAt) {
          throw new Error("Choose a valid appointment date and time.");
        }

        const recurringStartDate = new Date(recurringStartsAt);
        validateRequestedSlot(locationBranding, recurringStartDate, recurringDateKey);
        const appointmentsPerSlot = business.branding.appointmentsPerSlot ?? 1;

        if ((activeCountsBySlot[recurringStartsAt] ?? 0) >= appointmentsPerSlot) {
          throw new Error(`The appointment slot on ${recurringDateKey} is already full.`);
        }

        plannedAppointments.push({
          justAddToList: false,
          serviceDateKey: recurringDateKey,
          startsAt: recurringStartsAt,
        });
        activeCountsBySlot[recurringStartsAt] = (activeCountsBySlot[recurringStartsAt] ?? 0) + 1;
      }
    }

    for (const plannedAppointment of plannedAppointments) {
      const appointment = await createApportionAppointment({
        appointmentsPerSlot: business.branding.appointmentsPerSlot ?? 1,
        justAddToList: plannedAppointment.justAddToList,
        locationAddress: location.address,
        locationId: location.id,
        locationName: location.name,
        notes: body.notes,
        ownerIdentifier: business.ownerIdentifier,
        ownerName: business.branding.instituteName,
        requesterIdentifier,
        requesterName: getSessionDisplayName(session) ?? requesterIdentifier,
        requesterPhone: session.phoneNumber ?? requesterIdentifier,
        serviceDateKey: plannedAppointment.serviceDateKey,
        startsAt: plannedAppointment.startsAt,
      });

      appointments.push({ id: appointment.id });
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