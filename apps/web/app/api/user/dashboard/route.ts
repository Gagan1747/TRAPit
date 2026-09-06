import { getGameQuestionDurationMs, participantIdentifiersMatch } from "@trapit/testing";
import { NextResponse } from "next/server";

import { getUserActor } from "../../../../lib/user-api";
import {
  getOverallGamePoints,
  listGamesForParticipant,
  listAvailablePollsForParticipant,
  listAvailableTestsForParticipant,
  listGroupJoinRequestsForUser,
  listUserHistory,
  getWorkspaceData,
} from "../../../../lib/testing-store";

export async function GET(request: Request) {
  const actor = await getUserActor(request);

  if (!actor) {
    return NextResponse.json({ error: "User access is required." }, { status: 403 });
  }

  try {
    const [availableGames, availablePolls, availableTests, groupJoinRequests, history, overallGamePoints, workspace] = await Promise.all([
      listGamesForParticipant(actor.identifier),
      listAvailablePollsForParticipant(actor.identifier),
      listAvailableTestsForParticipant(actor.identifier),
      listGroupJoinRequestsForUser(actor.identifier),
      listUserHistory(actor.identifier),
      getOverallGamePoints(actor.identifier),
      getWorkspaceData(),
    ]);

    return NextResponse.json({
      availableGames: availableGames.map((game) => {
        const participant = game.participants.find((entry) =>
          participantIdentifiersMatch(entry.identifier, actor.identifier),
        );
        const isAccepted = Boolean(participant?.acceptedAt);
        const isCreator = participantIdentifiersMatch(game.creatorIdentifier, actor.identifier);
        const isMissed = game.status === "completed"
          && !isAccepted
          && !(isCreator && game.creatorRole === "spectator");

        return {
          acceptedCount: game.acceptedCount,
          completedAt: game.completedAt,
          countdownDeadline: game.countdownDeadline,
          createdAt: game.createdAt,
          creatorIdentifier: game.creatorIdentifier,
          creatorRole: game.creatorRole ?? null,
          displayStatus: game.status === "upcoming"
            ? "Upcoming"
            : game.status === "completed"
              ? (isMissed ? "Missed" : "Completed")
              : "In Progress",
          id: game.id,
          isAccepted,
          isCreator,
          isMissed,
          leaderboard: game.status === "completed" ? game.leaderboard : [],
          participantCount: game.participants.length,
          participantGroupId: game.participantGroupId,
          groupName: workspace.participantGroups.find((group) => group.id === game.participantGroupId)?.name ?? "Unknown group",
          participants: game.participants.map((gameParticipant) => ({
            accepted: Boolean(gameParticipant.acceptedAt),
            identifier: gameParticipant.identifier,
            label: gameParticipant.label,
          })),
          poolId: game.poolId,
          poolName: workspace.pools.find((pool) => pool.id === game.poolId)?.name ?? "Unknown pool",
          questionDurationMs: getGameQuestionDurationMs(game),
          questionDeadline: game.questionDeadline,
          startedAt: game.startedAt,
          status: game.status,
          title: game.title,
          updatedAt: game.updatedAt,
        };
      }),
      availablePolls,
      availableTests,
      groupJoinRequests,
      history,
      identifier: actor.identifier,
      overallGamePoints,
      usingFallbackIdentifier: actor.usingFallbackIdentifier,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to load the dashboard." },
      { status: 500 },
    );
  }
}