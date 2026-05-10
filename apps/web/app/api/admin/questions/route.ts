import { NextResponse } from "next/server";
import { validateQuestionDraft, type QuestionDraft } from "@trapit/testing";

import { getWorkspaceActor } from "../../../../lib/workspace-actor";
import { assertCanAddQuestionsToPools } from "../../../../lib/user-category-limits";
import {
  createQuestion,
  deleteQuestions,
  importQuestions,
  listQuestions,
  listPoolsForActor,
} from "../../../../lib/testing-store";

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

type CreateQuestionBody = {
  draft?: QuestionDraft;
  drafts?: QuestionDraft[];
  mode?: "create" | "import";
  poolIds?: string[];
};

type DeleteQuestionsBody = {
  questionIds?: string[];
};

function hasPoolSelection(poolIds?: string[]) {
  return Array.isArray(poolIds) && poolIds.some((poolId) => poolId.trim());
}

async function requireWorkspaceActor() {
  const actor = await getWorkspaceActor();

  return actor;
}

export async function GET() {
  const actor = await requireWorkspaceActor();

  if (!actor) {
    return NextResponse.json({ error: "Signed-in access is required." }, { status: 403 });
  }

  const questions = await listQuestions(actor.sub, actor.identifier);

  return NextResponse.json({ questions: questions.map((question) => decorateQuestion(question, actor.sub)) });
}

export async function POST(request: Request) {
  const actor = await requireWorkspaceActor();

  if (!actor) {
    return NextResponse.json({ error: "Signed-in access is required." }, { status: 403 });
  }

  const body = (await request.json()) as CreateQuestionBody;

  if (body.mode === "import") {
    const drafts = body.drafts ?? [];
    const invalidDraft = drafts.find((draft) => validateQuestionDraft(draft));

    if (!drafts.length || invalidDraft) {
      return NextResponse.json(
        { error: "Only valid imported questions can be saved." },
        { status: 400 },
      );
    }

    if (!hasPoolSelection(body.poolIds)) {
      return NextResponse.json(
        { error: "Select at least one pool before importing questions." },
        { status: 400 },
      );
    }

    if (actor.role === "user") {
      const pools = await listPoolsForActor(actor.sub, actor.identifier);
      const nextCounts = (body.poolIds ?? []).map((poolId) => {
        const pool = pools.find((entry) => entry.id === poolId);
        return (pool?.questionIds.length ?? 0) + drafts.length;
      });

      assertCanAddQuestionsToPools(actor.userCategory, nextCounts);
    }

    const questions = await importQuestions(drafts, actor.sub, body.poolIds ?? [], actor.identifier);
    return NextResponse.json({ questions: questions.map((question) => decorateQuestion(question, actor.sub)) });
  }

  if (body.mode !== "create" || !body.draft) {
    return NextResponse.json({ error: "A question draft is required." }, { status: 400 });
  }

  const validationError = validateQuestionDraft(body.draft);

  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 });
  }

  if (!hasPoolSelection(body.poolIds)) {
    return NextResponse.json(
      { error: "Select at least one pool before saving a question." },
      { status: 400 },
    );
  }

  if (actor.role === "user") {
    const pools = await listPoolsForActor(actor.sub, actor.identifier);
    const nextCounts = (body.poolIds ?? []).map((poolId) => {
      const pool = pools.find((entry) => entry.id === poolId);
      return (pool?.questionIds.length ?? 0) + 1;
    });

    assertCanAddQuestionsToPools(actor.userCategory, nextCounts);
  }

  const questions = await createQuestion(body.draft, actor.sub, "manual", body.poolIds ?? [], actor.identifier);

  return NextResponse.json({ questions: questions.map((question) => decorateQuestion(question, actor.sub)) });
}

export async function DELETE(request: Request) {
  const actor = await requireWorkspaceActor();

  if (!actor) {
    return NextResponse.json({ error: "Signed-in access is required." }, { status: 403 });
  }

  let body: DeleteQuestionsBody = {};

  try {
    body = (await request.json()) as DeleteQuestionsBody;
  } catch {
    body = {};
  }

  if (Array.isArray(body.questionIds) && body.questionIds.length) {
    try {
      const questions = await deleteQuestions(body.questionIds, actor.sub);
      return NextResponse.json({ questions: questions.map((question) => decorateQuestion(question, actor.sub)) });
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Unable to remove the selected questions." },
        { status: 400 },
      );
    }
  }

  return NextResponse.json(
    { error: "Select specific questions to remove." },
    { status: 400 },
  );
}