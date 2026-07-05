import { NextResponse } from "next/server";

import { upsertWebPushSubscription } from "../../../../lib/notification-store";
import { getWorkspaceActor } from "../../../../lib/workspace-actor";

export async function POST(request: Request) {
  const actor = await getWorkspaceActor(request);

  if (!actor || (actor.role !== "user" && actor.role !== "admin")) {
    return NextResponse.json({ error: "Signed-in access is required." }, { status: 403 });
  }

  const body = (await request.json()) as {
    endpoint?: string;
    keys?: {
      auth?: string;
      p256dh?: string;
    };
  };

  if (!body.endpoint?.trim() || !body.keys?.auth?.trim() || !body.keys.p256dh?.trim()) {
    return NextResponse.json({ error: "A valid browser push subscription is required." }, { status: 400 });
  }

  try {
    const subscription = await upsertWebPushSubscription({
      endpoint: body.endpoint,
      keys: body.keys,
      userAgent: request.headers.get("user-agent"),
      userIdentifier: actor.identifier,
      userSub: actor.sub,
    });

    return NextResponse.json({ registered: true, subscriptionId: subscription.id });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to register browser notifications." },
      { status: 400 },
    );
  }
}