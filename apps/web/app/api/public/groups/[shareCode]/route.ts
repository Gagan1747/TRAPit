import { getSessionDisplayName, getSessionIdentifier } from "@trapit/auth";
import { NextResponse } from "next/server";

import {
  getParticipantGroupInviteByShareCode,
  listGroupJoinRequestsForUser,
  requestParticipantGroupAccessByShareCode,
} from "../../../../../lib/testing-store";
import { getWebSession } from "../../../../../lib/session";

async function getRegisteredActor() {
  const session = await getWebSession();

  if (!session || (session.role !== "user" && session.role !== "admin") || !session.sub) {
    return {
      displayName: null,
      identifier: null,
      isRegistered: false,
    };
  }

  const identifier = getSessionIdentifier(session)?.trim() ?? "";

  if (!identifier) {
    return {
      displayName: null,
      identifier: null,
      isRegistered: false,
    };
  }

  return {
    displayName: getSessionDisplayName(session),
    identifier,
    isRegistered: true,
  };
}

export async function GET(
  _request: Request,
  context: { params: { shareCode: string } },
) {
  const actor = await getRegisteredActor();

  try {
    const invite = await getParticipantGroupInviteByShareCode(
      context.params.shareCode,
      actor.identifier,
    );

    return NextResponse.json({
      actor,
      ...invite,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to load this group invite." },
      { status: 404 },
    );
  }
}

export async function POST(
  _request: Request,
  context: { params: { shareCode: string } },
) {
  const actor = await getRegisteredActor();

  if (!actor.isRegistered || !actor.identifier) {
    return NextResponse.json({ error: "Sign in to continue with this group invite." }, { status: 403 });
  }

  try {
    await requestParticipantGroupAccessByShareCode({
      requesterId: actor.identifier,
      requesterLabel: actor.displayName?.trim() || actor.identifier,
      shareCode: context.params.shareCode,
    });

    const [invite, groupJoinRequests] = await Promise.all([
      getParticipantGroupInviteByShareCode(context.params.shareCode, actor.identifier),
      listGroupJoinRequestsForUser(actor.identifier),
    ]);

    return NextResponse.json({
      actor,
      groupJoinRequests,
      ...invite,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to join this group." },
      { status: 400 },
    );
  }
}