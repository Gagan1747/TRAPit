import { NextResponse } from "next/server";
import { getApportionServiceLimit, participantIdentifiersMatch, type AppointmentDailyHours } from "@trapit/testing";
import { assertApportionHoursWithinMaster, getApportionBusinessContext, getApportionPanel, listApportionScheduleNotificationsForActor } from "../../../../lib/apportion-directory";
import { isWebAuthConfigured } from "../../../../lib/auth-config";
import { listRegisteredDirectoryUsers } from "../../../../lib/cognito";

import { resolveAppointmentLocationSchedule, validateAppointmentLocationSlot } from "../../../../lib/appointment-locations";
import { cancelApportionAppointment, listApportionAppointmentsForActor, listApportionAppointmentsForRequester, listApportionInvitationsForActor, listApportionNotificationsForActor, updateApportionAppointment } from "../../../../lib/apportion-store";
import { publishWorkspaceEvent } from "../../../../lib/realtime-events";
import { getOrCreateWorkspaceAppointmentShareCode, getWorkspaceBranding, listParticipants, listWorkspaceAppointmentBusinesses } from "../../../../lib/testing-store";
import { getWorkspaceActor, type WorkspaceActor } from "../../../../lib/workspace-actor";

type OwnerOperatingHours = {
  appointmentsPerSlot: number | null;
  justAddToList: boolean;
  locations: Record<string, {
    dailyHours?: AppointmentDailyHours[];
    workingHours: string;
    workingHoursSecondWindow: string;
  }>;
  dailyHours?: AppointmentDailyHours[];
  providerClosedDateKeys: string[];
  slotDurationMinutes: number | null;
  workingHours: string;
  workingHoursSecondWindow: string;
};

async function buildApportionDashboardPayload(actor: WorkspaceActor & { identifier: string }) {
  const actorIdentifier = actor.identifier;
  const [appointmentShareCode, availableBusinesses, appointments, invitations] = await Promise.all([
    getApportionServiceLimit(actor.userCategory) > 0 ? getOrCreateWorkspaceAppointmentShareCode(actorIdentifier) : Promise.resolve(null),
    listWorkspaceAppointmentBusinesses(),
    listApportionAppointmentsForActor(actorIdentifier),
    listApportionInvitationsForActor(actorIdentifier),
  ]);
  const ownerAppointments = appointments.filter((appointment) => !participantIdentifiersMatch(appointment.requesterIdentifier, actorIdentifier)
    || participantIdentifiersMatch(appointment.ownerIdentifier, actorIdentifier)
    || Boolean(appointment.assignedStaffIdentifier && participantIdentifiersMatch(appointment.assignedStaffIdentifier, actorIdentifier))
    || appointment.canManage);
  const requesterAppointments = appointments.filter((appointment) => participantIdentifiersMatch(appointment.requesterIdentifier, actorIdentifier));

  const uniqueOwnerIdentifiers = Array.from(
    new Set(appointments.map((appointment) => appointment.ownerIdentifier.trim()).filter(Boolean)),
  );
  const ownerOperatingHoursEntries = await Promise.all(uniqueOwnerIdentifiers.map(async (ownerIdentifier) => {
    const ownerContext = await getApportionBusinessContext(ownerIdentifier);
    const ownerBranding = ownerContext?.branding ?? await getWorkspaceBranding(ownerIdentifier);
    const ownerClosedDates = Object.entries(ownerContext?.providerClosedDateKeys ?? {})
      .find(([identifier]) => participantIdentifiersMatch(identifier, ownerIdentifier))?.[1] ?? [];

    return [
      ownerIdentifier,
      {
        appointmentsPerSlot: ownerBranding?.appointmentsPerSlot ?? null,
        justAddToList: ownerBranding?.justAddToList === true,
        locations: Object.fromEntries((ownerBranding?.appointmentLocations ?? []).map((location) => [
          location.id,
          {
            ...(location.dailyHours ? { dailyHours: location.dailyHours } : {}),
            workingHours: location.workingHours,
            workingHoursSecondWindow: location.workingHoursSecondWindow,
          },
        ])),
        providerClosedDateKeys: ownerClosedDates,
        slotDurationMinutes: ownerBranding?.slotDurationMinutes ?? null,
        workingHours: ownerBranding?.workingHours ?? "",
        workingHoursSecondWindow: ownerBranding?.workingHoursSecondWindow ?? "",
      } satisfies OwnerOperatingHours,
    ] as const;
  }));
  const ownerOperatingHoursByIdentifier = Object.fromEntries(ownerOperatingHoursEntries);
  const appointmentOperatingHoursById = Object.fromEntries(await Promise.all(appointments.map(async (appointment) => {
    const context = await getApportionBusinessContext(appointment.ownerIdentifier);
    const service = context?.business.services.find((entry) => entry.id === (appointment.serviceId || "consultation"));
    const provider = service?.assignedIdentifier || (service?.id === "consultation" ? context?.business.ownerIdentifier : null);
    const membership = provider ? context?.memberships.find((entry) => entry.locationId === appointment.locationId && participantIdentifiersMatch(entry.providerIdentifier, provider)) : undefined;
    const location = context?.branding.appointmentLocations?.find((entry) => entry.id === appointment.locationId);
    const providerClosedDateKeys = provider ? Object.entries(context?.providerClosedDateKeys ?? {})
      .find(([identifier]) => participantIdentifiersMatch(identifier, provider))?.[1] ?? [] : [];
    return [appointment.id, {
      appointmentsPerSlot: appointment.bookedSettings?.appointmentsPerSlot ?? context?.branding.appointmentsPerSlot ?? null,
      justAddToList: appointment.justAddToList,
      slotDurationMinutes: appointment.bookedSettings?.slotDurationMinutes ?? context?.branding.slotDurationMinutes ?? null,
      workingHours: membership?.workingHours ?? location?.workingHours ?? "",
      workingHoursSecondWindow: membership?.workingHoursSecondWindow ?? location?.workingHoursSecondWindow ?? "",
      ...(membership?.dailyHours ?? location?.dailyHours ? { dailyHours: membership?.dailyHours ?? location?.dailyHours } : {}),
      providerClosedDateKeys,
      locations: location ? { [location.id]: {
        ...((membership?.dailyHours ?? location.dailyHours) ? { dailyHours: membership?.dailyHours ?? location.dailyHours } : {}),
        workingHours: membership?.workingHours ?? location.workingHours,
        workingHoursSecondWindow: membership?.workingHoursSecondWindow ?? location.workingHoursSecondWindow,
      } } : {},
    } satisfies OwnerOperatingHours] as const;
  })));

  return {
    appointmentOperatingHoursById,
    appointmentShareCode,
    appointments,
    availableBusinesses,
    invitations,
    ownerAppointments,
    ownerOperatingHoursByIdentifier,
    requesterAppointments,
  };
}

