import { NextResponse } from "next/server";

import { cancelApportionAppointment, listApportionAppointmentsForOwner, listApportionAppointmentsForRequester, updateApportionAppointment } from "../../../../lib/apportion-store";
import { publishWorkspaceEvent } from "../../../../lib/realtime-events";
import { getOrCreateWorkspaceAppointmentShareCode, getWorkspaceBranding } from "../../../../lib/testing-store";
import { getWorkspaceActor } from "../../../../lib/workspace-actor";

type OwnerOperatingHours = {
  justAddToList: boolean;
  slotDurationMinutes: number | null;
  workingHours: string;
  workingHoursSecondWindow: string;
};

async function buildApportionDashboardPayload(actorIdentifier: string) {
  const [appointmentShareCode, ownerAppointments, requesterAppointments] = await Promise.all([
    getOrCreateWorkspaceAppointmentShareCode(actorIdentifier),
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
        justAddToList: ownerBranding?.justAddToList === true,
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
    nextStartsAt?: string;
    notes?: string | null;
  };

  if (!body.action) {
    return NextResponse.json({ error: "Choose a valid appointment action." }, { status: 400 });
  }

  try {
    const result = await updateApportionAppointment({
      action: body.action,
      actorIdentifier: actor.identifier,
      appointmentId: body.appointmentId ?? "",
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