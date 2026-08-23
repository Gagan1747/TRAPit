import { NextResponse } from "next/server";

import { publishWorkspaceEvent } from "../../../../../../lib/realtime-events";
import { acceptGame } from "../../../../../../lib/testing-store";
import { getUserActor } from "../../../../../../lib/user-api";

export async function POST(request: Request, context: { params: { gameId: string } }) {
  const actor = await getUserActor(request);

  if (!actor) {
    return NextResponse.json({ error: "User access is required." }, { status: 403 });
  }

  try {
    const game = await acceptGame(context.params.gameId, actor.identifier);
    publishWorkspaceEvent("game");
    return NextResponse.json({ game });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to accept the game." },
      { status: 400 },
    );
  }
}