export async function GET(request: Request) {
  const actor = await getWorkspaceActor(request);

  if (!actor?.identifier) {
    return NextResponse.json({ error: "Signed-in access is required." }, { status: 403 });
  }

  const url = new URL(request.url);
  if (url.searchParams.get("notifications") === "1") {
    const [appointmentNotifications, scheduleNotifications] = await Promise.all([
      listApportionNotificationsForActor(actor.identifier),
      listApportionScheduleNotificationsForActor(actor.identifier),
    ]);
    return NextResponse.json({ notifications: [...appointmentNotifications, ...scheduleNotifications]
      .sort((first, second) => second.createdAt.localeCompare(first.createdAt)) });
  }
  const phone = url.searchParams.get("lookupPhone");
  if (phone !== null) {
    const normalizedPhone = phone.trim().replace(/[\s()-]/g, "");
    if (!/^(?:\+[1-9]\d{7,14}|\d{10})$/.test(normalizedPhone)) {
      return NextResponse.json({ error: "Enter a full registered phone number." }, { status: 400 });
    }
    const panel = await getApportionPanel(actor);
    if (!panel.businesses.some((entry) => entry.role !== "staff" && getApportionServiceLimit(entry.ownerCategory) > 0)) {
      return NextResponse.json({ error: "Business owner or appointed Admin access is required." }, { status: 403 });
    }
    const users = isWebAuthConfigured() ? await listRegisteredDirectoryUsers() : await listParticipants();
    const user = users.find((entry) => participantIdentifiersMatch(entry.identifier, normalizedPhone));
    if (!user) return NextResponse.json({ error: "No registered user was found for that phone number." }, { status: 404 });
    return NextResponse.json({ user: { identifier: user.identifier, name: user.label } });
  }

  return NextResponse.json(await buildApportionDashboardPayload({ ...actor, identifier: actor.identifier }));
}

export async function DELETE(request: Request) {
  const actor = await getWorkspaceActor(request);

  if (!actor?.identifier) {
    return NextResponse.json({ error: "Signed-in access is required." }, { status: 403 });
  }

  try {
    const body = await request.json() as { appointmentId?: string };
    if (!body || typeof body !== "object" || Array.isArray(body) || typeof body.appointmentId !== "string" || !body.appointmentId.trim()) {
      throw new Error("A valid appointment ID is required.");
    }
    await cancelApportionAppointment({
      actorIdentifier: actor.identifier,
      appointmentId: body.appointmentId ?? "",
    });
    publishWorkspaceEvent("apportion");
    return NextResponse.json(await buildApportionDashboardPayload({ ...actor, identifier: actor.identifier }));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to cancel appointment." }, { status: 400 });
  }
}

