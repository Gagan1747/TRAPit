import { NextResponse } from "next/server";

import { getUserActor } from "../../../../lib/user-api";
import {
  listAvailablePollsForParticipant,
  listAvailableTestsForParticipant,
  listGroupJoinRequestsForUser,
  listUserHistory,
} from "../../../../lib/testing-store";

export async function GET(request: Request) {
  const actor = await getUserActor(request);

  if (!actor) {
    return NextResponse.json({ error: "User access is required." }, { status: 403 });
  }

  try {
    const [availablePolls, availableTests, groupJoinRequests, history] = await Promise.all([
      listAvailablePollsForParticipant(actor.identifier),
      listAvailableTestsForParticipant(actor.identifier),
      listGroupJoinRequestsForUser(actor.identifier),
      listUserHistory(actor.identifier),
    ]);

    return NextResponse.json({
      availablePolls,
      availableTests,
      groupJoinRequests,
      history,
      identifier: actor.identifier,
      usingFallbackIdentifier: actor.usingFallbackIdentifier,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to load the dashboard." },
      { status: 500 },
    );
  }
}