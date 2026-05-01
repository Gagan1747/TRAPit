import { NextResponse } from "next/server";

import { getAdminActor } from "../../../../lib/admin-api";
import { createScheduledTest, listScheduledTests } from "../../../../lib/testing-store";

export async function GET() {
  const actor = await getAdminActor();

  if (!actor) {
    return NextResponse.json({ error: "Admin access is required." }, { status: 403 });
  }

  const scheduledTests = await listScheduledTests(actor.sub);
  return NextResponse.json({ scheduledTests });
}

export async function POST(request: Request) {
  const actor = await getAdminActor();

  if (!actor) {
    return NextResponse.json({ error: "Admin access is required." }, { status: 403 });
  }

  const body = (await request.json()) as {
    durationMinutes?: number;
    participantGroupIds?: string[];
    participantIds?: string[];
    poolId?: string;
    questionCount?: number;
    startsAt?: string;
  };

  if (!body.poolId || !body.startsAt) {
    return NextResponse.json({ error: "Pool and start time are required." }, { status: 400 });
  }

  if (!body.questionCount || body.questionCount < 1) {
    return NextResponse.json({ error: "Question count must be at least 1." }, { status: 400 });
  }

  if (!body.durationMinutes || body.durationMinutes < 1) {
    return NextResponse.json({ error: "Duration must be at least 1 minute." }, { status: 400 });
  }

  try {
    const scheduledTests = await createScheduledTest({
      createdBy: actor.sub,
      durationMinutes: body.durationMinutes,
      participantGroupIds: body.participantGroupIds ?? [],
      participantIds: body.participantIds ?? [],
      poolId: body.poolId,
      questionCount: body.questionCount,
      startsAt: body.startsAt,
    });

    return NextResponse.json({ scheduledTests });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to schedule the test." },
      { status: 400 },
    );
  }
}