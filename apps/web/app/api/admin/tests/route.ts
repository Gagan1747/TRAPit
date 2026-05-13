import { NextResponse } from "next/server";
import { type WorkspaceBranding } from "@trapit/testing";

import { getWorkspaceActor } from "../../../../lib/workspace-actor";
import { assertCanScheduleSelfTest, assertCanScheduleTest } from "../../../../lib/user-category-limits";
import { createScheduledTest, listScheduledTests, updateScheduledTest } from "../../../../lib/testing-store";

function normalizeIdentifier(value: string | null | undefined) {
  return value?.trim().toLowerCase().replace(/[\s()-]/g, "") ?? "";
}

function isSelfTestForActor(
  actorIdentifier: string | null,
  participantGroupIds: string[],
  participantIds: string[],
) {
  if (!actorIdentifier || participantGroupIds.length) {
    return false;
  }

  return participantIds.length === 1 && normalizeIdentifier(participantIds[0]) === normalizeIdentifier(actorIdentifier);
}

function isCurrentMonth(value: string) {
  const date = new Date(value);
  const now = new Date();

  return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
}

export async function GET() {
  const actor = await getWorkspaceActor();

  if (!actor) {
    return NextResponse.json({ error: "Signed-in access is required." }, { status: 403 });
  }

  const scheduledTests = await listScheduledTests(actor.sub);
  return NextResponse.json({ scheduledTests });
}

export async function POST(request: Request) {
  const actor = await getWorkspaceActor();

  if (!actor) {
    return NextResponse.json({ error: "Signed-in access is required." }, { status: 403 });
  }
  try {
    const body = (await request.json()) as {
      branding?: WorkspaceBranding | null;
      durationMinutes?: number;
      participantGroupIds?: string[];
      participantIds?: string[];
      poolId?: string;
      questionCount?: number;
      startsAt?: string;
      title?: string;
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

    if (actor.role === "user") {
      const scheduledTests = await listScheduledTests(actor.sub);
      const thisMonthTests = scheduledTests.filter((test) => isCurrentMonth(test.createdAt));
      const isSelfTest = isSelfTestForActor(actor.identifier, body.participantGroupIds ?? [], body.participantIds ?? []);

      if (isSelfTest) {
        assertCanScheduleSelfTest(
          actor.userCategory,
          thisMonthTests.filter((test) => isSelfTestForActor(actor.identifier, test.participantGroupIds, test.participantIds)).length,
        );
      } else {
        assertCanScheduleTest(
          actor.userCategory,
          thisMonthTests.filter((test) => !isSelfTestForActor(actor.identifier, test.participantGroupIds, test.participantIds)).length,
        );
      }
    }

    const scheduledTests = await createScheduledTest({
      actorIdentifier: actor.identifier,
      branding: body.branding ?? null,
      createdBy: actor.sub,
      durationMinutes: body.durationMinutes,
      participantGroupIds: body.participantGroupIds ?? [],
      participantIds: body.participantIds ?? [],
      poolId: body.poolId,
      questionCount: body.questionCount,
      startsAt: body.startsAt,
      title: body.title,
    });

    return NextResponse.json({ scheduledTests });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to schedule the test." },
      { status: 400 },
    );
  }
}

export async function PATCH(request: Request) {
  const actor = await getWorkspaceActor();

  if (!actor) {
    return NextResponse.json({ error: "Signed-in access is required." }, { status: 403 });
  }
  try {
    const body = (await request.json()) as {
      branding?: WorkspaceBranding | null;
      durationMinutes?: number;
      participantGroupIds?: string[];
      participantIds?: string[];
      poolId?: string;
      questionCount?: number;
      startsAt?: string;
      testId?: string;
      title?: string;
    };

    if (!body.testId || !body.poolId || !body.startsAt) {
      return NextResponse.json({ error: "Test, pool, and start time are required." }, { status: 400 });
    }

    if (!body.questionCount || body.questionCount < 1) {
      return NextResponse.json({ error: "Question count must be at least 1." }, { status: 400 });
    }

    if (!body.durationMinutes || body.durationMinutes < 1) {
      return NextResponse.json({ error: "Duration must be at least 1 minute." }, { status: 400 });
    }

    if (actor.role === "user") {
      const scheduledTests = await listScheduledTests(actor.sub);
      const thisMonthTests = scheduledTests
        .filter((test) => test.id !== body.testId)
        .filter((test) => isCurrentMonth(test.createdAt));
      const isSelfTest = isSelfTestForActor(actor.identifier, body.participantGroupIds ?? [], body.participantIds ?? []);

      if (isSelfTest) {
        assertCanScheduleSelfTest(
          actor.userCategory,
          thisMonthTests.filter((test) => isSelfTestForActor(actor.identifier, test.participantGroupIds, test.participantIds)).length,
        );
      } else {
        assertCanScheduleTest(
          actor.userCategory,
          thisMonthTests.filter((test) => !isSelfTestForActor(actor.identifier, test.participantGroupIds, test.participantIds)).length,
        );
      }
    }

    const scheduledTests = await updateScheduledTest({
      actorIdentifier: actor.identifier,
      branding: body.branding ?? null,
      createdBy: actor.sub,
      durationMinutes: body.durationMinutes,
      participantGroupIds: body.participantGroupIds ?? [],
      participantIds: body.participantIds ?? [],
      poolId: body.poolId,
      questionCount: body.questionCount,
      startsAt: body.startsAt,
      testId: body.testId,
      title: body.title,
    });

    return NextResponse.json({ scheduledTests });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to update the test." },
      { status: 400 },
    );
  }
}