import { getSessionDisplayName, getSessionIdentifier } from "@trapit/auth";
import { getApportionBookableServices, normalizeApportionProviderSettings, matchApportionIdentity, planApportionDateKeys, type ApportionRecurrence, type WorkspaceBranding } from "@trapit/testing";
import { NextResponse } from "next/server";

import { isWebAuthConfigured } from "../../../../lib/auth-config";
import { listRegisteredDirectoryUsers } from "../../../../lib/cognito";
import { createApportionAppointment, createApportionInvitation, listApportionAppointmentsForOwner, listApportionAppointmentsForRequester, listApportionSlotCounts } from "../../../../lib/apportion-store";
import { publishWorkspaceEvent } from "../../../../lib/realtime-events";
import { getWebSession } from "../../../../lib/session";
import { getWorkspaceBrandingByAppointmentShareCode, listParticipants } from "../../../../lib/testing-store";
import { resolveAppointmentLocationSchedule } from "../../../../lib/appointment-locations";
import { assertApportionHoursWithinMaster, getApportionBusinessContext, listApportionDirectLinkServices } from "../../../../lib/apportion-directory";

function canInviteForOwner(viewerIdentifier: string | null, linkedOwnerIdentifier: string, ownerIdentifier: string) {
  return Boolean(viewerIdentifier && matchApportionIdentity(viewerIdentifier, ownerIdentifier)
    && matchApportionIdentity(linkedOwnerIdentifier, ownerIdentifier));
}

async function resolveRegisteredTarget(phone: string) {
  const normalizedPhone = phone.trim().replace(/[\s()-]/g, "");
  if (!/^(?:\+[1-9]\d{7,14}|\d{10})$/.test(normalizedPhone)) {
    throw new Error("Enter a full registered phone number.");
  }
  const users = isWebAuthConfigured() ? await listRegisteredDirectoryUsers() : await listParticipants();
  return users.find((entry) => matchApportionIdentity(entry.identifier, normalizedPhone));
}

async function resolveServiceBusiness(ownerIdentifier: string, serviceId: string) {
  const ownerContext = await getApportionBusinessContext(ownerIdentifier);
  if (!ownerContext) throw new Error("Appointment business is unavailable.");
  const services = getApportionBookableServices(ownerContext.business, ownerContext.ownerCategory);
  const service = services.find((entry) => entry.id === serviceId);
  if (!service) throw new Error("This service is not available for new bookings.");
  const providerIdentifier = service.assignedIdentifier || (service.id === "consultation" ? ownerContext.business.ownerIdentifier : null);
  const isOwner = Boolean(providerIdentifier && matchApportionIdentity(providerIdentifier, ownerContext.business.ownerIdentifier));
  const memberships = providerIdentifier
    ? ownerContext.memberships.filter((entry) => matchApportionIdentity(entry.providerIdentifier, providerIdentifier))
    : [];
  const settingsKey = providerIdentifier
    ? Object.keys(ownerContext.providerSettings).find((identifier) => matchApportionIdentity(identifier, providerIdentifier))
    : undefined;
  const settings = providerIdentifier
    ? normalizeApportionProviderSettings(settingsKey ? ownerContext.providerSettings[settingsKey] : undefined)
    : null;
  const locations = (ownerContext.branding.appointmentLocations ?? []).filter((location) => service.locationIds.includes(location.id))
    .flatMap((location) => {
      if (isOwner || !providerIdentifier) return [location];
      const membership = memberships.find((entry) => entry.locationId === location.id);
      return membership ? [{ ...location, dailyHours: membership.dailyHours, workingDays: membership.workingDays, workingHours: membership.workingHours, workingHoursSecondWindow: membership.workingHoursSecondWindow }] : [];
    });
  const branding: WorkspaceBranding = { ...ownerContext.branding, ...(settings ?? {}), appointmentLocations: locations,
    workingDays: locations[0]?.workingDays ?? "", workingHours: locations[0]?.workingHours ?? "", workingHoursSecondWindow: locations[0]?.workingHoursSecondWindow ?? "" };
  return { ownerIdentifier: ownerContext.business.ownerIdentifier, providerIdentifier, branding, services, service, ownerContext, memberships, isOwner };
}

