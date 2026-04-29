import { NextResponse } from "next/server";

import { getAdminActor } from "../../../../lib/admin-api";
import { isWebAuthConfigured } from "../../../../lib/auth-config";
import { listRegisteredDirectoryUsers } from "../../../../lib/cognito";
import {
  createGroup,
  createParticipant,
  listGroupJoinRequestsForAdmin,
  listParticipantGroupsForOwner,
  listParticipantGroups,
  listParticipants,
  resolveGroupJoinRequest,
  syncParticipants,
  updateGroup,
} from "../../../../lib/testing-store";

type ParticipantBody =
  | {
      identifier?: string;
      label?: string;
      mode?: "create-participant";
    }
  | {
      decision?: "accept" | "reject";
      mode?: "resolve-request";
      requestId?: string;
    }
  | {
      description?: string;
      mode?: "create-group";
      name?: string;
      participantIds?: string[];
    }
  | {
      groupId?: string;
      mode?: "update-group";
      name?: string;
      participantIds?: string[];
    };

function isCreateGroupBody(
  body: ParticipantBody,
): body is Extract<ParticipantBody, { mode?: "create-group" }> {
  return body.mode === "create-group";
}

function isUpdateGroupBody(
  body: ParticipantBody,
): body is Extract<ParticipantBody, { mode?: "update-group" }> {
  return body.mode === "update-group";
}

function isResolveRequestBody(
  body: ParticipantBody,
): body is Extract<ParticipantBody, { mode?: "resolve-request" }> {
  return body.mode === "resolve-request";
}

export async function GET() {
  const actor = await getAdminActor();

  if (!actor) {
    return NextResponse.json({ error: "Admin access is required." }, { status: 403 });
  }

  let participantsPromise = listParticipants();

  if (isWebAuthConfigured()) {
    try {
      const directoryUsers = await listRegisteredDirectoryUsers();
      participantsPromise = syncParticipants(directoryUsers);
    } catch {
      participantsPromise = listParticipants();
    }
  }

  const [participants, participantGroups, groupJoinRequests] = await Promise.all([
    participantsPromise,
    actor.identifier
      ? listParticipantGroupsForOwner(actor.identifier, { includeUnowned: true })
      : listParticipantGroups(),
    actor.identifier ? listGroupJoinRequestsForAdmin(actor.identifier) : Promise.resolve([]),
  ]);

  return NextResponse.json({ groupJoinRequests, participantGroups, participants });
}

export async function POST(request: Request) {
  const actor = await getAdminActor();

  if (!actor) {
    return NextResponse.json({ error: "Admin access is required." }, { status: 403 });
  }

  const body = (await request.json()) as ParticipantBody;

  if (isCreateGroupBody(body)) {
    if (!body.name?.trim()) {
      return NextResponse.json({ error: "Group or class name is required." }, { status: 400 });
    }

    const participantGroups = await createGroup({
      description: body.description,
      name: body.name,
      ownerIdentifier: actor.identifier,
      participantIds: body.participantIds ?? [],
    });
    const participants = await listParticipants();
    const groupJoinRequests = actor.identifier
      ? await listGroupJoinRequestsForAdmin(actor.identifier)
      : [];

    return NextResponse.json({ groupJoinRequests, participantGroups, participants });
  }

  if (isUpdateGroupBody(body)) {
    if (!body.groupId?.trim()) {
      return NextResponse.json({ error: "Group id is required." }, { status: 400 });
    }

    if (!body.name?.trim()) {
      return NextResponse.json({ error: "Group or class name is required." }, { status: 400 });
    }

    try {
      const participantGroups = await updateGroup({
        groupId: body.groupId,
        name: body.name,
        ownerIdentifier: actor.identifier,
        participantIds: body.participantIds ?? [],
      });
      const participants = await listParticipants();
      const groupJoinRequests = actor.identifier
        ? await listGroupJoinRequestsForAdmin(actor.identifier)
        : [];

      return NextResponse.json({ groupJoinRequests, participantGroups, participants });
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Unable to update the group." },
        { status: 400 },
      );
    }
  }

  if (isResolveRequestBody(body)) {
    if (!body.requestId?.trim() || !body.decision) {
      return NextResponse.json(
        { error: "Request id and decision are required." },
        { status: 400 },
      );
    }

    if (!actor.identifier) {
      return NextResponse.json(
        { error: "Admin identifier is required to manage requests." },
        { status: 400 },
      );
    }

    try {
      const payload = await resolveGroupJoinRequest({
        adminIdentifier: actor.identifier,
        decision: body.decision,
        requestId: body.requestId,
      });

      return NextResponse.json(payload);
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Unable to update the request." },
        { status: 400 },
      );
    }
  }

  if (!("identifier" in body) || !body.identifier?.trim()) {
    return NextResponse.json({ error: "Participant identifier is required." }, { status: 400 });
  }

  const participants = await createParticipant({
    identifier: body.identifier,
    label: body.label,
  });
  const participantGroups = actor.identifier
    ? await listParticipantGroupsForOwner(actor.identifier, { includeUnowned: true })
    : await listParticipantGroups();
  const groupJoinRequests = actor.identifier
    ? await listGroupJoinRequestsForAdmin(actor.identifier)
    : [];

  return NextResponse.json({ groupJoinRequests, participantGroups, participants });
}