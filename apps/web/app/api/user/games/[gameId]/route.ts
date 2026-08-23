import { GAME_QUESTION_DURATION_MS } from "@trapit/testing";
import { NextResponse } from "next/server";

import { getGameForParticipant, getWorkspaceData } from "../../../../../lib/testing-store";
import { getUserActor } from "../../../../../lib/user-api";

function identifiersMatch(left: string, right: string) {
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}

export async function GET(request: Request, context: { params: { gameId: string } }) {
  const actor = await getUserActor(request);

  if (!actor) {
    return NextResponse.json({ error: "User access is required." }, { status: 403 });
  }

  const game = await getGameForParticipant(context.params.gameId, actor.identifier);

  if (!game) {
    return NextResponse.json({ error: "Game not found." }, { status: 404 });
  }

  const workspace = await getWorkspaceData();
  const currentQuestionIndex = game.currentQuestionIndex;
  const question = currentQuestionIndex === null
    ? null
    : workspace.questions.find((entry) => entry.id === game.questionIds[currentQuestionIndex]);
  const participant = game.participants.find((entry) => identifiersMatch(entry.identifier, actor.identifier));
  const ownAnswers = game.answers.filter((answer) =>
    identifiersMatch(answer.participantIdentifier, actor.identifier),
  );
  const questionDeadline = game.startedAt && game.currentQuestionIndex !== null
    ? new Date(
        new Date(game.startedAt).getTime()
        + (game.currentQuestionIndex + 1) * GAME_QUESTION_DURATION_MS,
      ).toISOString()
    : null;

  return NextResponse.json({
    game: {
      acceptedCount: game.acceptedCount,
      canStart: identifiersMatch(game.creatorIdentifier, actor.identifier) && game.acceptedCount >= 4,
      currentQuestion: question
        ? { id: question.id, options: question.options, prompt: question.prompt }
        : null,
      currentQuestionIndex: game.currentQuestionIndex,
      isAccepted: Boolean(participant?.acceptedAt),
      isCreator: identifiersMatch(game.creatorIdentifier, actor.identifier),
      leaderboard: game.leaderboard,
      ownAnswers,
      participantCount: game.participants.length,
      participants: game.participants.map((entry) => ({
        accepted: Boolean(entry.acceptedAt),
        identifier: entry.identifier,
        label: entry.label,
      })),
      questionDeadline,
      recentDeltas: game.answers.slice(-6).map((answer) => ({
        answeredAt: answer.answeredAt,
        participantIdentifier: answer.participantIdentifier,
        points: answer.points,
      })),
      status: game.status,
      title: game.title,
    },
    serverNow: new Date().toISOString(),
  });
}
