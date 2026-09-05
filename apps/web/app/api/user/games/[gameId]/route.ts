import {
  GAME_CORRECT_POINTS,
  GAME_INCORRECT_POINTS,
  GAME_LAUNCH_COUNTDOWN_MS,
  GAME_QUESTION_COUNT,
  getGameQuestionDurationMs,
} from "@trapit/testing";
import { NextResponse } from "next/server";

import {
  getGameForParticipant,
  getOverallGamePoints,
  getWorkspaceData,
} from "../../../../../lib/testing-store";
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

  const [workspace, overallGamePoints] = await Promise.all([
    getWorkspaceData(),
    getOverallGamePoints(actor.identifier),
  ]);
  const currentQuestionIndex = game.currentQuestionIndex;
  const question = currentQuestionIndex === null
    ? null
    : game.presentedQuestions?.[currentQuestionIndex]
      ?? workspace.questions.find((entry) => entry.id === game.questionIds[currentQuestionIndex]);
  const participant = game.participants.find((entry) => identifiersMatch(entry.identifier, actor.identifier));
  const ownAnswers = game.answers.filter((answer) =>
    identifiersMatch(answer.participantIdentifier, actor.identifier),
  );
  const isAccepted = Boolean(participant?.acceptedAt);
  const isCreator = identifiersMatch(game.creatorIdentifier, actor.identifier);
  const isMissed = game.status === "completed"
    && !isAccepted
    && !(isCreator && game.creatorRole === "spectator");
  const reviewQuestions = game.status === "completed"
    ? game.questionIds.map((questionId, questionIndex) => {
      const reviewQuestion = game.presentedQuestions?.[questionIndex]
        ?? workspace.questions.find((entry) => entry.id === questionId);
        const answer = ownAnswers.find((entry) => entry.questionIndex === questionIndex) ?? null;

        return reviewQuestion
          ? {
              answer,
              correctOptionIndex: reviewQuestion.correctOptionIndex,
              id: reviewQuestion.id,
              options: reviewQuestion.options,
              prompt: reviewQuestion.prompt,
              questionIndex,
            }
          : null;
      }).filter((entry) => entry !== null)
    : [];
  const acceptedParticipants = game.participants
    .filter((entry) => entry.acceptedAt)
    .sort((left, right) => new Date(left.acceptedAt as string).getTime() - new Date(right.acceptedAt as string).getTime());

  return NextResponse.json({
    game: {
      acceptedCount: game.acceptedCount,
      canStart: isCreator && Boolean(game.creatorRole) && game.acceptedCount >= 4,
      countdownDeadline: game.countdownDeadline,
      creatorRole: game.creatorRole ?? null,
      currentQuestion: question
        ? { id: question.id, options: question.options, prompt: question.prompt }
        : null,
      currentQuestionIndex: game.currentQuestionIndex,
      displayName: participant?.label ?? actor.identifier,
      isAccepted,
      isCreator,
      isMissed,
      leaderboard: game.leaderboard,
      overallGamePoints,
      ownAnswers,
      participantCount: game.participants.length,
      participants: acceptedParticipants.map((entry) => ({
        acceptedAt: entry.acceptedAt,
        identifier: entry.identifier,
        label: entry.label,
      })),
      questionDeadline: game.questionDeadline,
      recentDeltas: game.answers.slice(-6).map((answer) => ({
        answeredAt: answer.answeredAt,
        participantIdentifier: answer.participantIdentifier,
        points: answer.points,
      })),
      reviewQuestions,
      rules: {
        correctPoints: GAME_CORRECT_POINTS,
        incorrectPoints: GAME_INCORRECT_POINTS,
        launchCountdownMs: game.rulesVersion === 2 ? GAME_LAUNCH_COUNTDOWN_MS : 0,
        questionCount: GAME_QUESTION_COUNT,
        questionDurationMs: getGameQuestionDurationMs(game),
      },
      status: game.status,
      title: game.title,
      viewerMode: isAccepted ? "participant" : "spectator",
    },
    serverNow: new Date().toISOString(),
  });
}
