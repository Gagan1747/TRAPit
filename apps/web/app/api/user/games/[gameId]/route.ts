import {
  GAME_CORRECT_POINTS,
  GAME_INCORRECT_POINTS,
  GAME_LAUNCH_COUNTDOWN_MS,
  GAME_QUESTION_COUNT,
  getGameQuestionDurationMs,
  participantIdentifiersMatch,
} from "@trapit/testing";
import { NextResponse } from "next/server";

import {
  getGameForParticipant,
  getOverallGamePoints,
  getWorkspaceData,
} from "../../../../../lib/testing-store";
import { getUserActor } from "../../../../../lib/user-api";

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
  const participant = game.participants.find((entry) =>
    participantIdentifiersMatch(entry.identifier, actor.identifier),
  );
  const ownAnswers = game.answers.filter((answer) =>
    participantIdentifiersMatch(answer.participantIdentifier, actor.identifier),
  );
  const isAccepted = Boolean(participant?.acceptedAt);
  const isCreator = participantIdentifiersMatch(game.creatorIdentifier, actor.identifier);
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
  const poolName = workspace.pools.find((pool) => pool.id === game.poolId)?.name ?? "Unknown pool";
  const groupName = (game.participantGroupIds ?? [game.participantGroupId]).map((id) =>
    workspace.participantGroups.find((group) => group.id === id)?.name ?? "Unknown group").join(", ");
  const creatorProfile = workspace.participants.find((profile) =>
    participantIdentifiersMatch(profile.identifier, game.creatorIdentifier),
  );
  const creatorParticipant = game.participants.find((entry) =>
    participantIdentifiersMatch(entry.identifier, game.creatorIdentifier),
  );
  const rapid = game.rulesVersion === 4;
  const completed = game.status === "completed";
  const standings = game.leaderboard.map((entry) => {
    const responses = game.answers.filter((answer) => participantIdentifiersMatch(answer.participantIdentifier, entry.participantIdentifier));
    return {
      ...entry,
      isSelf: participantIdentifiersMatch(entry.participantIdentifier, actor.identifier),
      maskedIdentifier: /^\+?[\d\s()-]+$/.test(entry.participantIdentifier)
        ? `••••••${entry.participantIdentifier.replace(/\D/g, "").slice(-4)}` : "",
      correctCount: responses.filter((answer) => answer.isCorrect).length,
      incorrectUnansweredCount: responses.filter((answer) => !answer.isCorrect).length,
      elapsedMs: responses.reduce((total, answer) => total + (answer.elapsedMs ?? 0), 0),
    };
  });

  return NextResponse.json({
    game: {
      acceptedCount: game.acceptedCount,
      canStart: isCreator && Boolean(game.creatorRole) && game.acceptedCount >= 4,
      countdownDeadline: game.countdownDeadline,
      creatorRole: game.creatorRole ?? null,
      currentQuestion: question && (!rapid || isAccepted)
        ? { id: question.id, options: question.options, prompt: question.prompt }
        : null,
      currentQuestionIndex: game.currentQuestionIndex,
      displayName: participant?.label ?? actor.identifier,
      globalDeadline: game.globalDeadline,
      questionStartedAt: game.participantQuestionStartedAt,
      rulesVersion: game.rulesVersion,
      isAccepted,
      isCreator,
      isMissed,
      leaderboard: rapid
        ? standings.filter((entry, index) => isCreator || index < 10 || entry.isSelf)
        : game.leaderboard,
      overallGamePoints,
      ownAnswers: rapid && !completed ? ownAnswers.map((answer) => ({
        answeredAt: answer.answeredAt, kind: answer.kind, optionIndex: answer.optionIndex,
        participantIdentifier: answer.participantIdentifier, questionIndex: answer.questionIndex,
      })) : ownAnswers,
      participantCount: game.participants.length,
      participants: acceptedParticipants.map((entry) => ({
        acceptedAt: entry.acceptedAt,
        identifier: entry.identifier,
        label: entry.label,
      })),
      preparationDeadline: game.preparationDeadline,
      questionDeadline: game.questionDeadline,
      resultMetadata: {
        creatorName: creatorProfile?.label?.trim()
          || creatorParticipant?.label?.trim()
          || game.creatorIdentifier,
        groupName,
        poolName,
        startedAt: game.startedAt,
        completedAt: game.completedAt,
        durationMinutes: 10,
        submittedCount: acceptedParticipants.filter((entry) =>
          game.answers.filter((answer) => participantIdentifiersMatch(answer.participantIdentifier, entry.identifier)).length === GAME_QUESTION_COUNT).length,
        sharedCount: game.participants.filter((entry) =>
          !participantIdentifiersMatch(entry.identifier, game.creatorIdentifier) || game.creatorRole === "participant").length,
      },
      recentDeltas: rapid ? [] : game.answers.slice(-6).map((answer) => ({
        answeredAt: answer.answeredAt,
        participantIdentifier: answer.participantIdentifier,
        points: answer.points,
      })),
      reviewQuestions,
      rules: {
        correctPoints: GAME_CORRECT_POINTS,
        incorrectPoints: GAME_INCORRECT_POINTS,
        launchCountdownMs: game.rulesVersion === 2 || game.rulesVersion === 3 || rapid ? GAME_LAUNCH_COUNTDOWN_MS : 0,
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
