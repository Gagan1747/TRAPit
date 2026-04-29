import { NextResponse } from "next/server";

import { getUserActor } from "../../../../lib/user-api";
import {
  listAvailableTestsForParticipant,
  listGroupJoinRequestsForUser,
  listUserHistory,
} from "../../../../lib/testing-store";

export async function GET(request: Request) {
  const actor = await getUserActor(request);

  if (!actor) {
    return NextResponse.json({ error: "User access is required." }, { status: 403 });
  }

  const [availableTests, groupJoinRequests, history] = await Promise.all([
    listAvailableTestsForParticipant(actor.identifier),
    listGroupJoinRequestsForUser(actor.identifier),
    listUserHistory(actor.identifier),
  ]);

  return NextResponse.json({
    availableTests,
    groupJoinRequests,
    history,
    identifier: actor.identifier,
    usingFallbackIdentifier: actor.usingFallbackIdentifier,
  });
}