export async function PATCH(request: Request) {
  const actor = await getWorkspaceActor(request);

  if (!actor?.identifier) {
    return NextResponse.json({ error: "Signed-in access is required." }, { status: 403 });
  }

  try {
  const body = (await request.json()) as {
    action?: "done" | "present-in-person" | "push-back" | "reject" | "reschedule" | "send-message";
    appointmentId?: string;
    message?: string;
    nextServiceDateKey?: string;
    nextStartsAt?: string;
    notes?: string | null;
  };

  if (!body || typeof body !== "object" || Array.isArray(body)
    || typeof body.appointmentId !== "string" || !body.appointmentId.trim()
    || (body.nextServiceDateKey !== undefined && typeof body.nextServiceDateKey !== "string")
    || (body.nextStartsAt !== undefined && typeof body.nextStartsAt !== "string")
    || (body.message !== undefined && typeof body.message !== "string")
    || (body.notes !== undefined && body.notes !== null && typeof body.notes !== "string")) {
    throw new Error("A valid appointment ID and appointment fields are required.");
  }
  if (typeof body.action !== "string" || !["done", "present-in-person", "push-back", "reject", "reschedule", "send-message"].includes(body.action)) {
    return NextResponse.json({ error: "Choose a valid appointment action." }, { status: 400 });
  }
  if (body.action === "send-message" && typeof body.message !== "string") {
    return NextResponse.json({ error: "A message is required." }, { status: 400 });
  }

    let appointmentsPerSlot: number | undefined;

    if (body.action === "reschedule") {
      const requesterAppointments = await listApportionAppointmentsForRequester(actor.identifier);
      const appointment = requesterAppointments.find((entry) => entry.id === body.appointmentId);

      if (!appointment) {
        throw new Error("Appointment not found.");
      }
      if (appointment.justAddToList) {
        throw new Error("Queue appointments cannot be rescheduled.");
      }
      const ownerContext = await getApportionBusinessContext(appointment.ownerIdentifier);
      const service = ownerContext?.business.services.find((entry) => entry.id === (appointment.serviceId || "consultation"));
      if (!ownerContext || !service || !service.locationIds.includes(appointment.locationId)) throw new Error("This appointment service is unavailable.");
      const providerIdentifier = service.assignedIdentifier || (service.id === "consultation" ? ownerContext.business.ownerIdentifier : null);
      const providerLeaveDates = providerIdentifier ? Object.entries(ownerContext.providerClosedDateKeys ?? {})
        .find(([identifier]) => participantIdentifiersMatch(identifier, providerIdentifier))?.[1] ?? [] : [];
      if (providerLeaveDates.includes(body.nextServiceDateKey ?? "")) {
        throw new Error("Provider unavailable on the selected day.");
      }
      const master = resolveAppointmentLocationSchedule(
        ownerContext.branding,
        appointment.locationId,
        body.nextServiceDateKey ?? "",
      );
      const membership = providerIdentifier ? ownerContext.memberships.find((entry) => entry.locationId === appointment.locationId
        && participantIdentifiersMatch(entry.providerIdentifier, providerIdentifier)) : undefined;
      const location = !providerIdentifier || participantIdentifiersMatch(providerIdentifier, ownerContext.business.ownerIdentifier) ? master
        : membership && !membership.closedDateKeys.includes(body.nextServiceDateKey ?? "")
          ? resolveAppointmentLocationSchedule({ ...ownerContext.branding, appointmentLocations: ownerContext.branding.appointmentLocations?.map((entry) => entry.id === appointment.locationId ? { ...entry, ...membership } : entry), appointmentDateHoursOverrides: [], appointmentWeeklyHoursOverrides: [], appointmentDateOverrides: { closedDateKeys: [], openedDateKeys: [] } }, appointment.locationId, body.nextServiceDateKey ?? "")
          : null;

      if (!location || !master) {
        throw new Error("This appointment location is no longer available for rescheduling.");
      }
      if (membership) assertApportionHoursWithinMaster(location, master);

      validateAppointmentLocationSlot({
        location,
        serviceDateKey: body.nextServiceDateKey ?? "",
        slotDurationMinutes: appointment.bookedSettings?.slotDurationMinutes ?? ownerContext.branding.slotDurationMinutes ?? 30,
        startsAt: body.nextStartsAt ?? "",
      });
      appointmentsPerSlot = appointment.bookedSettings?.appointmentsPerSlot ?? ownerContext.branding.appointmentsPerSlot ?? 1;
    }

    const result = await updateApportionAppointment({
      action: body.action,
      actorIdentifier: actor.identifier,
      appointmentsPerSlot,
      appointmentId: body.appointmentId ?? "",
      nextServiceDateKey: body.nextServiceDateKey,
      nextStartsAt: body.nextStartsAt,
      message: body.message,
      notes: body.notes,
    });
    publishWorkspaceEvent("apportion");
    const payload = await buildApportionDashboardPayload({ ...actor, identifier: actor.identifier });

    return NextResponse.json({
      ...payload,
      nextInPersonAppointment: result.nextInPersonAppointment,
      updatedAppointment: result.appointment,
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to update appointment." }, { status: 400 });
  }
}