import { NextResponse } from "next/server";

import { getWorkspaceActor } from "../../../../lib/workspace-actor";
import { isWebAuthConfigured } from "../../../../lib/auth-config";
import { listRegisteredDirectoryUsers } from "../../../../lib/cognito";
import { assertCanCreateGroup, assertCanManageGroup } from "../../../../lib/user-category-limits";
import {
  addGroupMemberDirect,
  createGroup,
  createParticipant,
  declareGroupIntroducingAdmin,
  leaveParticipantGroup,
  listGroupJoinRequestsForAdmin,
  listGroupMembershipsForActor,
  listParticipantGroupsForOwner,
  listParticipantGroups,
  listParticipants,
  markGroupMemberAttendance,
  removeGroupMember,
  resolveGroupJoinRequest,
  syncParticipants,
  toggleGroupMemberAdmin,
  updateGroup,
} from "../../../../lib/testing-store";

type ParticipantBody =
  | {
      identifier?: string;
      label?: string;
      mode?: "create-participant";
    }
  | {
      decision?: "accept" | "reject";
      mode?: "resolve-request";
      requestId?: string;
    }
  | {
      description?: string;
      generateInviteLink?: boolean;
      inviteJoinMode?: "approval-required" | "automatic";
      mode?: "create-group";
      name?: string;
      participantIds?: string[];
    }
  | {
      generateInviteLink?: boolean;
      groupId?: string;
      inviteJoinMode?: "approval-required" | "automatic";
      mode?: "update-group";
      name?: string;
      participantIds?: string[];
    }
  | {
      groupId?: string;
      mode?: "add-group-member";
      targetIdentifier?: string;
      targetLabel?: string;
    }
  | {
      groupId?: string;
      memberIdentifier?: string;
      membershipId?: string;
      mode?: "remove-group-member";
    }
  | {
      groupId?: string;
      membershipId?: string;
      mode?: "leave-group";
    }
  | {
      groupId?: string;
      memberIdentifier?: string;
      mode?: "toggle-group-admin";
    }
  | {
      dateKey?: string;
      groupId?: string;
      memberIdentifier?: string;
      membershipId?: string;
      mode?: "mark-group-attendance";
      status?: "present" | "absent" | null;
    }
  | {
      adminPhoneNumber?: string;
      groupId?: string;
      membershipId?: string;
      mode?: "declare-group-admin";
    };

function isCreateGroupBody(
  body: ParticipantBody,
): body is Extract<ParticipantBody, { mode?: "create-group" }> {
  return body.mode === "create-group";
}

function isUpdateGroupBody(
  body: ParticipantBody,
): body is Extract<ParticipantBody, { mode?: "update-group" }> {
  return body.mode === "update-group";
}

function isAddGroupMemberBody(
  body: ParticipantBody,
): body is Extract<ParticipantBody, { mode?: "add-group-member" }> {
  return body.mode === "add-group-member";
}

function isRemoveGroupMemberBody(
  body: ParticipantBody,
): body is Extract<ParticipantBody, { mode?: "remove-group-member" }> {
  return body.mode === "remove-group-member";
}

function isResolveRequestBody(
  body: ParticipantBody,
): body is Extract<ParticipantBody, { mode?: "resolve-request" }> {
  return body.mode === "resolve-request";
}

function isLeaveGroupBody(
  body: ParticipantBody,
): body is Extract<ParticipantBody, { mode?: "leave-group" }> {
  return body.mode === "leave-group";
}

async function buildParticipantsPayload(actorIdentifier: string | null, participantsOverride?: Awaited<ReturnType<typeof listParticipants>>) {
  const [participants, participantGroups, groupJoinRequests, memberships] = await Promise.all([
    participantsOverride ? Promise.resolve(participantsOverride) : listParticipants(),
    actorIdentifier
      ? listParticipantGroupsForOwner(actorIdentifier, { includeUnowned: true })
      : listParticipantGroups(),
    actorIdentifier ? listGroupJoinRequestsForAdmin(actorIdentifier) : Promise.resolve([]),
    actorIdentifier
      ? listGroupMembershipsForActor(actorIdentifier)
      : Promise.resolve({ joinedGroupMemberships: [], ownedGroupMemberships: [] }),
  ]);

  return {
    groupJoinRequests,
    joinedGroupMemberships: memberships.joinedGroupMemberships,
    ownedGroupMemberships: memberships.ownedGroupMemberships,
    participantGroups,
    participants,
  };
}

