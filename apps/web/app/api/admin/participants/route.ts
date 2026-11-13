import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

import { getWorkspaceActor } from "../../../../lib/workspace-actor";
import { isWebAuthConfigured } from "../../../../lib/auth-config";
import { listRegisteredDirectoryUsers } from "../../../../lib/cognito";
import { getPayoutAccountForUser } from "../../../../lib/payout-store";
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
  recordGroupMonthlyPayment,
  removeGroupMember,
  resolveGroupJoinRequest,
  syncParticipants,
  toggleGroupAttendanceTracking,
  toggleGroupMemberAdmin,
  toggleGroupPaymentTracking,
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
      enabled?: boolean;
      groupId?: string;
      mode?: "toggle-group-attendance-tracking";
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
    }
  | {
      enabled?: boolean;
      groupId?: string;
      mode?: "toggle-group-payment-tracking";
      monthlyPaymentAmountInr?: number | null;
    }
  | {
      groupId?: string;
      membershipId?: string;
      mode?: "create-group-payment-order";
      monthKey?: string;
    }
  | {
      groupId?: string;
      membershipId?: string;
      mode?: "verify-group-payment";
      monthKey?: string;
      razorpayOrderId?: string;
      razorpayPaymentId?: string;
      razorpaySignature?: string;
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

let lastDirectorySyncMs = 0;
const DIRECTORY_SYNC_TTL_MS = 120_000;

export async function GET() {
  const actor = await getWorkspaceActor();

  if (!actor) {
    return NextResponse.json({ error: "Signed-in access is required." }, { status: 403 });
  }

  let syncedParticipants: Awaited<ReturnType<typeof listParticipants>> | undefined;

  if (isWebAuthConfigured() && Date.now() - lastDirectorySyncMs > DIRECTORY_SYNC_TTL_MS) {
    try {
      const directoryUsers = await listRegisteredDirectoryUsers();
      syncedParticipants = await syncParticipants(directoryUsers);
      lastDirectorySyncMs = Date.now();
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

    if (body.mode === "toggle-group-attendance-tracking") {
      if (!body.groupId?.trim()) {
        return NextResponse.json({ error: "Group id is required." }, { status: 400 });
      }

      if (!actor.identifier) {
        return NextResponse.json({ error: "Owner identifier is required." }, { status: 400 });
      }

      await toggleGroupAttendanceTracking({
        enabled: body.enabled,
        groupId: body.groupId,
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

    if (body.mode === "toggle-group-payment-tracking") {
      if (!body.groupId?.trim()) {
        return NextResponse.json({ error: "Group id is required." }, { status: 400 });
      }

      if (!actor.identifier) {
        return NextResponse.json({ error: "Owner identifier is required." }, { status: 400 });
      }

      if (body.enabled !== false && !actor.isSuperAdmin && actor.userCategory === "trapit-normal") {
        return NextResponse.json(
          { error: "Pro or Pro Max membership is required to enable group payments." },
          { status: 403 },
        );
      }

      await toggleGroupPaymentTracking({
        enabled: body.enabled,
        groupId: body.groupId,
        monthlyPaymentAmountInr: body.monthlyPaymentAmountInr,
        ownerIdentifier: actor.identifier,
      });

      return NextResponse.json(await buildParticipantsPayload(actor.identifier));
    }

    if (body.mode === "create-group-payment-order") {
      const groupId = body.groupId?.trim() ?? "";
      const monthKey = body.monthKey?.trim() ?? "";
      if (!groupId || !/^\d{4}-\d{2}$/.test(monthKey)) {
        return NextResponse.json({ error: "Group id and valid month (YYYY-MM) are required." }, { status: 400 });
      }
      if (!actor.identifier) {
        return NextResponse.json({ error: "User identifier is required." }, { status: 400 });
      }

      const allGroups = await listParticipantGroups();
      const group = allGroups.find((entry) => entry.id === groupId);
      if (!group || !group.paymentTrackingEnabled || !group.monthlyPaymentAmountInr || group.monthlyPaymentAmountInr <= 0) {
        return NextResponse.json({ error: "This group does not have monthly payments enabled." }, { status: 400 });
      }

      const keyId = process.env.RAZORPAY_KEY_ID?.trim() || process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID?.trim() || "";
      const keySecret = process.env.RAZORPAY_KEY_SECRET?.trim() || "";
      if (!keyId || !keySecret) {
        return NextResponse.json(
          { error: "Razorpay payment gateway is not configured yet. Please set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET." },
          { status: 503 },
        );
      }

      const amountPaise = Math.round(group.monthlyPaymentAmountInr * 100);
      const creatorPayoutAccount = group.ownerIdentifier
        ? await getPayoutAccountForUser({ userIdentifier: group.ownerIdentifier })
        : null;
      const receipt = `grp_${group.id.slice(-8)}_${monthKey}_${Date.now()}`.slice(0, 40);
      const authHeader = Buffer.from(`${keyId}:${keySecret}`).toString("base64");

      const baseOrderBody: Record<string, unknown> = {
        amount: amountPaise,
        currency: "INR",
        notes: {
          groupId: group.id,
          groupName: group.name,
          memberIdentifier: actor.identifier,
          monthKey,
          ownerIdentifier: group.ownerIdentifier ?? "",
          ...(creatorPayoutAccount?.linkedAccountId ? { linkedAccountId: creatorPayoutAccount.linkedAccountId } : {}),
        },
        receipt,
      };

      let orderResponse = await fetch("https://api.razorpay.com/v1/orders", {
        method: "POST",
        headers: {
          Authorization: `Basic ${authHeader}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(
          creatorPayoutAccount?.linkedAccountId
            ? {
                ...baseOrderBody,
                transfers: [
                  {
                    account: creatorPayoutAccount.linkedAccountId,
                    amount: amountPaise,
                    currency: "INR",
                    on_hold: 0,
                  },
                ],
              }
            : baseOrderBody,
        ),
      });

      // Fallback if Route transfer on order creation is not enabled on a test key
      if (!orderResponse.ok && creatorPayoutAccount?.linkedAccountId) {
        orderResponse = await fetch("https://api.razorpay.com/v1/orders", {
          method: "POST",
          headers: {
            Authorization: `Basic ${authHeader}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(baseOrderBody),
        });
      }

      const orderPayload = (await orderResponse.json().catch(() => ({}))) as {
        amount?: number;
        currency?: string;
        error?: { description?: string };
        id?: string;
      };

      if (!orderResponse.ok || !orderPayload.id) {
        return NextResponse.json(
          { error: orderPayload.error?.description || "Unable to initialize Razorpay payment order." },
          { status: 502 },
        );
      }

      return NextResponse.json({
        amount: orderPayload.amount ?? amountPaise,
        amountInr: group.monthlyPaymentAmountInr,
        currency: orderPayload.currency ?? "INR",
        groupId: group.id,
        groupName: group.name,
        keyId,
        linkedAccountId: creatorPayoutAccount?.linkedAccountId ?? null,
        monthKey,
        orderId: orderPayload.id,
      });
    }

    if (body.mode === "verify-group-payment") {
      const groupId = body.groupId?.trim() ?? "";
      const monthKey = body.monthKey?.trim() ?? "";
      const orderId = body.razorpayOrderId?.trim() ?? "";
      const paymentId = body.razorpayPaymentId?.trim() ?? "";
      const signature = body.razorpaySignature?.trim() ?? "";

      if (!groupId || !/^\d{4}-\d{2}$/.test(monthKey) || !orderId || !paymentId || !signature) {
        return NextResponse.json({ error: "Complete payment verification details are required." }, { status: 400 });
      }
      if (!actor.identifier) {
        return NextResponse.json({ error: "User identifier is required." }, { status: 400 });
      }

      const keySecret = process.env.RAZORPAY_KEY_SECRET?.trim() || "";
      if (!keySecret) {
        return NextResponse.json({ error: "Razorpay payment gateway is not configured." }, { status: 503 });
      }

      const expectedSignature = createHmac("sha256", keySecret)
        .update(`${orderId}|${paymentId}`)
        .digest("hex");
      const expectedBuffer = Buffer.from(expectedSignature, "utf8");
      const actualBuffer = Buffer.from(signature, "utf8");
      if (expectedBuffer.length !== actualBuffer.length || !timingSafeEqual(expectedBuffer, actualBuffer)) {
        return NextResponse.json({ error: "Payment signature verification failed." }, { status: 400 });
      }

      const allGroups = await listParticipantGroups();
      const group = allGroups.find((entry) => entry.id === groupId);
      const amountInr = group?.monthlyPaymentAmountInr ?? 0;
      if (!group || amountInr <= 0) {
        return NextResponse.json({ error: "Group payment configuration not found." }, { status: 400 });
      }

      await recordGroupMonthlyPayment({
        amountInr,
        groupId: group.id,
        memberIdentifier: actor.identifier,
        membershipId: body.membershipId,
        monthKey,
        orderId,
        paymentId,
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