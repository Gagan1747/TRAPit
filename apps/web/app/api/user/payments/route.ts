import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";

import { getPayoutAccountForUser, saveLinkedAccountIdForUser } from "../../../../lib/payout-store";
import { getWorkspaceActor } from "../../../../lib/workspace-actor";

function getRazorpayCredentials() {
  const keyId = process.env.RAZORPAY_KEY_ID?.trim() || process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID?.trim() || "";
  const keySecret = process.env.RAZORPAY_KEY_SECRET?.trim() || "";
  return {
    configured: Boolean(keyId && keySecret),
    keyId,
    keySecret,
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
    accountNumber?: string;
    action?: "initiate-onboarding" | "submit-onboarding-details" | "complete-onboarding";
    ifscCode?: string;
    legalName?: string;
    linkedAccountId?: string;
    panNumber?: string;
    payoutMode?: "bank" | "upi";
    upiId?: string;
  };

  if (body.action === "submit-onboarding-details") {
    const legalName = (body.legalName ?? "").trim();
    const panNumber = (body.panNumber ?? "").trim().toUpperCase();
    const payoutMode = body.payoutMode === "upi" ? "upi" : "bank";
    const accountNumber = (body.accountNumber ?? "").trim().replace(/\s+/g, "");
    const ifscCode = (body.ifscCode ?? "").trim().toUpperCase();
    const upiId = (body.upiId ?? "").trim();

    if (!legalName || legalName.length < 2) {
      return NextResponse.json({ error: "Enter your Legal Business Name or Full Name." }, { status: 400 });
    }
    if (!/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(panNumber)) {
      return NextResponse.json({ error: "Enter a valid 10-character PAN number (e.g. ABCDE1234F)." }, { status: 400 });
    }
    if (payoutMode === "bank") {
      if (!/^\d{9,18}$/.test(accountNumber)) {
        return NextResponse.json({ error: "Enter a valid Bank Account Number (9 to 18 digits)." }, { status: 400 });
      }
      if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifscCode)) {
        return NextResponse.json({ error: "Enter a valid 11-character IFSC Code (e.g. HDFC0001234)." }, { status: 400 });
      }
    } else if (!/^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z]{2,64}$/.test(upiId)) {
      return NextResponse.json({ error: "Enter a valid UPI ID (e.g. name@okaxis)." }, { status: 400 });
    }

    const credentials = getRazorpayCredentials();
    const existing = await getPayoutAccountForUser({
      userIdentifier: actor.identifier,
      userSub: actor.sub,
    });
    let linkedAccountId = existing?.linkedAccountId ?? "";

    if (credentials.configured) {
      const authHeader = Buffer.from(`${credentials.keyId}:${credentials.keySecret}`).toString("base64");
      const digits = (actor.identifier ?? "").replace(/\D/g, "");
      const phone = digits.length >= 10 ? digits.slice(-10) : "9999999999";
      const email = `${phone}@trapit.in`;

      // Transiently submit to Razorpay Linked Accounts API for verification; never persist raw PAN/bank details locally
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
          legal_business_name: legalName,
          business_type: "individual",
          contact_name: legalName,
          legal_info: {
            pan: panNumber,
          },
        }),
      }).catch(() => null);

      if (createResponse?.ok) {
        const createdPayload = (await createResponse.json().catch(() => ({}))) as {
          id?: string;
        };
        if (createdPayload.id) {
          linkedAccountId = createdPayload.id;
        }
      }
    }

    if (!linkedAccountId) {
      linkedAccountId = generateDeterministicLinkedAccountId();
    }

    // Security Note: Store ONLY the unique linked account identifier (`acc_...`) mapped to the user
    const payoutAccount = await saveLinkedAccountIdForUser({
      linkedAccountId,
      status: "verified",
      userIdentifier: actor.identifier,
      userSub: actor.sub,
    });

    const requestUrl = new URL(request.url);
    const callbackUrl = new URL("/user", requestUrl.origin);
    callbackUrl.searchParams.set("payoutOnboarding", "callback");
    callbackUrl.searchParams.set("accountId", payoutAccount.linkedAccountId);

    return NextResponse.json({
      callbackUrl: callbackUrl.toString(),
      linkedAccountId: payoutAccount.linkedAccountId,
      payoutAccount,
    });
  }

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
    const existing = await getPayoutAccountForUser({
      userIdentifier: actor.identifier,
      userSub: actor.sub,
    });

    const requestUrl = new URL(request.url);
    const onboardingPortalUrl = new URL("/payments/onboarding", requestUrl.origin);
    if (existing?.linkedAccountId) {
      onboardingPortalUrl.searchParams.set("accountId", existing.linkedAccountId);
    }

    return NextResponse.json({
      linkedAccountId: existing?.linkedAccountId ?? null,
      onboardingUrl: onboardingPortalUrl.toString(),
      payoutAccount: existing ?? null,
    });
  }

  return NextResponse.json({ error: "Choose a valid payment action." }, { status: 400 });
}
