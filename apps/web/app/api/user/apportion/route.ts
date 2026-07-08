import { NextResponse } from "next/server";

import { listApportionAppointmentsForOwner, listApportionAppointmentsForRequester } from "../../../../lib/apportion-store";
import { getWorkspaceActor } from "../../../../lib/workspace-actor";

export async function GET(request: Request) {
  const actor = await getWorkspaceActor(request);

  if (!actor?.identifier) {
    return NextResponse.json({ error: "Signed-in access is required." }, { status: 403 });
  }

  const [ownerAppointments, requesterAppointments] = await Promise.all([
    listApportionAppointmentsForOwner(actor.identifier),
    listApportionAppointmentsForRequester(actor.identifier),
  ]);

  return NextResponse.json({ ownerAppointments, requesterAppointments });
}