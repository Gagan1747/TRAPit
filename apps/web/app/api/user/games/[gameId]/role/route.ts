import type { GameCreatorRole } from "@trapit/testing";
import { NextResponse } from "next/server";

import { publishWorkspaceEvent } from "../../../../../../lib/realtime-events";
import { setGameCreatorRole } from "../../../../../../lib/testing-store";
import { getUserActor } from "../../../../../../lib/user-api";

export async function POST(request: Request, context: { params: { gameId: string } }) {
  const actor = await getUserActor(request);

  if (!actor) {
    return NextResponse.json({ error: "User access is required." }, { status: 403 });
  }

  try {
    const body = (await request.json()) as { role?: GameCreatorRole };

    if (body.role !== "participant" && body.role !== "spectator") {
      return NextResponse.json({ error: "Choose Join Game or Watch Game." }, { status: 400 });
    }

    const game = await setGameCreatorRole(context.params.gameId, actor.identifier, body.role);
    publishWorkspaceEvent("game");
    return NextResponse.json({ game });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to choose the creator role." },
      { status: 400 },
    );
  }
}
