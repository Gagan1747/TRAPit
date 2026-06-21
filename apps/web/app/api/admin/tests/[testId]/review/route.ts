import { NextResponse } from "next/server";

import { getWorkspaceActor } from "../../../../../../lib/workspace-actor";
import { getAdminTestReview, updateCompletedTestQuestion } from "../../../../../../lib/testing-store";

type AdminTestReviewBody = {
  correctOptionIndex?: number;
  mode?: "update-question";
  options?: string[];
  prompt?: string;
  questionId?: string;
};

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

export async function POST(
  request: Request,
  context: { params: { testId: string } },
) {
  const actor = await getWorkspaceActor();

  if (!actor) {
    return NextResponse.json({ error: "Signed-in access is required." }, { status: 403 });
  }

  try {
    const body = (await request.json()) as AdminTestReviewBody;

    if (body.mode !== "update-question") {
      return NextResponse.json({ error: "A supported review action is required." }, { status: 400 });
    }

    if (!body.questionId?.trim()) {
      return NextResponse.json({ error: "Question id is required." }, { status: 400 });
    }

    if (!body.prompt?.trim() || !Array.isArray(body.options) || typeof body.correctOptionIndex !== "number") {
      return NextResponse.json({ error: "Question, options, and correct answer are required." }, { status: 400 });
    }

    const payload = await updateCompletedTestQuestion({
      actorId: actor.sub,
      correctOptionIndex: body.correctOptionIndex,
      options: body.options,
      prompt: body.prompt,
      questionId: body.questionId,
      testId: context.params.testId,
    });

    return NextResponse.json(payload);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to update the review question." },
      { status: 400 },
    );
  }
}
