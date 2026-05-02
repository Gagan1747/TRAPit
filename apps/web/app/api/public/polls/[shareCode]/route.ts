import { getSessionDisplayName, getSessionIdentifier } from "@trapit/auth";
import { NextResponse } from "next/server";

import { getPollByShareCode } from "../../../../../lib/testing-store";
import { getWebSession } from "../../../../../lib/session";

async function getRegisteredActor() {
  const session = await getWebSession();

  if (!session || (session.role !== "user" && session.role !== "admin") || !session.sub) {
    return {
      displayName: null,
      identifier: null,
      isRegistered: false,
    };
  }

  const identifier = getSessionIdentifier(session)?.trim() ?? "";

  if (!identifier) {
    return {
      displayName: null,
      identifier: null,
      isRegistered: false,
    };
  }

  return {
    displayName: getSessionDisplayName(session),
    identifier,
    isRegistered: true,
  };
}

export async function GET(
  _request: Request,
  context: { params: { shareCode: string } },
) {
  const actor = await getRegisteredActor();

  try {
    const payload = await getPollByShareCode(context.params.shareCode, actor.identifier);

    return NextResponse.json({
      actor,
      ...payload,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to load this poll." },
      { status: 404 },
    );
  }
}