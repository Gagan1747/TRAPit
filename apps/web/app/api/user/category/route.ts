import { NextResponse } from "next/server";

import { getWorkspaceActor } from "../../../../lib/workspace-actor";
import { createUserCategoryUpgradeRequest, getUserCategorySnapshot } from "../../../../lib/user-category-store";

export async function GET(request: Request) {
  const actor = await getWorkspaceActor(request);

  if (!actor || actor.role !== "user") {
    return NextResponse.json({ error: "User access is required." }, { status: 403 });
  }

  const snapshot = await getUserCategorySnapshot({
    currentCategory: actor.userCategory,
    displayName: actor.displayName,
    identifier: actor.identifier,
    sub: actor.sub,
  });

  return NextResponse.json(snapshot);
}

export async function POST(request: Request) {
  const actor = await getWorkspaceActor(request);

  if (!actor || actor.role !== "user") {
    return NextResponse.json({ error: "User access is required." }, { status: 403 });
  }

  const body = (await request.json()) as { requestedCategory?: string };

  if (!body.requestedCategory?.trim()) {
    return NextResponse.json({ error: "Select a category before sending an upgrade request." }, { status: 400 });
  }

  try {
    const snapshot = await createUserCategoryUpgradeRequest({
      currentCategory: actor.userCategory,
      displayName: actor.displayName,
      identifier: actor.identifier,
      requestedCategory: body.requestedCategory as typeof actor.userCategory,
      sub: actor.sub,
    });

    return NextResponse.json(snapshot);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to send the upgrade request." },
      { status: 400 },
    );
  }
}