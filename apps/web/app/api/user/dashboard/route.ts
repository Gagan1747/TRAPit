import { NextResponse } from "next/server";

import { getUserActor } from "../../../../lib/user-api";
import {
  getOverallGamePoints,
  listGamesForParticipant,
  listAvailablePollsForParticipant,
  listAvailableTestsForParticipant,
  listGroupJoinRequestsForUser,
  listUserHistory,
} from "../../../../lib/testing-store";

export async function GET(request: Request) {
  const actor = await getUserActor(request);

  if (!actor) {
    return NextResponse.json({ error: "User access is required." }, { status: 403 });
  }

  try {
    const [availableGames, availablePolls, availableTests, groupJoinRequests, history, overallGamePoints] = await Promise.all([
      listGamesForParticipant(actor.identifier),
      listAvailablePollsForParticipant(actor.identifier),
      listAvailableTestsForParticipant(actor.identifier),
      listGroupJoinRequestsForUser(actor.identifier),
      listUserHistory(actor.identifier),
      getOverallGamePoints(actor.identifier),
    ]);

    return NextResponse.json({
      availableGames: availableGames.map((game) => ({
        acceptedCount: game.acceptedCount,
        completedAt: game.completedAt,
        createdAt: game.createdAt,
        creatorIdentifier: game.creatorIdentifier,
        id: game.id,
        leaderboard: game.status === "completed" ? game.leaderboard : [],
        participantCount: game.participants.length,
        participantGroupId: game.participantGroupId,
        participants: game.participants.map((participant) => ({
          accepted: Boolean(participant.acceptedAt),
          identifier: participant.identifier,
          label: participant.label,
        })),
        poolId: game.poolId,
        startedAt: game.startedAt,
        status: game.status,
        title: game.title,
        updatedAt: game.updatedAt,
      })),
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