import { NextResponse } from "next/server";

import { getWorkspaceActor } from "../../../../../../lib/workspace-actor";
import { getAdminTestReview } from "../../../../../../lib/testing-store";

export async function GET(
  _request: Request,
  context: { params: { testId: string } },
) {
  const actor = await getWorkspaceActor();

  if (!actor) {
    return NextResponse.json({ error: "Signed-in access is required." }, { status: 403 });
  }

  try {
    const payload = await getAdminTestReview(context.params.testId, actor.sub);
    return NextResponse.json(payload);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to load the review." },
      { status: 400 },
    );
  }
}
