import { getSessionDisplayName, getSessionIdentifier } from "@trapit/auth";
import { type WorkspaceBranding } from "@trapit/testing";
import { NextResponse } from "next/server";

import { createApportionAppointment, listApportionAppointmentsForOwner, listApportionSlotCounts } from "../../../../lib/apportion-store";
import { getWebSession } from "../../../../lib/session";
import { getWorkspaceBrandingByAppointmentShareCode } from "../../../../lib/testing-store";

const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

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

function createDateKey(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
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
      const slotDate = createDateFromKey(slotDateKey) ?? new Date();
      slotDate.setDate(slotDate.getDate() + dayOffset);
      slotDate.setHours(Math.floor(minutesOfDay / 60), minutesOfDay % 60, 0, 0);

      return {
        dayOffset,
        minutesOfDay,
        startsAt: slotDate.toISOString(),
      };
    });
  });
}

function validateBookingDate(branding: WorkspaceBranding, slotDateKey: string) {
  const workingDays = parseWorkingDays(branding.workingDays);
  const requestedLocalDate = createDateFromKey(slotDateKey);
  const advanceBookingWeeks = branding.advanceBookingWeeks ?? 4;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const maxDate = new Date(today);
  maxDate.setDate(today.getDate() + (advanceBookingWeeks * 7) - 1);
  maxDate.setHours(23, 59, 59, 999);

  if (!requestedLocalDate) {
    throw new Error("Choose a valid appointment date.");
  }

  const dayName = WEEKDAY_NAMES[requestedLocalDate.getDay()];

  if (!workingDays.has(dayName)) {
    throw new Error("Choose a working day for this business.");
  }

  if (requestedLocalDate.getTime() < today.getTime()) {
    throw new Error("Choose a future appointment date.");
  }

  if (requestedLocalDate.getTime() > maxDate.getTime()) {
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

  const body = (await request.json()) as { notes?: string | null; slotDateKey?: string; startsAt?: string };
  let appointment;
  let caution: string | null = null;

  try {
    const slotDateKey = body.slotDateKey?.trim() || createDateKey(new Date());
    validateBookingDate(business.branding, slotDateKey);

    if (business.branding.justAddToList) {
      const ownerAppointments = await listApportionAppointmentsForOwner(business.ownerIdentifier);
      const activeCount = ownerAppointments.filter((appointment) =>
        appointment.serviceDateKey === slotDateKey
        && (appointment.currentStatus === "pending" || appointment.currentStatus === "present-in-person" || appointment.currentStatus === "pushed-back"),
      ).length;
      const estimate = estimateQueueStart({
        activeCount,
        appointmentsPerSlot: business.branding.appointmentsPerSlot ?? 1,
        branding: business.branding,
        serviceDateKey: slotDateKey,
      });
      appointment = await createApportionAppointment({
        appointmentsPerSlot: business.branding.appointmentsPerSlot ?? 1,
        justAddToList: true,
        notes: body.notes,
        ownerIdentifier: business.ownerIdentifier,
        ownerName: business.branding.instituteName,
        requesterIdentifier,
        requesterName: getSessionDisplayName(session) ?? requesterIdentifier,
        requesterPhone: session.phoneNumber ?? requesterIdentifier,
        serviceDateKey: slotDateKey,
        startsAt: estimate.startsAt,
      });

      if (estimate.exceedsWorkingHours) {
        caution = "Estimated latest availability is beyond the configured working hours for that day.";
      }
    } else {
      const requestedStart = new Date(body.startsAt ?? "");

      if (Number.isNaN(requestedStart.getTime())) {
        throw new Error("Choose a valid appointment date and time.");
      }

      validateRequestedSlot(business.branding, requestedStart, slotDateKey);

      appointment = await createApportionAppointment({
        appointmentsPerSlot: business.branding.appointmentsPerSlot ?? 1,
        notes: body.notes,
        ownerIdentifier: business.ownerIdentifier,
        ownerName: business.branding.instituteName,
        requesterIdentifier,
        requesterName: getSessionDisplayName(session) ?? requesterIdentifier,
        requesterPhone: session.phoneNumber ?? requesterIdentifier,
        serviceDateKey: slotDateKey,
        startsAt: requestedStart.toISOString(),
      });
    }
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to book appointment." }, { status: 400 });
  }

  return NextResponse.json({ appointment, caution });
}