import { NextResponse } from "next/server";

import { getWorkspaceActor } from "../../../../lib/workspace-actor";
import { assertCanCreateQuestionPool } from "../../../../lib/user-category-limits";
import { createPool, listPoolsForActor } from "../../../../lib/testing-store";

export async function GET() {
  const actor = await getWorkspaceActor();

  if (!actor) {
    return NextResponse.json({ error: "Signed-in access is required." }, { status: 403 });
  }

  const pools = await listPoolsForActor(actor.sub);
  return NextResponse.json({ pools });
}

export async function POST(request: Request) {
  const actor = await getWorkspaceActor();

  if (!actor) {
    return NextResponse.json({ error: "Signed-in access is required." }, { status: 403 });
  }

  const body = (await request.json()) as { description?: string; name?: string };

  if (!body.name?.trim()) {
    return NextResponse.json({ error: "Pool name is required." }, { status: 400 });
  }

  if (actor.role === "user") {
    const existingPools = await listPoolsForActor(actor.sub);
    assertCanCreateQuestionPool(actor.userCategory, existingPools.length);
  }

  const pools = await createPool({
    createdBy: actor.sub,
    description: body.description,
    name: body.name,
  });

  return NextResponse.json({ pools });
}