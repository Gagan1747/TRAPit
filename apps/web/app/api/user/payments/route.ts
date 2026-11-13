import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";

import { getPayoutAccountForUser, saveLinkedAccountIdForUser } from "../../../../lib/payout-store";
import { getWorkspaceActor } from "../../../../lib/workspace-actor";

function getRazorpayCredentials() {
  const keyId = process.env.RAZORPAY_KEY_ID?.trim() || process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID?.trim() || "";
  const keySecret = process.env.RAZORPAY_KEY_SECRET?.trim() || "";
  const onboardingPortalUrl = process.env.RAZORPAY_ONBOARDING_PORTAL_URL?.trim() || "https://dashboard.razorpay.com/app/route/accounts";
  return {
    configured: Boolean(keyId && keySecret),
    keyId,
    keySecret,
    onboardingPortalUrl,
  };
}

function generateDeterministicLinkedAccountId() {
  const chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
  const bytes = randomBytes(14);
  let suffix = "";
  for (let i = 0; i < 14; i += 1) {
    suffix += chars[bytes[i]! % chars.length];
  }
  return `acc_${suffix}`;
}

export async function GET(request: Request) {
  const actor = await getWorkspaceActor(request);
  if (!actor) {
    return NextResponse.json({ error: "Signed-in access is required." }, { status: 403 });
  }

  const payoutAccount = await getPayoutAccountForUser({
    userIdentifier: actor.identifier,
    userSub: actor.sub,
  });

  return NextResponse.json({
    payoutAccount,
    razorpayConfigured: getRazorpayCredentials().configured,
  });
}

export async function POST(request: Request) {
  const actor = await getWorkspaceActor(request);
  if (!actor) {
    return NextResponse.json({ error: "Signed-in access is required." }, { status: 403 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    action?: "initiate-onboarding" | "complete-onboarding";
    linkedAccountId?: string;
  };

  if (body.action === "complete-onboarding") {
    const existing = await getPayoutAccountForUser({
      userIdentifier: actor.identifier,
      userSub: actor.sub,
    });
    const candidateId = body.linkedAccountId?.trim() || existing?.linkedAccountId || "";
    if (!candidateId) {
      return NextResponse.json({ error: "Initiate Razorpay account onboarding first." }, { status: 400 });
    }

    const credentials = getRazorpayCredentials();
    let verifiedStatus: "onboarding" | "verified" = "verified";

    if (credentials.configured) {
      const authHeader = Buffer.from(`${credentials.keyId}:${credentials.keySecret}`).toString("base64");
      const accountResponse = await fetch(`https://api.razorpay.com/v2/accounts/${encodeURIComponent(candidateId)}`, {
        headers: {
          Authorization: `Basic ${authHeader}`,
          Accept: "application/json",
        },
        method: "GET",
      }).catch(() => null);

      if (accountResponse?.ok) {
        const accountPayload = (await accountResponse.json().catch(() => ({}))) as {
          id?: string;
          status?: string;
        };
        if (accountPayload.status && accountPayload.status.toLowerCase() === "created") {
          verifiedStatus = "verified";
        }
      }
    }

    const payoutAccount = await saveLinkedAccountIdForUser({
      linkedAccountId: candidateId,
      status: verifiedStatus,
      userIdentifier: actor.identifier,
      userSub: actor.sub,
    });

    return NextResponse.json({ payoutAccount });
  }

  if (body.action === "initiate-onboarding") {
    const credentials = getRazorpayCredentials();
    const existing = await getPayoutAccountForUser({
      userIdentifier: actor.identifier,
      userSub: actor.sub,
    });

    let linkedAccountId = existing?.linkedAccountId ?? "";
    let onboardingUrl = "";

    if (credentials.configured) {
      const authHeader = Buffer.from(`${credentials.keyId}:${credentials.keySecret}`).toString("base64");
      const digits = (actor.identifier ?? "").replace(/\D/g, "");
      const phone = digits.length >= 10 ? digits.slice(-10) : "9999999999";
      const email = `${phone}@trapit.in`;
      const legalBusinessName = actor.displayName?.trim() || "TRAPit Peer Account";

      const createResponse = await fetch("https://api.razorpay.com/v2/accounts", {
        method: "POST",
        headers: {
          Authorization: `Basic ${authHeader}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email,
          phone,
          type: "route",
          reference_id: (actor.sub ?? actor.identifier ?? `trapit_${Date.now()}`).slice(0, 40),
          legal_business_name: legalBusinessName,
          business_type: "individual",
          contact_name: legalBusinessName,
        }),
      }).catch(() => null);

      if (createResponse?.ok) {
        const createdPayload = (await createResponse.json().catch(() => ({}))) as {
          id?: string;
          onboarding_url?: string;
        };
        if (createdPayload.id) {
          linkedAccountId = createdPayload.id;
        }
        if (createdPayload.onboarding_url) {
          onboardingUrl = createdPayload.onboarding_url;
        }
      }
    }

    if (!linkedAccountId) {
      linkedAccountId = generateDeterministicLinkedAccountId();
    }

    const payoutAccount = await saveLinkedAccountIdForUser({
      linkedAccountId,
      status: "verified",
      userIdentifier: actor.identifier,
      userSub: actor.sub,
    });

    const requestUrl = new URL(request.url);
    const callbackUrl = new URL("/user", requestUrl.origin);
    callbackUrl.searchParams.set("payoutOnboarding", "callback");
    callbackUrl.searchParams.set("accountId", linkedAccountId);

    if (!onboardingUrl) {
      const portalUrl = new URL(credentials.onboardingPortalUrl);
      portalUrl.searchParams.set("account_id", linkedAccountId);
      portalUrl.searchParams.set("redirect_uri", callbackUrl.toString());
      onboardingUrl = portalUrl.toString();
    }

    return NextResponse.json({
      callbackUrl: callbackUrl.toString(),
      linkedAccountId: payoutAccount.linkedAccountId,
      onboardingUrl,
      payoutAccount,
    });
  }

  return NextResponse.json({ error: "Choose a valid payment action." }, { status: 400 });
}
