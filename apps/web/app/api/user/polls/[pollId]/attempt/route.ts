import { NextResponse } from "next/server";

import { getUserActor } from "../../../../../../lib/user-api";
import { getParticipantPollById, recordParticipantPollAttempt } from "../../../../../../lib/testing-store";

function maskPhoneNumber(value: string | null) {
  if (!value) {
    return null;
  }

  const digits = value.replace(/\D/g, "");

  if (digits.length < 4) {
    return null;
  }

  return `${"*".repeat(Math.max(0, digits.length - 4))}${digits.slice(-4)}`;
}

export async function POST(
  request: Request,
  context: { params: { pollId: string } },
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
    const attempt = await recordParticipantPollAttempt({
      answers: body.answers,
      completedAt: body.completedAt,
      participantName: body.participantName,
      pollId: context.params.pollId,
      startedAt: body.startedAt,
      userId: actor.identifier,
    });
    const poll = await getParticipantPollById(context.params.pollId, actor.identifier);

    return NextResponse.json({
      actor: {
        displayName: actor.displayName,
        identifier: actor.identifier,
        isRegistered: true,
      },
      creator: {
        displayName: poll.poll.creatorDisplayName ?? null,
        maskedIdentifier: maskPhoneNumber(poll.poll.creatorIdentifier ?? null),
      },
      attempt,
      ...poll,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to submit this poll." },
      { status: 400 },
    );
  }
}
