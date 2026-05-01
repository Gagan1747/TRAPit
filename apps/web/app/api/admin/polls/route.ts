import { NextResponse } from "next/server";
import { type PollParticipantType, type PollQuestionDraft } from "@trapit/testing";

import { getAdminActor } from "../../../../lib/admin-api";
import {
  createPollQuestions,
  createScheduledPoll,
  listPollQuestions,
  listScheduledPolls,
} from "../../../../lib/testing-store";

type PollBody =
  | {
      drafts?: PollQuestionDraft[];
      mode?: "create-questions";
    }
  | {
      anonymous?: boolean;
      durationMinutes?: number;
      generateQrCode?: boolean;
      mode?: "schedule-poll";
      participantGroupIds?: string[];
      participantType?: PollParticipantType;
      questionIds?: string[];
      startsAt?: string;
    };

export async function GET() {
  const actor = await getAdminActor();

  if (!actor) {
    return NextResponse.json({ error: "Admin access is required." }, { status: 403 });
  }

  const [pollQuestions, scheduledPolls] = await Promise.all([
    listPollQuestions(actor.sub),
    listScheduledPolls(actor.sub),
  ]);

  return NextResponse.json({ pollQuestions, scheduledPolls });
}

export async function POST(request: Request) {
  const actor = await getAdminActor();

  if (!actor) {
    return NextResponse.json({ error: "Admin access is required." }, { status: 403 });
  }

  const body = (await request.json()) as PollBody;

  if (body.mode === "create-questions") {
    if (!("drafts" in body) || !Array.isArray(body.drafts) || !body.drafts.length) {
      return NextResponse.json(
        { error: "Add at least one poll question before saving." },
        { status: 400 },
      );
    }

    try {
      const pollQuestions = await createPollQuestions(body.drafts, actor.sub);
      const scheduledPolls = await listScheduledPolls(actor.sub);
      return NextResponse.json({ pollQuestions, scheduledPolls });
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Unable to save the poll questions." },
        { status: 400 },
      );
    }
  }

  if (body.mode === "schedule-poll") {
    if (!("questionIds" in body) || !Array.isArray(body.questionIds) || !body.questionIds.length) {
      return NextResponse.json({ error: "Select at least one poll question." }, { status: 400 });
    }

    if (!("startsAt" in body) || !body.startsAt) {
      return NextResponse.json({ error: "Poll start time is required." }, { status: 400 });
    }

    if (!("durationMinutes" in body) || !body.durationMinutes || body.durationMinutes < 1) {
      return NextResponse.json({ error: "Duration must be at least 1 minute." }, { status: 400 });
    }

    try {
      const scheduledPolls = await createScheduledPoll({
        anonymous: Boolean(body.anonymous),
        createdBy: actor.sub,
        durationMinutes: body.durationMinutes,
        generateQrCode: Boolean(body.generateQrCode),
        participantGroupIds: body.participantGroupIds ?? [],
        participantType: body.participantType ?? "registered",
        questionIds: body.questionIds,
        startsAt: body.startsAt,
      });
      const pollQuestions = await listPollQuestions(actor.sub);
      return NextResponse.json({ pollQuestions, scheduledPolls });
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Unable to schedule the poll." },
        { status: 400 },
      );
    }
  }

  return NextResponse.json({ error: "A supported poll action is required." }, { status: 400 });
}
