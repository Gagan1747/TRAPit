import { NextResponse } from "next/server";

import { cancelApportionAppointment, listApportionAppointmentsForOwner, listApportionAppointmentsForRequester } from "../../../../lib/apportion-store";
import { getOrCreateWorkspaceAppointmentShareCode } from "../../../../lib/testing-store";
import { getWorkspaceActor } from "../../../../lib/workspace-actor";

export async function GET(request: Request) {
  const actor = await getWorkspaceActor(request);

  if (!actor?.identifier) {
    return NextResponse.json({ error: "Signed-in access is required." }, { status: 403 });
  }

  const [appointmentShareCode, ownerAppointments, requesterAppointments] = await Promise.all([
    getOrCreateWorkspaceAppointmentShareCode(actor.identifier),
    listApportionAppointmentsForOwner(actor.identifier),
    listApportionAppointmentsForRequester(actor.identifier),
  ]);

  return NextResponse.json({ appointmentShareCode, ownerAppointments, requesterAppointments });
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