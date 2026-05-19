import { NextResponse } from "next/server";

import { getUserActor } from "../../../../../lib/user-api";
import { getParticipantPollById } from "../../../../../lib/testing-store";

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

export async function GET(
  request: Request,
  context: { params: { pollId: string } },
) {
  const actor = await getUserActor(request);

  if (!actor) {
    return NextResponse.json({ error: "User access is required." }, { status: 403 });
  }

  try {
    const payload = await getParticipantPollById(context.params.pollId, actor.identifier);

    return NextResponse.json({
      actor: {
        displayName: actor.displayName,
        identifier: actor.identifier,
        isRegistered: true,
      },
      creator: {
        displayName: payload.poll.creatorDisplayName ?? null,
        maskedIdentifier: maskPhoneNumber(payload.poll.creatorIdentifier ?? null),
      },
      ...payload,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to load this poll." },
      { status: 400 },
    );
  }
}
