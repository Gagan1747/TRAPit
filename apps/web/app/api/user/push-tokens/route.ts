import { NextResponse } from "next/server";

import { upsertPushToken } from "../../../../lib/notification-store";
import { getWorkspaceActor } from "../../../../lib/workspace-actor";

export async function POST(request: Request) {
  const actor = await getWorkspaceActor(request);

  if (!actor || (actor.role !== "user" && actor.role !== "admin")) {
    return NextResponse.json({ error: "Signed-in access is required." }, { status: 403 });
  }

  const body = (await request.json()) as {
    deviceName?: string | null;
    platform?: string | null;
    token?: string;
  };

  if (!body.token?.trim()) {
    return NextResponse.json({ error: "Push token is required." }, { status: 400 });
  }

  try {
    const pushToken = await upsertPushToken({
      deviceName: body.deviceName ?? null,
      platform: body.platform ?? null,
      token: body.token,
      userIdentifier: actor.identifier,
      userSub: actor.sub,
    });

    return NextResponse.json({ registered: true, tokenId: pushToken.id });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to register push token." },
      { status: 400 },
    );
  }
}