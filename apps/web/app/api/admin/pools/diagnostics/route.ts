import { participantIdentifiersMatch } from "@trapit/testing";
import { NextResponse } from "next/server";

import { getWorkspaceData } from "../../../../../lib/testing-store";
import { getSuperAdminActor } from "../../../../../lib/workspace-actor";

export async function GET(request: Request) {
  const actor = await getSuperAdminActor(request);

  if (!actor) {
    return NextResponse.json({ error: "Super-admin access is required." }, { status: 403 });
  }

  const url = new URL(request.url);
  const targetIdentifier = url.searchParams.get("identifier")?.trim() || null;
  const targetSub = url.searchParams.get("sub")?.trim() || null;
  const workspace = await getWorkspaceData();
  const questionMap = new Map(workspace.questions.map((question) => [question.id, question]));

  const pools = workspace.pools.map((pool) => {
    const isOwner = Boolean(targetSub && pool.createdBy === targetSub);
    const isShared = Boolean(
      targetIdentifier
      && pool.sharedWithIdentifiers.some((identifier) =>
        participantIdentifiersMatch(identifier, targetIdentifier),
      ),
    );
    const hasOwnedQuestion = Boolean(
      targetSub
      && pool.questionIds.some((questionId) => questionMap.get(questionId)?.createdBy === targetSub),
    );
    const missingQuestionIds = pool.questionIds.filter((questionId) => !questionMap.has(questionId));
    const accessReason = isOwner
      ? "owner"
      : isShared
        ? "shared"
        : hasOwnedQuestion
          ? "question-owner"
          : null;

    return {
      accessReason,
      createdBy: pool.createdBy,
      existingQuestionCount: pool.questionIds.length - missingQuestionIds.length,
      id: pool.id,
      isAccessible: Boolean(accessReason),
      missingQuestionIds,
      name: pool.name,
      sharedWithIdentifiers: pool.sharedWithIdentifiers,
    };
  });

  return NextResponse.json({
    pools,
    target: { identifier: targetIdentifier, sub: targetSub },
  });
}