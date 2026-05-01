import { NextResponse } from "next/server";

import { getAdminActor } from "../../../../lib/admin-api";
import { listHistory, listLeaderboards, listStateSummary } from "../../../../lib/testing-store";

export async function GET() {
  const actor = await getAdminActor();

  if (!actor) {
    return NextResponse.json({ error: "Admin access is required." }, { status: 403 });
  }

  const [history, leaderboards, summary] = await Promise.all([
    listHistory(actor.sub),
    listLeaderboards(actor.sub),
    listStateSummary({ actorIdentifier: actor.identifier, actorSub: actor.sub }),
  ]);

  return NextResponse.json({ history, leaderboards, summary });
}