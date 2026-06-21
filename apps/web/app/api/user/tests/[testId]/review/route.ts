import { NextResponse } from "next/server";

import { getUserActor } from "../../../../../../lib/user-api";
import { getUserTestReview, reportTestQuestion } from "../../../../../../lib/testing-store";

type UserTestReviewBody = {
  mode?: "report-question";
  questionId?: string;
  reason?: string;
};

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

export async function POST(
  request: Request,
  context: { params: { testId: string } },
) {
  const actor = await getUserActor(request);

  if (!actor) {
    return NextResponse.json({ error: "User access is required." }, { status: 403 });
  }

  try {
    const body = (await request.json()) as UserTestReviewBody;

    if (body.mode !== "report-question") {
      return NextResponse.json({ error: "A supported review action is required." }, { status: 400 });
    }

    if (!body.questionId?.trim()) {
      return NextResponse.json({ error: "Question id is required." }, { status: 400 });
    }

    const payload = await reportTestQuestion({
      questionId: body.questionId,
      reason: body.reason ?? "",
      reporterIdentifier: actor.identifier,
      reporterLabel: actor.displayName,
      testId: context.params.testId,
    });

    return NextResponse.json(payload);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to report the question." },
      { status: 400 },
    );
  }
}
