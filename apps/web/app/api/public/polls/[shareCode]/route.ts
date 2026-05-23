import { getSessionDisplayName, getSessionIdentifier } from "@trapit/auth";
import { NextResponse } from "next/server";

import { getPollByShareCode, requestScheduledPollAccessByShareCode } from "../../../../../lib/testing-store";
import { getWebSession } from "../../../../../lib/session";

async function getRegisteredActor() {
  const session = await getWebSession();

  if (!session || (session.role !== "user" && session.role !== "admin") || !session.sub) {
    return {
      displayName: null,
      identifier: null,
      isRegistered: false,
      sub: null,
    };
  }

  const identifier = getSessionIdentifier(session)?.trim() ?? "";

  if (!identifier) {
    return {
      displayName: null,
      identifier: null,
      isRegistered: false,
      sub: null,
    };
  }

  return {
    displayName: getSessionDisplayName(session),
    identifier,
    isRegistered: true,
    sub: session.sub,
  };
}

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
  _request: Request,
  context: { params: { shareCode: string } },
) {
  const actor = await getRegisteredActor();

  try {
    const payload = await getPollByShareCode(context.params.shareCode, {
      identifier: actor.identifier,
      isRegistered: actor.isRegistered,
      responseUserId: actor.identifier,
      sub: actor.sub,
    });

    return NextResponse.json({
      actor: {
        displayName: actor.displayName,
        identifier: actor.identifier,
        isRegistered: actor.isRegistered,
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
      { status: 404 },
    );
  }
}

export async function POST(
  _request: Request,
  context: { params: { shareCode: string } },
) {
  const actor = await getRegisteredActor();

  if (!actor.isRegistered || !actor.identifier) {
    return NextResponse.json({ error: "Sign in to continue with this poll link." }, { status: 403 });
  }

  try {
    await requestScheduledPollAccessByShareCode({
      requesterId: actor.identifier,
      requesterLabel: actor.displayName?.trim() || actor.identifier,
      shareCode: context.params.shareCode,
    });

    const payload = await getPollByShareCode(context.params.shareCode, {
      identifier: actor.identifier,
      isRegistered: actor.isRegistered,
      responseUserId: actor.identifier,
      sub: actor.sub,
    });

    return NextResponse.json({
      actor: {
        displayName: actor.displayName,
        identifier: actor.identifier,
        isRegistered: actor.isRegistered,
      },
      creator: {
        displayName: payload.poll.creatorDisplayName ?? null,
        maskedIdentifier: maskPhoneNumber(payload.poll.creatorIdentifier ?? null),
      },
      ...payload,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to request access to this poll." },
      { status: 400 },
    );
  }
}