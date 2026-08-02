import { NextResponse } from "next/server";

import { cancelApportionAppointment, listApportionAppointmentsForOwner, listApportionAppointmentsForRequester, updateApportionAppointment } from "../../../../lib/apportion-store";
import { publishWorkspaceEvent } from "../../../../lib/realtime-events";
import { getOrCreateWorkspaceAppointmentShareCode } from "../../../../lib/testing-store";
import { getWorkspaceActor } from "../../../../lib/workspace-actor";

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

  return { appointmentShareCode, appointments, ownerAppointments, requesterAppointments };
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
    const [appointmentShareCode, ownerAppointments, requesterAppointments] = await Promise.all([
      getOrCreateWorkspaceAppointmentShareCode(actor.identifier),
      listApportionAppointmentsForOwner(actor.identifier),
      listApportionAppointmentsForRequester(actor.identifier),
    ]);

    return NextResponse.json({ appointmentShareCode, ownerAppointments, requesterAppointments });
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