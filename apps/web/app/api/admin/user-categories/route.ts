import { NextResponse } from "next/server";
import { defaultNormalUserCategory, normalUserCategoryLabels, type NormalUserCategory } from "@trapit/auth";

import { isWebAuthConfigured } from "../../../../lib/auth-config";
import { listRegisteredDirectoryUsers } from "../../../../lib/cognito";
import { listParticipants } from "../../../../lib/testing-store";
import { getSuperAdminActor } from "../../../../lib/workspace-actor";
import {
  assignUserCategory,
  listUserCategoryManagementState,
  resolveUserCategoryUpgradeRequest,
} from "../../../../lib/user-category-store";

type UserCategoryAdminBody =
  | {
      decision?: "accept" | "reject";
      durationMonths?: 3 | 12;
      mode?: "resolve-request";
      requestId?: string;
    }
  | {
      category?: NormalUserCategory;
      durationMonths?: 3 | 12;
      mode?: "assign-category";
      userIdentifier?: string;
      userSub?: string | null;
    };

async function buildManagementResponse() {
  const [managementState, fallbackParticipants] = await Promise.all([
    listUserCategoryManagementState(),
    listParticipants(),
  ]);

  const fallbackCreatedAtByIdentifier = new Map(
    fallbackParticipants.map((participant) => [participant.identifier.trim().toLowerCase(), participant.createdAt]),
  );

  let directoryUsers = fallbackParticipants.map((participant) => ({
    createdAt: (participant.createdAt ?? null) as string | null,
    identifier: participant.identifier,
    label: participant.label,
    sub: null as string | null,
  }));

  if (isWebAuthConfigured()) {
    try {
      const cognitoUsers = await listRegisteredDirectoryUsers();
      directoryUsers = cognitoUsers.map((user) => ({
        createdAt: user.createdAt ?? fallbackCreatedAtByIdentifier.get(user.identifier.trim().toLowerCase()) ?? null,
        identifier: user.identifier,
        label: user.label,
        sub: user.sub,
      }));
    } catch {
      directoryUsers = fallbackParticipants.map((participant) => ({
        createdAt: participant.createdAt ?? null,
        identifier: participant.identifier,
        label: participant.label,
        sub: null,
      }));
    }
  }

  const pendingRequestsByIdentifier = new Map(
    managementState.requests
      .filter((request) => request.status === "pending" && request.requesterIdentifier)
      .map((request) => [request.requesterIdentifier?.trim().toLowerCase() ?? "", request]),
  );
  const activeAssignmentsByIdentifier = new Map(
    managementState.activeAssignments
      .filter((assignment) => assignment.userIdentifier)
      .map((assignment) => [assignment.userIdentifier?.trim().toLowerCase() ?? "", assignment]),
  );

  const knownUsers = new Map<string, { createdAt: string | null; identifier: string; label: string | null; sub: string | null }>();

  for (const user of directoryUsers) {
    knownUsers.set(user.identifier.trim().toLowerCase(), {
      createdAt: user.createdAt ?? null,
      identifier: user.identifier,
      label: user.label,
      sub: user.sub,
    });
  }

  for (const request of managementState.requests) {
    if (!request.requesterIdentifier?.trim()) {
      continue;
    }

    const normalizedIdentifier = request.requesterIdentifier.trim().toLowerCase();
    const existing = knownUsers.get(normalizedIdentifier);
    knownUsers.set(normalizedIdentifier, {
      createdAt: existing?.createdAt ?? fallbackCreatedAtByIdentifier.get(normalizedIdentifier) ?? request.requestedAt ?? null,
      identifier: request.requesterIdentifier,
      label: existing?.label ?? request.requesterDisplayName,
      sub: existing?.sub ?? request.requesterSub,
    });
  }

  for (const assignment of managementState.activeAssignments) {
    if (!assignment.userIdentifier?.trim()) {
      continue;
    }

    const normalizedIdentifier = assignment.userIdentifier.trim().toLowerCase();
    const existing = knownUsers.get(normalizedIdentifier);

    knownUsers.set(normalizedIdentifier, {
      createdAt: existing?.createdAt ?? fallbackCreatedAtByIdentifier.get(normalizedIdentifier) ?? assignment.assignedAt ?? null,
      identifier: assignment.userIdentifier,
      label: existing?.label ?? null,
      sub: existing?.sub ?? assignment.userSub,
    });
  }

  const tierPriority: Record<NormalUserCategory, number> = {
    "trapit-pro-max": 0,
    "trapit-pro": 1,
    "trapit-normal": 2,
  };

  const managedUsers = Array.from(knownUsers.values())
    .map((user) => {
      const normalizedIdentifier = user.identifier.trim().toLowerCase();
      const activeAssignment = activeAssignmentsByIdentifier.get(normalizedIdentifier) ?? null;
      const pendingRequest = pendingRequestsByIdentifier.get(normalizedIdentifier) ?? null;
      const currentCategory = activeAssignment?.category ?? defaultNormalUserCategory;
      const expiresAt = activeAssignment?.expiresAt ?? null;
      const daysRemaining = currentCategory !== defaultNormalUserCategory && expiresAt
        ? Math.max(0, Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 86_400_000))
        : null;

      return {
        currentCategory,
        currentCategoryLabel: normalUserCategoryLabels[currentCategory],
        daysRemaining,
        displayName: user.label ?? pendingRequest?.requesterDisplayName ?? null,
        expiresAt,
        identifier: user.identifier,
        joinedAt: user.createdAt,
        pendingRequest,
        userSub: activeAssignment?.userSub ?? user.sub,
      };
    })
    .sort((leftUser, rightUser) => {
      const tierDiff = tierPriority[leftUser.currentCategory] - tierPriority[rightUser.currentCategory];
      if (tierDiff !== 0) {
        return tierDiff;
      }
      const leftJoinedMs = leftUser.joinedAt ? new Date(leftUser.joinedAt).getTime() : 0;
      const rightJoinedMs = rightUser.joinedAt ? new Date(rightUser.joinedAt).getTime() : 0;
      if (rightJoinedMs !== leftJoinedMs) {
        return rightJoinedMs - leftJoinedMs;
      }
      return leftUser.identifier.localeCompare(rightUser.identifier);
    });

  return {
    managedUsers,
    requests: managementState.requests,
  };
}

