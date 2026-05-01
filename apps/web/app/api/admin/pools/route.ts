import { NextResponse } from "next/server";

import { getAdminActor } from "../../../../lib/admin-api";
import { createPool, listPoolsForActor } from "../../../../lib/testing-store";

export async function GET() {
  const actor = await getAdminActor();

  if (!actor) {
    return NextResponse.json({ error: "Admin access is required." }, { status: 403 });
  }

  const pools = await listPoolsForActor(actor.sub);
  return NextResponse.json({ pools });
}

export async function POST(request: Request) {
  const actor = await getAdminActor();

  if (!actor) {
    return NextResponse.json({ error: "Admin access is required." }, { status: 403 });
  }

  const body = (await request.json()) as { description?: string; name?: string };

  if (!body.name?.trim()) {
    return NextResponse.json({ error: "Pool name is required." }, { status: 400 });
  }

  const pools = await createPool({
    createdBy: actor.sub,
    description: body.description,
    name: body.name,
  });

  return NextResponse.json({ pools });
}