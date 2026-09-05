import { getNormalUserCategoryDefinition } from "@trapit/auth";
import { participantIdentifiersMatch } from "@trapit/testing";
import { NextResponse } from "next/server";

import { getWorkspaceActor } from "../../../../lib/workspace-actor";
import { assertCanCreateQuestionPool } from "../../../../lib/user-category-limits";
import { createPool, listPoolsForActor, updatePoolSharing } from "../../../../lib/testing-store";

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

  try {
    const body = (await request.json()) as { description?: string; name?: string };

    if (!body.name?.trim()) {
      return NextResponse.json({ error: "Pool name is required." }, { status: 400 });
    }

    if (actor.role === "user") {
      const existingPools = await listPoolsForActor(actor.sub, actor.identifier);
      assertCanCreateQuestionPool(
        actor.userCategory,
        existingPools.filter((pool) => pool.createdBy === actor.sub).length,
      );
    }

    const pools = await createPool({
      createdBy: actor.sub,
      description: body.description,
      name: body.name,
    });

    console.info("trapit.audit", {
      action: "question-pool.created",
      actorSub: actor.sub,
      poolId: pools[0]?.id ?? null,
    });

    return NextResponse.json({
      creationCapability: getPoolCreationCapability(pools, actor),
      pools: pools.map((pool) => decoratePool(pool, actor)),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to create the pool." },
      { status: 400 },
    );
  }
}

export async function PATCH(request: Request) {
  const actor = await getWorkspaceActor();

  if (!actor) {
    return NextResponse.json({ error: "Signed-in access is required." }, { status: 403 });
  }

  const body = (await request.json()) as {
    poolId?: string;
    sharedWithIdentifiers?: string[];
  };

  if (!body.poolId?.trim()) {
    return NextResponse.json({ error: "Pool id is required." }, { status: 400 });
  }

  try {
    const pools = await updatePoolSharing({
      actorId: actor.sub,
      actorIdentifier: actor.identifier,
      poolId: body.poolId,
      sharedWithIdentifiers: body.sharedWithIdentifiers ?? [],
    });

    console.info("trapit.audit", {
      action: "question-pool.sharing-updated",
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