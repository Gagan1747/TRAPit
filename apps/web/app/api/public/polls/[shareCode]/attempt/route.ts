import { getSessionDisplayName, getSessionIdentifier } from "@trapit/auth";
import { NextResponse } from "next/server";

import { getPollByShareCode, recordPollAttempt } from "../../../../../../lib/testing-store";
import { getWebSession } from "../../../../../../lib/session";

async function getRegisteredActor() {
  const session = await getWebSession();

  if (!session || (session.role !== "user" && session.role !== "admin") || !session.sub) {
    return null;
  }

  const identifier = getSessionIdentifier(session)?.trim() ?? "";

  if (!identifier) {
    return null;
  }

  return {
    displayName: getSessionDisplayName(session),
    identifier,
    isRegistered: true,
  };
}

export async function POST(
  request: Request,
  context: { params: { sharecode: string } },
) {
  const actor = await getRegisteredActor();
  const body = (await request.json()) as {
    answers?: Record<string, number | undefined>;
    completedAt?: string;
    guestId?: string;
    participantName?: string;
    startedAt?: string;
  };
  const userId = actor?.identifier ?? body.guestId?.trim() ?? "";

  if (!body.startedAt || !body.completedAt || !body.answers || !body.participantName?.trim() || !userId) {
    return NextResponse.json(
      { error: "Started time, completed time, participant name, guest session, and answers are required." },
      { status: 400 },
    );
  }

  try {
    const attempt = await recordPollAttempt({
      answers: body.answers,
      completedAt: body.completedAt,
      participantName: body.participantName,
      shareCode: context.params.sharecode,
      startedAt: body.startedAt,
      userId,
    });
    const poll = await getPollByShareCode(context.params.sharecode, userId);

    return NextResponse.json({
      actor: actor ?? {
        displayName: null,
        identifier: null,
        isRegistered: false,
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