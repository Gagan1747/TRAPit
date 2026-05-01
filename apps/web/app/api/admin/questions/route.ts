import { NextResponse } from "next/server";
import { validateQuestionDraft, type QuestionDraft } from "@trapit/testing";

import { getAdminActor } from "../../../../lib/admin-api";
import {
  createQuestion,
  deleteQuestions,
  importQuestions,
  listQuestions,
} from "../../../../lib/testing-store";

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

async function requireAdmin() {
  const actor = await getAdminActor();

  return actor;
}

export async function GET() {
  const actor = await requireAdmin();

  if (!actor) {
    return NextResponse.json({ error: "Admin access is required." }, { status: 403 });
  }

  const questions = await listQuestions(actor.sub);

  return NextResponse.json({ questions });
}

export async function POST(request: Request) {
  const actor = await requireAdmin();

  if (!actor) {
    return NextResponse.json({ error: "Admin access is required." }, { status: 403 });
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

    const questions = await importQuestions(drafts, actor.sub, body.poolIds ?? []);
    return NextResponse.json({ questions });
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

  const questions = await createQuestion(body.draft, actor.sub, "manual", body.poolIds ?? []);

  return NextResponse.json({ questions });
}

export async function DELETE(request: Request) {
  const actor = await requireAdmin();

  if (!actor) {
    return NextResponse.json({ error: "Admin access is required." }, { status: 403 });
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
      return NextResponse.json({ questions });
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