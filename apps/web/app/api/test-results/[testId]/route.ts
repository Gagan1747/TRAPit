import { NextResponse } from "next/server";

import { getTestResults } from "../../../../lib/testing-store";
import { getWorkspaceActor } from "../../../../lib/workspace-actor";

export async function GET(request: Request, context: { params: { testId: string } }) {
  const actor = await getWorkspaceActor(request);

  if (!actor) {
    return NextResponse.json({ error: "Signed-in access is required." }, { status: 403 });
  }

  const fallbackIdentifier = new URL(request.url).searchParams.get("participantId")?.trim() ?? "";
  const participantIdentifier = actor.identifier?.trim() || fallbackIdentifier;

  try {
    const payload = await getTestResults({
      actorId: actor.sub,
      participantIdentifier,
      testId: context.params.testId,
    });
    return NextResponse.json(payload);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to load test results." },
      { status: 400 },
    );
  }
}