function providerClosedDates(context: Awaited<ReturnType<typeof getApportionBusinessContext>>, providerIdentifier: string | null) {
  if (!providerIdentifier) return [];
  return Object.entries(context?.providerClosedDateKeys ?? {})
    .find(([identifier]) => matchApportionIdentity(identifier, providerIdentifier))?.[1] ?? [];
}

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

  const linkedBusiness = await getWorkspaceBrandingByAppointmentShareCode(params.shareCode);

  if (!linkedBusiness) {
    return NextResponse.json({ error: "Business booking page not found." }, { status: 404 });
  }

  const url = new URL(request.url);
  const directServices = await listApportionDirectLinkServices(linkedBusiness.ownerIdentifier);
  const requestedOwnerIdentifier = url.searchParams.get("ownerIdentifier")?.trim() ?? "";
  const requestedServiceId = url.searchParams.get("serviceId")?.trim() ?? "";
  const selectedOption = directServices.find((entry) =>
    (!requestedOwnerIdentifier || matchApportionIdentity(entry.ownerIdentifier, requestedOwnerIdentifier))
    && (!requestedServiceId || entry.id === requestedServiceId),
  ) ?? (!requestedOwnerIdentifier && !requestedServiceId
    ? directServices.find((entry) => matchApportionIdentity(entry.ownerIdentifier, linkedBusiness.ownerIdentifier) && entry.id === "consultation") ?? directServices[0]
    : undefined);
  if (!selectedOption) return NextResponse.json({ error: "This service is not available from this booking link." }, { status: 404 });
  const serviceId = selectedOption.id;
  let business: Awaited<ReturnType<typeof resolveServiceBusiness>>;
  try { business = await resolveServiceBusiness(selectedOption.ownerIdentifier, serviceId); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Service unavailable." }, { status: 400 }); }

  const viewerIdentifier = getSessionIdentifier(session);
  const canInvite = canInviteForOwner(viewerIdentifier, linkedBusiness.ownerIdentifier, business.ownerIdentifier);
  const lookupPhone = url.searchParams.get("lookupPhone");
  if (lookupPhone !== null) {
    if (!canInvite) return NextResponse.json({ error: "Only the business owner on their own booking page can invite users." }, { status: 403 });
    try {
      const user = await resolveRegisteredTarget(lookupPhone);
      if (!user) return NextResponse.json({ error: "No registered user was found for that phone number." }, { status: 404 });
      return NextResponse.json({ user: { identifier: user.identifier, name: user.label } });
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to look up user." }, { status: 400 });
    }
  }

  const [ownerAppointments, slotCounts, addressOptions] = await Promise.all([
    listApportionAppointmentsForOwner(business.ownerIdentifier),
    listApportionSlotCounts(business.ownerIdentifier, undefined, serviceId),
    Promise.all(directServices.map(async (option) => {
      let serviceBusiness: Awaited<ReturnType<typeof resolveServiceBusiness>>;
      try { serviceBusiness = await resolveServiceBusiness(option.ownerIdentifier, option.id); }
      catch { return []; }
      const [appointments, counts] = await Promise.all([
        listApportionAppointmentsForOwner(serviceBusiness.ownerIdentifier),
        listApportionSlotCounts(serviceBusiness.ownerIdentifier, undefined, option.id),
      ]);
      const queues = Object.entries(appointments
        .filter((appointment) => (appointment.serviceId || "consultation") === option.id)
        .filter((appointment) => appointment.currentStatus === "pending" || appointment.currentStatus === "present-in-person" || appointment.currentStatus === "pushed-back")
        .reduce<Record<string, number>>((result, appointment) => {
          const key = `${appointment.locationId}::${appointment.serviceDateKey}`;
          result[key] = (result[key] ?? 0) + 1;
          return result;
        }, {}))
        .map(([key, count]) => {
          const [locationId, dateKey] = key.split("::");
          return { count, dateKey, locationId };
        });

      return (serviceBusiness.branding.appointmentLocations ?? [])
        .filter((location) => option.locationIds.includes(location.id))
        .map((location) => {
          const businessProjection = {
            address: location.address,
            advanceBookingWeeks: serviceBusiness.branding.advanceBookingWeeks ?? 4,
            appointmentDateHoursOverrides: (serviceBusiness.branding.appointmentDateHoursOverrides ?? []).map((entry) => ({
              ...entry,
              locations: entry.locations.filter((hours) => hours.locationId === location.id),
            })).filter((entry) => entry.locations.length),
            appointmentDateOverrides: serviceBusiness.branding.appointmentDateOverrides ?? { closedDateKeys: [], openedDateKeys: [] },
            appointmentNotesPrompt: serviceBusiness.branding.appointmentNotesPrompt,
            appointmentsPerSlot: serviceBusiness.branding.appointmentsPerSlot ?? 1,
            appointmentWeeklyHoursOverrides: (serviceBusiness.branding.appointmentWeeklyHoursOverrides ?? []).map((entry) => ({
              ...entry,
              locations: entry.locations.filter((hours) => hours.locationId === location.id),
            })).filter((entry) => entry.locations.length),
            imageDataUrl: serviceBusiness.branding.imageDataUrl,
            justAddToList: serviceBusiness.branding.justAddToList === true,
            locations: [location],
            name: serviceBusiness.branding.instituteName,
            ownerIdentifier: serviceBusiness.ownerIdentifier,
            profileImageDataUrl: serviceBusiness.branding.profileImageDataUrl,
            promotionalImageDataUrls: serviceBusiness.branding.promotionalImageDataUrls ?? [],
            canInvite: canInviteForOwner(viewerIdentifier, linkedBusiness.ownerIdentifier, serviceBusiness.ownerIdentifier),
            recurringBookingLimit: canInviteForOwner(viewerIdentifier, linkedBusiness.ownerIdentifier, serviceBusiness.ownerIdentifier) ? 6 : null,
            recurringBookingsEnabled: canInviteForOwner(viewerIdentifier, linkedBusiness.ownerIdentifier, serviceBusiness.ownerIdentifier),
            serviceId: option.id,
            showRemainingBookings: serviceBusiness.branding.showRemainingBookings,
            slotDurationMinutes: serviceBusiness.branding.slotDurationMinutes ?? null,
            workingDays: location.workingDays,
            workingHours: location.workingHours,
            workingHoursSecondWindow: location.workingHoursSecondWindow,
            providerClosedDateKeys: providerClosedDates(serviceBusiness.ownerContext, serviceBusiness.providerIdentifier),
          };
          const addressKey = `${serviceBusiness.ownerIdentifier}::${location.id}`;
          return {
            key: addressKey,
            location,
            contexts: [{
              ownerIdentifier: serviceBusiness.ownerIdentifier,
              serviceId: option.id,
              serviceName: option.name,
              businessName: option.businessName,
              business: businessProjection,
              queueCounts: queues.filter((entry) => entry.locationId === location.id),
              slotCounts: counts.filter((entry) => entry.locationId === location.id),
            }],
          };
        });
    })).then((groups) => {
      const grouped = new Map<string, { key: string; location: NonNullable<typeof business.branding.appointmentLocations>[number]; contexts: Array<Record<string, unknown>> }>();
      groups.flat().forEach((option) => {
        const current = grouped.get(option.key);
        if (current) current.contexts.push(...option.contexts);
        else grouped.set(option.key, option);
      });
      return Array.from(grouped.values());
    }),
  ]);
  const queueCounts = Object.entries(
    ownerAppointments
      .filter((appointment) => (appointment.serviceId || "consultation") === serviceId)
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
    viewerIdentifier,
    canInvite,
    addressOptions,
    services: directServices,
    serviceId,
    businessOwnerIdentifier: business.ownerIdentifier,
    providerProfile: {
      name: linkedBusiness.branding.instituteName,
      address: linkedBusiness.branding.address,
      ownerIdentifier: linkedBusiness.ownerIdentifier,
      imageDataUrl: linkedBusiness.branding.imageDataUrl,
      profileImageDataUrl: linkedBusiness.branding.profileImageDataUrl,
      promotionalImageDataUrls: linkedBusiness.branding.promotionalImageDataUrls ?? [],
    },
    business: {
      serviceId,
      services: directServices,
      address: business.branding.address,
      advanceBookingWeeks: business.branding.advanceBookingWeeks ?? 4,
      appointmentDateHoursOverrides: business.branding.appointmentDateHoursOverrides ?? [],
      appointmentDateOverrides: business.branding.appointmentDateOverrides ?? { closedDateKeys: [], openedDateKeys: [] },
      appointmentNotesPrompt: business.branding.appointmentNotesPrompt,
      appointmentsPerSlot: business.branding.appointmentsPerSlot ?? 1,
      appointmentWeeklyHoursOverrides: business.branding.appointmentWeeklyHoursOverrides ?? [],
      imageDataUrl: business.branding.imageDataUrl,
      justAddToList: business.branding.justAddToList === true,
      locations: business.branding.appointmentLocations ?? [],
      name: business.branding.instituteName,
      ownerIdentifier: business.ownerIdentifier,
      profileImageDataUrl: business.branding.profileImageDataUrl,
      promotionalImageDataUrls: business.branding.promotionalImageDataUrls ?? [],
      canInvite,
      recurringBookingLimit: canInvite ? 6 : null,
      recurringBookingsEnabled: canInvite,
      showRemainingBookings: business.branding.showRemainingBookings,
      slotDurationMinutes: business.branding.slotDurationMinutes ?? null,
      workingDays: business.branding.workingDays,
      workingHours: business.branding.workingHours,
      workingHoursSecondWindow: business.branding.workingHoursSecondWindow,
      providerClosedDateKeys: providerClosedDates(business.ownerContext, business.providerIdentifier),
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

  let body: {
    ownerIdentifier?: string;
    serviceId?: string;
    locationId?: string;
    notes?: string | null;
    targetPhone?: string;
    recurrence?: ApportionRecurrence | null;
    slotDateKey?: string;
    startsAt?: string;
  };
  try {
    body = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)
      || [body.ownerIdentifier, body.serviceId, body.locationId, body.slotDateKey, body.startsAt, body.targetPhone].some((value) => value !== undefined && typeof value !== "string")
      || (body.notes !== undefined && body.notes !== null && typeof body.notes !== "string")
      || (body.recurrence !== undefined && body.recurrence !== null && (
        typeof body.recurrence !== "object" || Array.isArray(body.recurrence)
        || !["weekly", "monthly"].includes(body.recurrence.mode)
        || typeof body.recurrence.endDateKey !== "string"
        || (body.recurrence.weekdayKeys !== undefined && (!Array.isArray(body.recurrence.weekdayKeys) || body.recurrence.weekdayKeys.some((value) => typeof value !== "string")))
        || (body.recurrence.monthDays !== undefined && (!Array.isArray(body.recurrence.monthDays) || body.recurrence.monthDays.some((value) => !Number.isInteger(value) || value < 1 || value > 31)))
        || (body.recurrence.mode === "weekly" && !body.recurrence.weekdayKeys?.length)
        || (body.recurrence.mode === "monthly" && !body.recurrence.monthDays?.length)
      ))) throw new Error("A valid booking body is required.");
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid booking body." }, { status: 400 });
  }
  const linkedBusiness = await getWorkspaceBrandingByAppointmentShareCode(params.shareCode);
  if (!linkedBusiness) {
    return NextResponse.json({ error: "Business booking page not found." }, { status: 404 });
  }
  const directServices = await listApportionDirectLinkServices(linkedBusiness.ownerIdentifier);
  const requestedOwnerIdentifier = body.ownerIdentifier?.trim() || linkedBusiness.ownerIdentifier;
  const serviceId = body.serviceId?.trim() || "consultation";
  const selectedOption = directServices.find((entry) =>
    matchApportionIdentity(entry.ownerIdentifier, requestedOwnerIdentifier) && entry.id === serviceId,
  );
  if (!selectedOption) return NextResponse.json({ error: "This service is not available from this booking link." }, { status: 400 });
  let business: Awaited<ReturnType<typeof resolveServiceBusiness>>;
  try { business = await resolveServiceBusiness(selectedOption.ownerIdentifier, serviceId); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Service unavailable." }, { status: 400 }); }
  if (body.recurrence && body.targetPhone === undefined) {
    return NextResponse.json({ error: "Recurring appointments require an owner invitation to a registered target user." }, { status: 400 });
  }
  const locationId = body.locationId?.trim() ?? "";
  const location = business.branding.appointmentLocations?.find((entry) => entry.id === locationId);

  if (!locationId || !location) {
    return NextResponse.json({ error: "Choose a business location before booking." }, { status: 400 });
  }

  const slotDateKey = body.slotDateKey?.trim() || getIstDateKey(new Date());
  const getLocationBranding = (serviceDateKey: string): WorkspaceBranding => {
    if (providerClosedDates(business.ownerContext, business.providerIdentifier).includes(serviceDateKey)) {
      throw new Error("Provider unavailable on the selected date.");
    }
    const masterLocation = resolveAppointmentLocationSchedule(business.ownerContext.branding, location.id, serviceDateKey);
    const membership = business.providerIdentifier
      ? business.memberships.find((entry) => entry.locationId === location.id)
      : undefined;
    const effectiveLocation = business.isOwner || !business.providerIdentifier ? masterLocation
      : membership && !membership.closedDateKeys.includes(serviceDateKey)
        ? resolveAppointmentLocationSchedule({ ...business.branding, appointmentDateHoursOverrides: [], appointmentWeeklyHoursOverrides: [], appointmentDateOverrides: { closedDateKeys: [], openedDateKeys: [] } }, location.id, serviceDateKey)
        : null;

    if (!effectiveLocation || !masterLocation) {
      throw new Error("This location is closed on the selected date.");
    }
    if (business.providerIdentifier && !business.isOwner) assertApportionHoursWithinMaster(effectiveLocation, masterLocation);

    return {
      ...business.branding,
      address: effectiveLocation.address,
      workingDays: effectiveLocation.workingDays,
      workingHours: effectiveLocation.workingHours,
      workingHoursSecondWindow: effectiveLocation.workingHoursSecondWindow,
    };
  };
  if (body.targetPhone !== undefined) {
    if (!canInviteForOwner(getSessionIdentifier(session), linkedBusiness.ownerIdentifier, business.ownerIdentifier)) {
      return NextResponse.json({ error: "Only the business owner on their own booking page can invite users." }, { status: 403 });
    }
    try {
      const target = await resolveRegisteredTarget(body.targetPhone);
      if (!target) throw new Error("No registered user was found for that phone number.");
      const requestedStart = new Date(body.startsAt ?? "");
      let selectedTime: { dayOffset: number; minutesOfDay: number } | null = null;
      if (!business.branding.justAddToList) {
        if (!Number.isFinite(requestedStart.getTime())) throw new Error("Choose a valid appointment date and time.");
        const shifted = new Date(requestedStart.getTime() + IST_OFFSET_MINUTES * 60_000);
        const startDate = createDateFromKeyUtc(slotDateKey);
        const selectedDate = createDateFromKeyUtc(createDateKeyUtc(shifted));
        const dayOffset = startDate && selectedDate ? (selectedDate.getTime() - startDate.getTime()) / 86_400_000 : -1;
        if (![0, 1].includes(dayOffset) || shifted.getUTCSeconds() || shifted.getUTCMilliseconds()) {
          throw new Error("Choose one of the available appointment slots.");
        }
        selectedTime = { dayOffset, minutesOfDay: shifted.getUTCHours() * 60 + shifted.getUTCMinutes() };
      }
      const dateKeys = planApportionDateKeys(slotDateKey, body.recurrence ?? null, (dateKey) => {
        try {
          const branding = getLocationBranding(dateKey);
          validateBookingDate(branding, dateKey);
          if (selectedTime) {
            const startsAt = createUtcSlotIso(dateKey, selectedTime.dayOffset, selectedTime.minutesOfDay);
            if (!startsAt) return false;
            validateRequestedSlot(branding, new Date(startsAt), dateKey);
          }
          return true;
        } catch {
          return false;
        }
      });
      const ownerAppointments = await listApportionAppointmentsForOwner(business.ownerIdentifier);
      const activeAppointments = ownerAppointments.filter((appointment) => appointment.locationId === location.id
        && (appointment.serviceId || "consultation") === serviceId
        && ["pending", "present-in-person", "pushed-back"].includes(appointment.currentStatus));
      const occurrences = dateKeys.map((serviceDateKey) => {
        const branding = getLocationBranding(serviceDateKey);
        if (business.branding.justAddToList) {
          const estimate = estimateQueueStart({
            activeCount: activeAppointments.filter((appointment) => appointment.serviceDateKey === serviceDateKey).length,
            appointmentsPerSlot: branding.appointmentsPerSlot ?? 1,
            branding,
            serviceDateKey,
          });
          if (!estimate) throw new Error(`Queue booking is unavailable for ${serviceDateKey}.`);
          return { serviceDateKey, startsAt: estimate.startsAt };
        }
        const startsAt = createUtcSlotIso(serviceDateKey, selectedTime!.dayOffset, selectedTime!.minutesOfDay)!;
        if (activeAppointments.filter((appointment) => new Date(appointment.startsAt).getTime() === new Date(startsAt).getTime()).length >= (branding.appointmentsPerSlot ?? 1)) {
          throw new Error(`The appointment slot on ${serviceDateKey} is already full.`);
        }
        return { serviceDateKey, startsAt };
      });
      const invitation = await createApportionInvitation({
        actorIdentifier: requesterIdentifier,
        ownerIdentifier: business.ownerIdentifier,
        serviceId,
        locationId: location.id,
        requesterIdentifier: target.identifier,
        requesterName: target.label,
        requesterPhone: target.identifier,
        notes: body.notes,
        occurrences,
      });
      publishWorkspaceEvent("apportion");
      return NextResponse.json({ invitation: { id: invitation.id, status: invitation.status }, appointmentCount: occurrences.length, caution: null });
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to invite requester." }, { status: 400 });
    }
  }
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
    const locationBranding = getLocationBranding(slotDateKey);
    validateBookingDate(locationBranding, slotDateKey);
    const [ownerAppointments, requesterAppointments] = await Promise.all([
      listApportionAppointmentsForOwner(business.ownerIdentifier),
      recurrence ? listApportionAppointmentsForRequester(requesterIdentifier) : Promise.resolve([]),
    ]);
    const activeOwnerAppointments = ownerAppointments.filter((appointment) =>
      appointment.locationId === location.id
      && (appointment.serviceId || "consultation") === serviceId
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
        const recurringLocationBranding = getLocationBranding(recurringDateKey);
        validateBookingDate(recurringLocationBranding, recurringDateKey);

        const activeCount = activeCountsByDateKey[recurringDateKey] ?? 0;
        const estimate = estimateQueueStart({
          activeCount,
          appointmentsPerSlot: business.branding.appointmentsPerSlot ?? 1,
          branding: recurringLocationBranding,
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
        const recurringLocationBranding = getLocationBranding(recurringDateKey);
        validateBookingDate(recurringLocationBranding, recurringDateKey);
        const recurringStartsAt = createUtcSlotIso(recurringDateKey, selectedSlot.dayOffset, selectedSlot.minutesOfDay);

        if (!recurringStartsAt) {
          throw new Error("Choose a valid appointment date and time.");
        }

        const recurringStartDate = new Date(recurringStartsAt);
        validateRequestedSlot(recurringLocationBranding, recurringStartDate, recurringDateKey);
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
        serviceId,
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