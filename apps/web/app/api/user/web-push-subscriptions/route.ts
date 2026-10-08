import { NextResponse } from "next/server";

import { removeOwnedWebPushSubscription, upsertWebPushSubscription } from "../../../../lib/notification-store";
import { getWorkspaceActor } from "../../../../lib/workspace-actor";

export async function POST(request: Request) {
  const actor = await getWorkspaceActor(request);

  if (!actor?.sub || !actor.identifier || (actor.role !== "user" && actor.role !== "admin")) {
    return NextResponse.json({ error: "Signed-in access is required." }, { status: 403 });
  }

  if (request.headers.get("origin") && request.headers.get("origin") !== new URL(request.url).origin) {
    return NextResponse.json({ error: "Same-origin access is required." }, { status: 403 });
  }

  try {
    const body = await request.json() as { endpoint?: unknown; keys?: { auth?: unknown; p256dh?: unknown } };
    if (typeof body.endpoint !== "string" || typeof body.keys?.auth !== "string" || typeof body.keys.p256dh !== "string") {
      return NextResponse.json({ error: "A valid browser push subscription is required." }, { status: 400 });
    }
    const endpoint = new URL(body.endpoint);
    const trustedHosts = ["fcm.googleapis.com", "push.services.mozilla.com", "push.apple.com", "notify.windows.com"];
    if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password || endpoint.port
      || !trustedHosts.some((host) => endpoint.hostname === host || endpoint.hostname.endsWith(`.${host}`))
      || !/^[A-Za-z0-9_-]{20,24}={0,2}$/.test(body.keys.auth)
      || !/^[A-Za-z0-9_-]{86,88}={0,2}$/.test(body.keys.p256dh)) {
      return NextResponse.json({ error: "A valid browser push subscription is required." }, { status: 400 });
    }
    const subscription = await upsertWebPushSubscription({
      endpoint: body.endpoint,
      keys: { auth: body.keys.auth, p256dh: body.keys.p256dh },
      userAgent: request.headers.get("user-agent"),
      userIdentifier: actor.identifier,
      userSub: actor.sub,
    });

    return NextResponse.json({ registered: true, subscriptionId: subscription.id });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to register browser notifications." },
      { status: error instanceof SyntaxError || error instanceof TypeError ? 400 : 500 },
    );
  }

}

export async function DELETE(request: Request) {
  const actor = await getWorkspaceActor(request);
  if (!actor?.sub) return NextResponse.json({ error: "Signed-in access is required." }, { status: 403 });
  if (request.headers.get("origin") && request.headers.get("origin") !== new URL(request.url).origin) {
    return NextResponse.json({ error: "Same-origin access is required." }, { status: 403 });
  }
  try {
    const body = await request.json() as { endpoint?: unknown };
    if (typeof body.endpoint !== "string") return NextResponse.json({ error: "An endpoint is required." }, { status: 400 });
    await removeOwnedWebPushSubscription(body.endpoint, actor.sub);
    return NextResponse.json({ removed: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to remove browser notifications." }, { status: error instanceof SyntaxError ? 400 : 500 });
  }
}