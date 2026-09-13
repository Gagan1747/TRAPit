import { NextResponse } from "next/server";

import { publishWorkspaceEvent } from "../../../../../../lib/realtime-events";
import { recordGameQuestionReady } from "../../../../../../lib/testing-store";
import { getUserActor } from "../../../../../../lib/user-api";

export async function POST(request: Request, context: { params: { gameId: string } }) {
  const actor = await getUserActor(request);

  if (!actor) {
    return NextResponse.json({ error: "User access is required." }, { status: 403 });
  }

  try {
    const body = (await request.json()) as { questionIndex?: number };
    if (!Number.isInteger(body.questionIndex)) {
      return NextResponse.json({ error: "Question is required." }, { status: 400 });
    }

    const game = await recordGameQuestionReady({
      gameId: context.params.gameId,
      participantIdentifier: actor.identifier,
      questionIndex: body.questionIndex as number,
    });
    publishWorkspaceEvent("game");
    return NextResponse.json({ game });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to mark the question ready." },
      { status: 400 },
    );
  }
}
