import { NextResponse } from "next/server";
import { validateQuestionDraft, type QuestionDraft } from "@trapit/testing";

import { getWorkspaceActor } from "../../../../../lib/workspace-actor";
import { assertCanAddQuestionsToPools } from "../../../../../lib/user-category-limits";
import { deleteQuestion, listPoolsForActor, listQuestions, updateQuestion } from "../../../../../lib/testing-store";

function decorateQuestion<T extends { createdBy: string | null }>(
  question: T,
  actorSub: string | null,
) {
  const canManage = Boolean(actorSub && question.createdBy === actorSub);

  return {
    ...question,
    canManage,
    isShared: !canManage,
  };
}

export async function DELETE(
  _request: Request,
  context: { params: { questionId: string } },
) {
  const workspaceActor = await getWorkspaceActor();

  if (!workspaceActor) {
    return NextResponse.json({ error: "Signed-in access is required." }, { status: 403 });
  }

  try {
    const questions = await deleteQuestion(context.params.questionId, workspaceActor.sub);
    return NextResponse.json({ questions: questions.map((question) => decorateQuestion(question, workspaceActor.sub)) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to remove the question." },
      { status: 400 },
    );
  }
}

export async function PATCH(
  request: Request,
  context: { params: { questionId: string } },
) {
  const actor = await getWorkspaceActor();

  if (!actor) {
    return NextResponse.json({ error: "Signed-in access is required." }, { status: 403 });
  }
  try {
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

    if (actor.role === "user" && body.poolIds) {
      const [questions, pools] = await Promise.all([
        listQuestions(actor.sub, actor.identifier),
        listPoolsForActor(actor.sub, actor.identifier),
      ]);
      const editedQuestion = questions.find((question) => question.id === context.params.questionId);
      const nextCounts = body.poolIds.map((poolId) => {
        const pool = pools.find((entry) => entry.id === poolId);
        const alreadyIncluded = editedQuestion?.poolIds.includes(poolId) ?? false;

        return (pool?.questionIds.length ?? 0) + (alreadyIncluded ? 0 : 1);
      });

      assertCanAddQuestionsToPools(actor.userCategory, nextCounts);
    }

    const questions = await updateQuestion(context.params.questionId, {
      draft: body.draft,
      poolIds: body.poolIds,
    }, actor.sub, actor.identifier);

    return NextResponse.json({ questions: questions.map((question) => decorateQuestion(question, actor.sub)) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to update the question." },
      { status: 400 },
    );
  }
}