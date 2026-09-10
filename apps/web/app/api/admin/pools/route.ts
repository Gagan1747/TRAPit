import { getNormalUserCategoryDefinition } from "@trapit/auth";
import { participantIdentifiersMatch } from "@trapit/testing";
import { NextResponse } from "next/server";

import { getWorkspaceActor } from "../../../../lib/workspace-actor";
import { deletePool, listPoolsForActor, renamePool, updatePoolSharing } from "../../../../lib/testing-store";

function decoratePool<T extends { createdBy: string | null; sharedWithIdentifiers: string[] }>(
  pool: T,
  actor: { identifier: string | null; sub: string | null },
) {
  const canManage = Boolean(actor.sub && pool.createdBy === actor.sub);
  const isShared = Boolean(
    !canManage
    && actor.identifier
    && pool.sharedWithIdentifiers.some((identifier) =>
      participantIdentifiersMatch(identifier, actor.identifier as string),
    ),
  );

  return {
    ...pool,
    canManage,
    isShared,
  };
}

function getPoolCreationCapability(
  pools: Array<{ createdBy: string | null }>,
  actor: NonNullable<Awaited<ReturnType<typeof getWorkspaceActor>>>,
) {
  if (actor.role !== "user") {
    return { canCreate: true, limit: null, ownedCount: pools.length, reason: null };
  }

  const definition = getNormalUserCategoryDefinition(actor.userCategory);
  const ownedCount = pools.filter((pool) => pool.createdBy === actor.sub).length;
  const canCreate = ownedCount < definition.test.maxQuestionPools;

  return {
    canCreate,
    limit: definition.test.maxQuestionPools,
    ownedCount,
    reason: canCreate
      ? null
      : `Question pool limit reached (${ownedCount}/${definition.test.maxQuestionPools}).`,
  };
}

export async function GET() {
  const actor = await getWorkspaceActor();

  if (!actor) {
    return NextResponse.json({ error: "Signed-in access is required." }, { status: 403 });
  }

  const pools = await listPoolsForActor(actor.sub, actor.identifier);
  return NextResponse.json({
    creationCapability: getPoolCreationCapability(pools, actor),
    pools: pools.map((pool) => decoratePool(pool, actor)),
  });
}

export async function POST(request: Request) {
  const actor = await getWorkspaceActor();

  if (!actor) {
    return NextResponse.json({ error: "Signed-in access is required." }, { status: 403 });
  }

  void request;
  return NextResponse.json(
    { error: "Create a question pool while saving or importing at least one question." },
    { status: 400 },
  );
}

export async function PATCH(request: Request) {
  const actor = await getWorkspaceActor();

  if (!actor) {
    return NextResponse.json({ error: "Signed-in access is required." }, { status: 403 });
  }

  const body = (await request.json()) as {
    name?: string;
    poolId?: string;
    sharedWithIdentifiers?: string[];
  };

  if (!body.poolId?.trim()) {
    return NextResponse.json({ error: "Pool id is required." }, { status: 400 });
  }

  try {
    const pools = body.name !== undefined
      ? await renamePool({
          actorId: actor.sub,
          actorIdentifier: actor.identifier,
          name: body.name,
          poolId: body.poolId,
        })
      : await updatePoolSharing({
          actorId: actor.sub,
          actorIdentifier: actor.identifier,
          poolId: body.poolId,
          sharedWithIdentifiers: body.sharedWithIdentifiers ?? [],
        });

    console.info("trapit.audit", {
      action: body.name !== undefined ? "question-pool.renamed" : "question-pool.sharing-updated",
      actorSub: actor.sub,
      poolId: body.poolId,
      sharedIdentifierCount: body.sharedWithIdentifiers?.length ?? 0,
    });

    return NextResponse.json({
      creationCapability: getPoolCreationCapability(pools, actor),
      pools: pools.map((pool) => decoratePool(pool, actor)),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to update pool sharing." },
      { status: 400 },
    );
  }
}

export async function DELETE(request: Request) {
  const actor = await getWorkspaceActor();

  if (!actor) {
    return NextResponse.json({ error: "Signed-in access is required." }, { status: 403 });
  }

  const body = (await request.json()) as { poolId?: string };

  if (!body.poolId?.trim()) {
    return NextResponse.json({ error: "Pool id is required." }, { status: 400 });
  }

  try {
    const pools = await deletePool({
      actorId: actor.sub,
      actorIdentifier: actor.identifier,
      poolId: body.poolId,
    });

    return NextResponse.json({
      creationCapability: getPoolCreationCapability(pools, actor),
      pools: pools.map((pool) => decoratePool(pool, actor)),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to delete the pool." },
      { status: 400 },
    );
  }
}