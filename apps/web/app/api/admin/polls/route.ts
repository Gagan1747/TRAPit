import { NextResponse } from "next/server";
import { type PollParticipantType, type PollQuestionDraft, type WorkspaceBranding } from "@trapit/testing";

import { getWorkspaceActor } from "../../../../lib/workspace-actor";
import { assertCanCreatePollQuestions, assertCanSchedulePoll } from "../../../../lib/user-category-limits";
import {
  createPollQuestions,
  createScheduledPoll,
  listPollQuestions,
  listScheduledPolls,
  updateScheduledPoll,
} from "../../../../lib/testing-store";

type PollBody =
  | {
      drafts?: PollQuestionDraft[];
      mode?: "create-questions";
    }
  | {
      anonymous?: boolean;
      branding?: WorkspaceBranding | null;
      endsAt?: string;
      generateQrCode?: boolean;
      mode?: "schedule-poll";
      participantGroupIds?: string[];
      participantType?: PollParticipantType;
      questionIds?: string[];
      startsAt?: string;
      title?: string;
    }
  | {
      anonymous?: boolean;
      branding?: WorkspaceBranding | null;
      endsAt?: string;
      generateQrCode?: boolean;
      mode?: "update-poll";
      participantGroupIds?: string[];
      participantType?: PollParticipantType;
      pollId?: string;
      questionIds?: string[];
      startsAt?: string;
      title?: string;
    };

export async function GET() {
  const actor = await getWorkspaceActor();

  if (!actor) {
    return NextResponse.json({ error: "Signed-in access is required." }, { status: 403 });
  }

  try {
    const [pollQuestions, scheduledPolls] = await Promise.all([
      listPollQuestions(actor.sub),
      listScheduledPolls(actor.sub),
    ]);

    return NextResponse.json({ pollQuestions, scheduledPolls });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to load polls." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  const actor = await getWorkspaceActor();

  if (!actor) {
    return NextResponse.json({ error: "Signed-in access is required." }, { status: 403 });
  }

  const body = (await request.json()) as PollBody;

  if (body.mode === "create-questions") {
    if (!("drafts" in body) || !Array.isArray(body.drafts) || !body.drafts.length) {
      return NextResponse.json(
        { error: "Add at least one poll question before saving." },
        { status: 400 },
      );
    }

    if (actor.role === "user") {
      assertCanCreatePollQuestions(actor.userCategory);
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

    if (!("endsAt" in body) || !body.endsAt) {
      return NextResponse.json({ error: "Poll end time is required." }, { status: 400 });
    }

    if (!("title" in body) || !body.title?.trim()) {
      return NextResponse.json({ error: "Poll topic is required." }, { status: 400 });
    }

    if (actor.role === "user") {
      assertCanSchedulePoll(actor.userCategory, body.participantType ?? "registered");
    }

    try {
      const scheduledPolls = await createScheduledPoll({
        anonymous: Boolean(body.anonymous),
        branding: body.branding ?? null,
        createdBy: actor.sub,
        creatorDisplayName: actor.displayName,
        creatorIdentifier: actor.identifier,
        endsAt: body.endsAt,
        generateQrCode: Boolean(body.generateQrCode),
        participantGroupIds: body.participantGroupIds ?? [],
        participantType: body.participantType ?? "registered",
        questionIds: body.questionIds,
        startsAt: body.startsAt,
        title: body.title,
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

  if (body.mode === "update-poll") {
    if (!("pollId" in body) || !body.pollId) {
      return NextResponse.json({ error: "Poll id is required." }, { status: 400 });
    }

    if (!("questionIds" in body) || !Array.isArray(body.questionIds) || !body.questionIds.length) {
      return NextResponse.json({ error: "Select at least one poll question." }, { status: 400 });
    }

    if (!("startsAt" in body) || !body.startsAt) {
      return NextResponse.json({ error: "Poll start time is required." }, { status: 400 });
    }

    if (!("endsAt" in body) || !body.endsAt) {
      return NextResponse.json({ error: "Poll end time is required." }, { status: 400 });
    }

    if (!("title" in body) || !body.title?.trim()) {
      return NextResponse.json({ error: "Poll topic is required." }, { status: 400 });
    }

    if (actor.role === "user") {
      assertCanSchedulePoll(actor.userCategory, body.participantType ?? "registered");
    }

    try {
      const scheduledPolls = await updateScheduledPoll({
        anonymous: Boolean(body.anonymous),
        branding: body.branding ?? null,
        createdBy: actor.sub,
        creatorDisplayName: actor.displayName,
        creatorIdentifier: actor.identifier,
        endsAt: body.endsAt,
        generateQrCode: Boolean(body.generateQrCode),
        participantGroupIds: body.participantGroupIds ?? [],
        participantType: body.participantType ?? "registered",
        pollId: body.pollId,
        questionIds: body.questionIds,
        startsAt: body.startsAt,
        title: body.title,
      });
      const pollQuestions = await listPollQuestions(actor.sub);
      return NextResponse.json({ pollQuestions, scheduledPolls });
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Unable to update the poll." },
        { status: 400 },
      );
    }
  }

  return NextResponse.json({ error: "A supported poll action is required." }, { status: 400 });
}
