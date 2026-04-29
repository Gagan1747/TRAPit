import { NextResponse } from "next/server";

import { getUserActor } from "../../../../lib/user-api";
import {
  createGroupJoinRequest,
  listGroupJoinRequestsForUser,
  searchParticipantGroupsByOwner,
} from "../../../../lib/testing-store";

export async function GET(request: Request) {
  const actor = await getUserActor(request);

  if (!actor) {
    return NextResponse.json({ error: "User access is required." }, { status: 403 });
  }

  const url = new URL(request.url);
  const phoneNumber = url.searchParams.get("phone")?.trim();

  if (!phoneNumber) {
    return NextResponse.json({ error: "Admin phone number is required." }, { status: 400 });
  }

  const [groupJoinRequests, participantGroups] = await Promise.all([
    listGroupJoinRequestsForUser(actor.identifier),
    searchParticipantGroupsByOwner(phoneNumber),
  ]);

  return NextResponse.json({ groupJoinRequests, participantGroups });
}

export async function POST(request: Request) {
  const actor = await getUserActor(request);

  if (!actor) {
    return NextResponse.json({ error: "User access is required." }, { status: 403 });
  }

  const body = (await request.json()) as { adminGroupId?: string };

  if (!body.adminGroupId?.trim()) {
    return NextResponse.json({ error: "Group id is required." }, { status: 400 });
  }

  try {
    const requestEntry = await createGroupJoinRequest({
      adminGroupId: body.adminGroupId,
      requesterId: actor.identifier,
      requesterLabel: actor.displayName ?? actor.identifier,
    });
    const groupJoinRequests = await listGroupJoinRequestsForUser(actor.identifier);

    return NextResponse.json({ groupJoinRequests, request: requestEntry });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to submit the request." },
      { status: 400 },
    );
  }
}
