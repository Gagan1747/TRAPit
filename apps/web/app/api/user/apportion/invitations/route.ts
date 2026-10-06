import { NextResponse } from "next/server";
import { ApportionInvitationError, listApportionInvitationsForActor, respondToApportionInvitation } from "../../../../../lib/apportion-store";
import { publishWorkspaceEvent } from "../../../../../lib/realtime-events";
import { getWorkspaceActor } from "../../../../../lib/workspace-actor";

export async function GET(request: Request) {
  const actor = await getWorkspaceActor(request);
  if (!actor?.identifier) return NextResponse.json({ error: "Signed-in access is required." }, { status: 403 });
  return NextResponse.json({ invitations: await listApportionInvitationsForActor(actor.identifier) });
}

export async function PATCH(request: Request) {
  const actor = await getWorkspaceActor(request);
  if (!actor?.identifier) return NextResponse.json({ error: "Signed-in access is required." }, { status: 403 });
  try {
    const body: unknown = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new ApportionInvitationError("A valid invitation action is required.");
    const { invitationId, action } = body as { invitationId?: unknown; action?: unknown };
    if (typeof invitationId !== "string" || !invitationId.trim() || (action !== "accept" && action !== "decline" && action !== "cancel")) {
      throw new ApportionInvitationError("A valid invitation ID and action are required.");
    }
    const result = await respondToApportionInvitation({ actorIdentifier: actor.identifier, invitationId: invitationId.trim(), action });
    publishWorkspaceEvent("apportion");
    return NextResponse.json({ invitations: await listApportionInvitationsForActor(actor.identifier), appointmentIds: result.appointmentIds });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to respond to invitation." },
      { status: error instanceof ApportionInvitationError ? error.status : 400 });
  }
}