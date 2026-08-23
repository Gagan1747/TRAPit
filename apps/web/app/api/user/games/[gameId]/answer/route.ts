import { NextResponse } from "next/server";

import { publishWorkspaceEvent } from "../../../../../../lib/realtime-events";
import { recordGameAnswer } from "../../../../../../lib/testing-store";
import { getUserActor } from "../../../../../../lib/user-api";

export async function POST(request: Request, context: { params: { gameId: string } }) {
  const actor = await getUserActor(request);

  if (!actor) {
    return NextResponse.json({ error: "User access is required." }, { status: 403 });
  }

  try {
    const body = (await request.json()) as { optionIndex?: number; questionIndex?: number };

    if (!Number.isInteger(body.optionIndex) || !Number.isInteger(body.questionIndex)) {
      return NextResponse.json({ error: "Question and answer are required." }, { status: 400 });
    }

    const result = await recordGameAnswer({
      gameId: context.params.gameId,
      optionIndex: body.optionIndex as number,
      participantIdentifier: actor.identifier,
      questionIndex: body.questionIndex as number,
    });

    publishWorkspaceEvent("game");
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to submit the answer." },
      { status: 400 },
    );
  }
}
