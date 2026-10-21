import { NextResponse } from "next/server";

import { getUserActor } from "../../../../../../lib/user-api";
import { getTestParticipantSession, saveTestParticipantSession } from "../../../../../../lib/testing-store";

export async function GET(request: Request, context: { params: { testId: string } }) {
  const actor = await getUserActor(request);
  if (!actor) return NextResponse.json({ error: "User access is required." }, { status: 403 });
  try {
    return NextResponse.json(await getTestParticipantSession(context.params.testId, actor.identifier));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to load this test." }, { status: 400 });
  }
}

export async function POST(request: Request, context: { params: { testId: string } }) {
  const actor = await getUserActor(request);
  if (!actor) return NextResponse.json({ error: "User access is required." }, { status: 403 });
  try {
    const body: unknown = await request.json();
    if (!body || typeof body !== "object") throw new Error("A participant session is required.");
    const participantName = "participantName" in body ? body.participantName : undefined;
    const answers = "answers" in body ? body.answers : undefined;
    const elapsedMs = "elapsedMs" in body ? body.elapsedMs : undefined;
    const revision = "revision" in body ? body.revision : undefined;
    if (participantName !== undefined && typeof participantName !== "string") throw new Error("Enter a valid participant name.");
    if (revision !== undefined && typeof revision !== "number") throw new Error("Invalid answer revision.");
    if (elapsedMs !== undefined && (typeof elapsedMs !== "number" || !Number.isFinite(elapsedMs) || elapsedMs < 0)) throw new Error("Invalid elapsed time.");
    let validatedAnswers: Record<string, number | undefined> | undefined;
    if (answers !== undefined) {
      if (!answers || typeof answers !== "object" || Array.isArray(answers)) throw new Error("Invalid answers.");
      validatedAnswers = {};
      for (const [id, option] of Object.entries(answers)) {
        if (typeof option !== "number" || !Number.isInteger(option)) throw new Error("Invalid answer option.");
        validatedAnswers[id] = option;
      }
    }
    return NextResponse.json(await saveTestParticipantSession({
      testId: context.params.testId,
      identifier: actor.identifier,
      participantName,
      answers: validatedAnswers,
      elapsedMs,
      revision,
    }));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to save this test." }, { status: 400 });
  }
}
