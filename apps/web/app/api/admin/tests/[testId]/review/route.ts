import { NextResponse } from "next/server";

import { getAdminActor } from "../../../../../../lib/admin-api";
import { getAdminTestReview } from "../../../../../../lib/testing-store";

export async function GET(
  _request: Request,
  context: { params: { testId: string } },
) {
  const actor = await getAdminActor();

  if (!actor) {
    return NextResponse.json({ error: "Admin access is required." }, { status: 403 });
  }

  try {
    const payload = await getAdminTestReview(context.params.testId);
    return NextResponse.json(payload);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to load the review." },
      { status: 400 },
    );
  }
}
