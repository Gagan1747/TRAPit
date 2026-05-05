import { NextResponse } from "next/server";

import { getWorkspaceActor } from "../../../../lib/workspace-actor";
import { listHistory, listLeaderboards, listStateSummary } from "../../../../lib/testing-store";

export async function GET() {
  const actor = await getWorkspaceActor();

  if (!actor) {
    return NextResponse.json({ error: "Signed-in access is required." }, { status: 403 });
  }

  const [history, leaderboards, summary] = await Promise.all([
    listHistory(actor.sub),
    listLeaderboards(actor.sub),
    listStateSummary({ actorIdentifier: actor.identifier, actorSub: actor.sub }),
  ]);

  return NextResponse.json({ history, leaderboards, summary });
}