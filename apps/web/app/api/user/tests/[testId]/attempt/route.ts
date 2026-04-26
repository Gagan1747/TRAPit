import { NextResponse } from "next/server";

import { getUserActor } from "../../../../../../lib/user-api";
import { recordAttempt } from "../../../../../../lib/testing-store";

export async function POST(
  request: Request,
  context: { params: { testId: string } },
) {
  const actor = await getUserActor(request);

  if (!actor) {
    return NextResponse.json({ error: "User access is required." }, { status: 403 });
  }

  const body = (await request.json()) as {
    answers?: Record<string, number | undefined>;
    completedAt?: string;
    participantName?: string;
    startedAt?: string;
  };

  if (!body.startedAt || !body.completedAt || !body.answers || !body.participantName?.trim()) {
    return NextResponse.json(
      { error: "Started time, completed time, participant name, and answers are required." },
      { status: 400 },
    );
  }

  try {
    const attempt = await recordAttempt({
      answers: body.answers,
      completedAt: body.completedAt,
      participantName: body.participantName,
      startedAt: body.startedAt,
      testId: context.params.testId,
      userId: actor.identifier,
    });

    return NextResponse.json({ attempt });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to submit this test." },
      { status: 400 },
    );
  }
}