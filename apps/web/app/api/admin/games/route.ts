import { NextResponse } from "next/server";

import { publishWorkspaceEvent } from "../../../../lib/realtime-events";
import { createScheduledGame, listGamesForParticipant } from "../../../../lib/testing-store";
import { getWorkspaceActor } from "../../../../lib/workspace-actor";

export async function GET() {
  const actor = await getWorkspaceActor();

  if (!actor?.identifier) {
    return NextResponse.json({ error: "Signed-in access is required." }, { status: 403 });
  }

  const games = await listGamesForParticipant(actor.identifier);
  return NextResponse.json({ games });
}

export async function POST(request: Request) {
  const actor = await getWorkspaceActor(request);

  if (!actor?.identifier) {
    return NextResponse.json({ error: "Signed-in access is required." }, { status: 403 });
  }

  try {
    const body = (await request.json()) as {
      participantGroupId?: string;
      poolId?: string;
      title?: string;
    };

    if (!body.participantGroupId || !body.poolId) {
      return NextResponse.json({ error: "Question pool and group are required." }, { status: 400 });
    }

    const game = await createScheduledGame({
      actorIdentifier: actor.identifier,
      actorLabel: actor.displayName,
      createdBy: actor.sub,
      participantGroupId: body.participantGroupId,
      poolId: body.poolId,
      title: body.title,
    });

    publishWorkspaceEvent("game");
    return NextResponse.json({ game });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to create the game." },
      { status: 400 },
    );
  }
}
