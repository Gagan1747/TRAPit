import { NextResponse } from "next/server";

import { validateAppointmentLocationSlot } from "../../../../lib/appointment-locations";
import { cancelApportionAppointment, listApportionAppointmentsForOwner, listApportionAppointmentsForRequester, updateApportionAppointment } from "../../../../lib/apportion-store";
import { publishWorkspaceEvent } from "../../../../lib/realtime-events";
import { getOrCreateWorkspaceAppointmentShareCode, getWorkspaceBranding, listWorkspaceAppointmentBusinesses } from "../../../../lib/testing-store";
import { getWorkspaceActor } from "../../../../lib/workspace-actor";

type OwnerOperatingHours = {
  appointmentsPerSlot: number | null;
  justAddToList: boolean;
  locations: Record<string, {
    workingHours: string;
    workingHoursSecondWindow: string;
  }>;
  slotDurationMinutes: number | null;
  workingHours: string;
  workingHoursSecondWindow: string;
};

async function buildApportionDashboardPayload(actorIdentifier: string) {
  const [appointmentShareCode, availableBusinesses, ownerAppointments, requesterAppointments] = await Promise.all([
    getOrCreateWorkspaceAppointmentShareCode(actorIdentifier),
    listWorkspaceAppointmentBusinesses(),
    listApportionAppointmentsForOwner(actorIdentifier),
    listApportionAppointmentsForRequester(actorIdentifier),
  ]);

  const appointments = [...ownerAppointments, ...requesterAppointments]
    .reduce<typeof ownerAppointments>((entries, appointment) => {
      if (entries.some((entry) => entry.id === appointment.id)) {
        return entries;
      }

      entries.push(appointment);
      return entries;
    }, [])
    .sort((left, right) => new Date(left.startsAt).getTime() - new Date(right.startsAt).getTime());

  const uniqueOwnerIdentifiers = Array.from(
    new Set(appointments.map((appointment) => appointment.ownerIdentifier.trim()).filter(Boolean)),
  );
  const ownerOperatingHoursEntries = await Promise.all(uniqueOwnerIdentifiers.map(async (ownerIdentifier) => {
    const ownerBranding = await getWorkspaceBranding(ownerIdentifier);

    return [
      ownerIdentifier,
      {
        appointmentsPerSlot: ownerBranding?.appointmentsPerSlot ?? null,
        justAddToList: ownerBranding?.justAddToList === true,
        locations: Object.fromEntries((ownerBranding?.appointmentLocations ?? []).map((location) => [
          location.id,
          {
            workingHours: location.workingHours,
            workingHoursSecondWindow: location.workingHoursSecondWindow,
          },
        ])),
        slotDurationMinutes: ownerBranding?.slotDurationMinutes ?? null,
        workingHours: ownerBranding?.workingHours ?? "",
        workingHoursSecondWindow: ownerBranding?.workingHoursSecondWindow ?? "",
      } satisfies OwnerOperatingHours,
    ] as const;
  }));
  const ownerOperatingHoursByIdentifier = Object.fromEntries(ownerOperatingHoursEntries);

  return {
    appointmentShareCode,
    appointments,
    availableBusinesses,
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

  return NextResponse.json(await buildApportionDashboardPayload(actor.identifier));
}

export async function DELETE(request: Request) {
  const actor = await getWorkspaceActor(request);

  if (!actor?.identifier) {
    return NextResponse.json({ error: "Signed-in access is required." }, { status: 403 });
  }

  const body = (await request.json()) as { appointmentId?: string };

  try {
    await cancelApportionAppointment({
      actorIdentifier: actor.identifier,
      appointmentId: body.appointmentId ?? "",
    });
    publishWorkspaceEvent("apportion");
    return NextResponse.json(await buildApportionDashboardPayload(actor.identifier));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to cancel appointment." }, { status: 400 });
  }
}

export async function PATCH(request: Request) {
  const actor = await getWorkspaceActor(request);

  if (!actor?.identifier) {
    return NextResponse.json({ error: "Signed-in access is required." }, { status: 403 });
  }

  const body = (await request.json()) as {
    action?: "done" | "present-in-person" | "push-back" | "reject" | "reschedule";
    appointmentId?: string;
    nextServiceDateKey?: string;
    nextStartsAt?: string;
    notes?: string | null;
  };

  if (!body.action) {
    return NextResponse.json({ error: "Choose a valid appointment action." }, { status: 400 });
  }

  try {
    let appointmentsPerSlot: number | undefined;

    if (body.action === "reschedule") {
      const requesterAppointments = await listApportionAppointmentsForRequester(actor.identifier);
      const appointment = requesterAppointments.find((entry) => entry.id === body.appointmentId);

      if (!appointment) {
        throw new Error("Appointment not found.");
      }

      const ownerBranding = await getWorkspaceBranding(appointment.ownerIdentifier);
      const location = ownerBranding?.appointmentLocations?.find((location) => location.id === appointment.locationId);

      if (!location) {
        throw new Error("This appointment location is no longer available for rescheduling.");
      }

      validateAppointmentLocationSlot({
        location,
        serviceDateKey: body.nextServiceDateKey ?? "",
        slotDurationMinutes: ownerBranding?.slotDurationMinutes ?? 30,
        startsAt: body.nextStartsAt ?? "",
      });
      appointmentsPerSlot = ownerBranding?.appointmentsPerSlot ?? 1;
    }

    const result = await updateApportionAppointment({
      action: body.action,
      actorIdentifier: actor.identifier,
      appointmentsPerSlot,
      appointmentId: body.appointmentId ?? "",
      nextServiceDateKey: body.nextServiceDateKey,
      nextStartsAt: body.nextStartsAt,
      notes: body.notes,
    });
    publishWorkspaceEvent("apportion");
    const payload = await buildApportionDashboardPayload(actor.identifier);

    return NextResponse.json({
      ...payload,
      nextInPersonAppointment: result.nextInPersonAppointment,
      updatedAppointment: result.appointment,
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to update appointment." }, { status: 400 });
  }
}