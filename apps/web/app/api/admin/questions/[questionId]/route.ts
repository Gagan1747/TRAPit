import { NextResponse } from "next/server";
import { validateQuestionDraft, type QuestionDraft } from "@trapit/testing";

import { getAdminActor } from "../../../../../lib/admin-api";
import { deleteQuestion, updateQuestion } from "../../../../../lib/testing-store";

export async function DELETE(
  _request: Request,
  context: { params: { questionId: string } },
) {
  const actor = await getAdminActor();

  if (!actor) {
    return NextResponse.json({ error: "Admin access is required." }, { status: 403 });
  }

  const questions = await deleteQuestion(context.params.questionId);
  return NextResponse.json({ questions });
}

export async function PATCH(
  request: Request,
  context: { params: { questionId: string } },
) {
  const actor = await getAdminActor();

  if (!actor) {
    return NextResponse.json({ error: "Admin access is required." }, { status: 403 });
  }

  const body = (await request.json()) as {
    draft?: QuestionDraft;
    poolIds?: string[];
  };

  if (!body.draft && !body.poolIds) {
    return NextResponse.json(
      { error: "Question updates require edited content or pool assignments." },
      { status: 400 },
    );
  }

  if (body.draft) {
    const validationError = validateQuestionDraft(body.draft);

    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 });
    }
  }

  if (body.poolIds && !body.poolIds.some((poolId) => poolId.trim())) {
    return NextResponse.json(
      { error: "Questions must stay assigned to at least one pool." },
      { status: 400 },
    );
  }

  try {
    const questions = await updateQuestion(context.params.questionId, {
      draft: body.draft,
      poolIds: body.poolIds,
    });

    return NextResponse.json({ questions });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to update the question." },
      { status: 400 },
    );
  }
}