export async function GET(request: Request) {
  const actor = await getSuperAdminActor(request);

  if (!actor) {
    return NextResponse.json({ error: "Super admin access is required." }, { status: 403 });
  }

  return NextResponse.json(await buildManagementResponse());
}

export async function POST(request: Request) {
  const actor = await getSuperAdminActor(request);

  if (!actor) {
    return NextResponse.json({ error: "Super admin access is required." }, { status: 403 });
  }

  const body = (await request.json()) as UserCategoryAdminBody;

  try {
    if (body.mode === "resolve-request") {
      if (!body.requestId?.trim() || !body.decision) {
        return NextResponse.json({ error: "Request id and decision are required." }, { status: 400 });
      }

      await resolveUserCategoryUpgradeRequest({
        decision: body.decision,
        durationMonths: body.decision === "accept" ? body.durationMonths ?? null : null,
        requestId: body.requestId,
        reviewerDisplayName: actor.displayName,
        reviewerIdentifier: actor.identifier,
      });

      return NextResponse.json(await buildManagementResponse());
    }

    if (body.mode === "assign-category") {
      if (!body.userIdentifier?.trim()) {
        return NextResponse.json({ error: "User identifier is required." }, { status: 400 });
      }

      if (!body.category) {
        return NextResponse.json({ error: "Select a category." }, { status: 400 });
      }

      await assignUserCategory({
        assignedByDisplayName: actor.displayName,
        assignedByIdentifier: actor.identifier,
        category: body.category,
        durationMonths: body.category === defaultNormalUserCategory ? null : body.durationMonths ?? null,
        reason: "manual",
        userIdentifier: body.userIdentifier,
        userSub: body.userSub ?? null,
      });

      return NextResponse.json(await buildManagementResponse());
    }
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to update user categories." },
      { status: 400 },
    );
  }

  return NextResponse.json({ error: "A supported category action is required." }, { status: 400 });
}