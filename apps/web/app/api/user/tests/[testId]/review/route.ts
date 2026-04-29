import { NextResponse } from "next/server";

import { getUserActor } from "../../../../../../lib/user-api";
import { getUserTestReview } from "../../../../../../lib/testing-store";

export async function GET(
  request: Request,
  context: { params: { testId: string } },
) {
  const actor = await getUserActor(request);

  if (!actor) {
    return NextResponse.json({ error: "User access is required." }, { status: 403 });
  }

  try {
    const payload = await getUserTestReview(context.params.testId, actor.identifier);
    return NextResponse.json(payload);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to load the review." },
      { status: 400 },
    );
  }
}
