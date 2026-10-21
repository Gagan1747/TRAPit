import { NextResponse } from "next/server";

import { getUserActor } from "../../../../../../lib/user-api";
import { startInstantTest } from "../../../../../../lib/testing-store";

export async function POST(request: Request, context: { params: { testId: string } }) {
  const actor = await getUserActor(request);
  if (!actor) return NextResponse.json({ error: "User access is required." }, { status: 403 });
  try {
    return NextResponse.json(await startInstantTest(context.params.testId, actor.identifier));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to start this test." }, { status: 400 });
  }
}
