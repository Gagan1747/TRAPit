import { getSessionDisplayName, getSessionIdentifier } from "@trapit/auth";
import { type WorkspaceBranding } from "@trapit/testing";
import { NextResponse } from "next/server";

import { createApportionAppointment, listApportionSlotCounts } from "../../../../lib/apportion-store";
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

function validateRequestedSlot(branding: WorkspaceBranding, startsAt: Date) {
  const workingDays = parseWorkingDays(branding.workingDays);
  const workingRanges = [branding.workingHours, branding.workingHoursSecondWindow]
    .map((range) => parseTimeRange(range))
    .filter((range): range is { endMinutes: number; startMinutes: number } => Boolean(range));
  const dayName = WEEKDAY_NAMES[startsAt.getDay()];
  const requestedMinutes = startsAt.getHours() * 60 + startsAt.getMinutes();
  const slotDurationMinutes = branding.slotDurationMinutes ?? 30;
  const slotStepMinutes = slotDurationMinutes === 60 ? 30 : 15;
  const advanceBookingWeeks = branding.advanceBookingWeeks ?? 4;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const maxDate = new Date(today);
  maxDate.setDate(today.getDate() + (advanceBookingWeeks * 7) - 1);
  maxDate.setHours(23, 59, 59, 999);

  if (!workingDays.has(dayName)) {
    throw new Error("Choose a working day for this business.");
  }

  if (startsAt.getTime() > maxDate.getTime()) {
    throw new Error("Choose a date within the allowed advance booking period.");
  }

  const matchingRange = workingRanges.find((range) => requestedMinutes >= range.startMinutes && requestedMinutes + slotDurationMinutes <= range.endMinutes);

  if (!matchingRange) {
    throw new Error("Choose a time within working hours.");
  }

  if ((requestedMinutes - matchingRange.startMinutes) % slotStepMinutes !== 0) {
    throw new Error("Choose one of the available appointment slots.");
  }
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

  const slotCounts = await listApportionSlotCounts(business.ownerIdentifier);

  return NextResponse.json({
    business: {
      advanceBookingWeeks: business.branding.advanceBookingWeeks ?? 4,
      appointmentsPerSlot: business.branding.appointmentsPerSlot ?? 1,
      imageDataUrl: business.branding.imageDataUrl,
      name: business.branding.instituteName,
      slotDurationMinutes: business.branding.slotDurationMinutes ?? null,
      workingDays: business.branding.workingDays,
      workingHours: business.branding.workingHours,
      workingHoursSecondWindow: business.branding.workingHoursSecondWindow,
    },
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

  const body = (await request.json()) as { notes?: string | null; startsAt?: string };
  let appointment;

  try {
    const requestedStart = new Date(body.startsAt ?? "");

    if (Number.isNaN(requestedStart.getTime())) {
      throw new Error("Choose a valid appointment date and time.");
    }

    validateRequestedSlot(business.branding, requestedStart);

    appointment = await createApportionAppointment({
      appointmentsPerSlot: business.branding.appointmentsPerSlot ?? 1,
      notes: body.notes,
      ownerIdentifier: business.ownerIdentifier,
      requesterIdentifier,
      requesterName: getSessionDisplayName(session) ?? requesterIdentifier,
      requesterPhone: session.phoneNumber ?? requesterIdentifier,
      startsAt: requestedStart.toISOString(),
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to book appointment." }, { status: 400 });
  }

  return NextResponse.json({ appointment });
}