export async function GET() {
  const actor = await getWorkspaceActor();

  if (!actor) {
    return NextResponse.json({ error: "Signed-in access is required." }, { status: 403 });
  }

  let syncedParticipants: Awaited<ReturnType<typeof listParticipants>> | undefined;

  if (isWebAuthConfigured()) {
    try {
      const directoryUsers = await listRegisteredDirectoryUsers();
      syncedParticipants = await syncParticipants(directoryUsers);
    } catch {
      syncedParticipants = undefined;
    }
  }

  return NextResponse.json(await buildParticipantsPayload(actor.identifier, syncedParticipants));
}

export async function POST(request: Request) {
  const actor = await getWorkspaceActor();

  if (!actor) {
    return NextResponse.json({ error: "Signed-in access is required." }, { status: 403 });
  }

  try {
    const body = (await request.json()) as ParticipantBody;

    if (isCreateGroupBody(body)) {
      if (actor.role === "user") {
        assertCanCreateGroup(actor.userCategory);
      }

      await createGroup({
        description: body.description,
        generateInviteLink: body.generateInviteLink ?? true,
        inviteJoinMode: "approval-required",
        name: body.name ?? "",
        ownerLabel: actor.displayName,
        ownerIdentifier: actor.identifier,
        participantIds: body.participantIds ?? [],
      });

      return NextResponse.json(await buildParticipantsPayload(actor.identifier));
    }

    if (isUpdateGroupBody(body)) {
      if (actor.role === "user") {
        assertCanManageGroup(actor.userCategory);
      }

      if (!body.groupId?.trim()) {
        return NextResponse.json({ error: "Group id is required." }, { status: 400 });
      }

      await updateGroup({
        generateInviteLink: body.generateInviteLink ?? true,
        groupId: body.groupId,
        inviteJoinMode: "approval-required",
        name: body.name ?? "",
        ownerLabel: actor.displayName,
        ownerIdentifier: actor.identifier,
        participantIds: body.participantIds,
      });

      return NextResponse.json(await buildParticipantsPayload(actor.identifier));
    }

    if (isAddGroupMemberBody(body)) {
      if (actor.role === "user") {
        assertCanManageGroup(actor.userCategory);
      }

      if (!body.groupId?.trim() || !body.targetIdentifier?.trim()) {
        return NextResponse.json({ error: "Group id and participant are required." }, { status: 400 });
      }

      if (!actor.identifier) {
        return NextResponse.json({ error: "Owner identifier is required." }, { status: 400 });
      }

      await addGroupMemberDirect({
        groupId: body.groupId,
        ownerIdentifier: actor.identifier,
        ownerLabel: actor.displayName,
        targetIdentifier: body.targetIdentifier,
        targetLabel: body.targetLabel,
      });

      return NextResponse.json(await buildParticipantsPayload(actor.identifier));
    }

    if (isRemoveGroupMemberBody(body)) {
      if (actor.role === "user") {
        assertCanManageGroup(actor.userCategory);
      }

      if (!body.groupId?.trim() || !body.memberIdentifier?.trim()) {
        return NextResponse.json({ error: "Group id and member identifier are required." }, { status: 400 });
      }

      if (!actor.identifier) {
        return NextResponse.json({ error: "Owner identifier is required." }, { status: 400 });
      }

      await removeGroupMember({
        groupId: body.groupId,
        memberIdentifier: body.memberIdentifier,
        membershipId: body.membershipId,
        ownerIdentifier: actor.identifier,
      });

      return NextResponse.json(await buildParticipantsPayload(actor.identifier));
    }

    if (isResolveRequestBody(body)) {
      if (actor.role === "user") {
        assertCanManageGroup(actor.userCategory);
      }

      if (!body.requestId?.trim() || !body.decision) {
        return NextResponse.json(
          { error: "Request id and decision are required." },
          { status: 400 },
        );
      }

      if (!actor.identifier) {
        return NextResponse.json(
          { error: "Admin identifier is required to manage requests." },
          { status: 400 },
        );
      }

      const payload = await resolveGroupJoinRequest({
        adminIdentifier: actor.identifier,
        decision: body.decision,
        requestId: body.requestId,
      });
      const memberships = await listGroupMembershipsForActor(actor.identifier);

      return NextResponse.json({
        ...payload,
        joinedGroupMemberships: memberships.joinedGroupMemberships,
        ownedGroupMemberships: memberships.ownedGroupMemberships,
      });
    }

    if (isLeaveGroupBody(body)) {
      if (!body.groupId?.trim()) {
        return NextResponse.json({ error: "Group id is required." }, { status: 400 });
      }

      if (!actor.identifier) {
        return NextResponse.json({ error: "User identifier is required to leave a group." }, { status: 400 });
      }

      await leaveParticipantGroup({
        groupId: body.groupId,
        membershipId: body.membershipId,
        userIdentifier: actor.identifier,
      });

      return NextResponse.json(await buildParticipantsPayload(actor.identifier));
    }

    if (body.mode === "toggle-group-admin") {
      if (!body.groupId?.trim() || !body.memberIdentifier?.trim()) {
        return NextResponse.json({ error: "Group id and member identifier are required." }, { status: 400 });
      }

      if (!actor.identifier) {
        return NextResponse.json({ error: "Owner identifier is required." }, { status: 400 });
      }

      await toggleGroupMemberAdmin({
        groupId: body.groupId,
        memberIdentifier: body.memberIdentifier,
        ownerIdentifier: actor.identifier,
      });

      return NextResponse.json(await buildParticipantsPayload(actor.identifier));
    }

    if (body.mode === "mark-group-attendance") {
      if (!body.groupId?.trim() || !body.memberIdentifier?.trim() || !body.dateKey?.trim()) {
        return NextResponse.json({ error: "Group id, member identifier, and date are required." }, { status: 400 });
      }

      if (!actor.identifier) {
        return NextResponse.json({ error: "Owner identifier is required." }, { status: 400 });
      }

      await markGroupMemberAttendance({
        dateKey: body.dateKey,
        groupId: body.groupId,
        memberIdentifier: body.memberIdentifier,
        membershipId: body.membershipId,
        ownerIdentifier: actor.identifier,
        status: body.status ?? null,
      });

      return NextResponse.json(await buildParticipantsPayload(actor.identifier));
    }

    if (body.mode === "declare-group-admin") {
      if (!body.groupId?.trim() || !body.adminPhoneNumber?.trim()) {
        return NextResponse.json({ error: "Group id and complete admin phone number are required." }, { status: 400 });
      }

      if (!actor.identifier) {
        return NextResponse.json({ error: "User identifier is required." }, { status: 400 });
      }

      await declareGroupIntroducingAdmin({
        adminPhoneNumber: body.adminPhoneNumber,
        groupId: body.groupId,
        memberIdentifier: actor.identifier,
        membershipId: body.membershipId,
      });

      return NextResponse.json(await buildParticipantsPayload(actor.identifier));
    }

    if (!("identifier" in body) || !body.identifier?.trim()) {
      return NextResponse.json({ error: "Participant identifier is required." }, { status: 400 });
    }

    if (actor.role !== "admin" && !actor.isSuperAdmin) {
      return NextResponse.json({ error: "Participant creation is only available to admins." }, { status: 403 });
    }

    await createParticipant({
      identifier: body.identifier,
      label: body.label,
    });

    return NextResponse.json(await buildParticipantsPayload(actor.identifier));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to update participants." },
      { status: 400 },
    );
  }
}