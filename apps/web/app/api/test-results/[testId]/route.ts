import { NextResponse } from "next/server";

import { getTestResults } from "../../../../lib/testing-store";
import { getWorkspaceActor } from "../../../../lib/workspace-actor";

export async function GET(request: Request, context: { params: { testId: string } }) {
  const actor = await getWorkspaceActor(request);

  if (!actor) {
    return NextResponse.json({ error: "Signed-in access is required." }, { status: 403 });
  }

  const participantIdentifier = actor.identifier?.trim() ?? "";

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

export async function POST(request: Request, context: { params: { testId: string } }) {
  const actor = await getWorkspaceActor(request);

  if (!actor) {
    return NextResponse.json({ error: "Signed-in access is required." }, { status: 403 });
  }

  try {
    const body = (await request.json()) as {
      questionId?: string;
      reason?: string;
    };

    if (!body.questionId?.trim()) {
      return NextResponse.json({ error: "Question ID is required." }, { status: 400 });
    }

    const { reportPostTestQuestion } = await import("../../../../lib/testing-store");
    const payload = await reportPostTestQuestion({
      actorId: actor.sub,
      questionId: body.questionId.trim(),
      reason: body.reason ?? null,
      reporterIdentifier: actor.identifier?.trim() ?? "",
      testId: context.params.testId,
    });

    return NextResponse.json(payload);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to report question." },
      { status: 400 },
    );
  }
}