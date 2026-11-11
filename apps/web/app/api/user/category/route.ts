import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { orderedNormalUserCategories, resolveNormalUserCategory, type NormalUserCategory } from "@trapit/auth";

import { getWorkspaceActor } from "../../../../lib/workspace-actor";
import { assignPaidUserCategoryFromRazorpay, createUserCategoryUpgradeRequest, getUserCategorySnapshot } from "../../../../lib/user-category-store";

const RAZORPAY_AMOUNT_PAISE_BY_CATEGORY: Record<Exclude<NormalUserCategory, "trapit-normal">, number> = {
  "trapit-pro": 250 * 100,
  "trapit-pro-max": 500 * 100,
};

function getRazorpayCredentials() {
  const keyId = process.env.RAZORPAY_KEY_ID?.trim() || process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID?.trim() || "";
  const keySecret = process.env.RAZORPAY_KEY_SECRET?.trim() || "";
  return {
    configured: Boolean(keyId && keySecret),
    keyId,
    keySecret,
  };
}

export async function GET(request: Request) {
  const actor = await getWorkspaceActor(request);

  if (!actor) {
    return NextResponse.json({ error: "User access is required." }, { status: 403 });
  }

  const snapshot = await getUserCategorySnapshot({
    currentCategory: actor.userCategory,
    displayName: actor.displayName,
    identifier: actor.identifier,
    sub: actor.sub,
  });

  return NextResponse.json(snapshot);
}

export async function POST(request: Request) {
  const actor = await getWorkspaceActor(request);

  if (!actor) {
    return NextResponse.json({ error: "User access is required." }, { status: 403 });
  }

  const body = (await request.json()) as {
    action?: "create-razorpay-order" | "verify-razorpay-payment" | "request";
    razorpayOrderId?: string;
    razorpayPaymentId?: string;
    razorpaySignature?: string;
    requestedCategory?: string;
  };

  if (body.action === "create-razorpay-order") {
    const requestedCategory = resolveNormalUserCategory(body.requestedCategory);
    if (requestedCategory === "trapit-normal") {
      return NextResponse.json({ error: "Select Pro or Pro Max to upgrade." }, { status: 400 });
    }
    const currentIndex = orderedNormalUserCategories.indexOf(actor.userCategory);
    const targetIndex = orderedNormalUserCategories.indexOf(requestedCategory);
    if (targetIndex <= currentIndex) {
      return NextResponse.json({ error: "Select a higher category to upgrade." }, { status: 400 });
    }

    const credentials = getRazorpayCredentials();
    if (!credentials.configured) {
      return NextResponse.json(
        { error: "Razorpay payment gateway is not configured yet. Please set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET." },
        { status: 503 },
      );
    }

    const amount = RAZORPAY_AMOUNT_PAISE_BY_CATEGORY[requestedCategory];
    const receipt = `trapit_${requestedCategory}_${Date.now()}`.slice(0, 40);
    const authHeader = Buffer.from(`${credentials.keyId}:${credentials.keySecret}`).toString("base64");

    const orderResponse = await fetch("https://api.razorpay.com/v1/orders", {
      method: "POST",
      headers: {
        Authorization: `Basic ${authHeader}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        amount,
        currency: "INR",
        notes: {
          requestedCategory,
          userIdentifier: actor.identifier ?? "",
          userSub: actor.sub ?? "",
        },
        receipt,
      }),
    });

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
      amount: orderPayload.amount ?? amount,
      currency: orderPayload.currency ?? "INR",
      keyId: credentials.keyId,
      orderId: orderPayload.id,
      requestedCategory,
    });
  }

  if (body.action === "verify-razorpay-payment") {
    const requestedCategory = resolveNormalUserCategory(body.requestedCategory);
    const orderId = body.razorpayOrderId?.trim() ?? "";
    const paymentId = body.razorpayPaymentId?.trim() ?? "";
    const signature = body.razorpaySignature?.trim() ?? "";

    if (requestedCategory === "trapit-normal" || !orderId || !paymentId || !signature) {
      return NextResponse.json({ error: "Complete payment verification details are required." }, { status: 400 });
    }

    const credentials = getRazorpayCredentials();
    if (!credentials.configured) {
      return NextResponse.json({ error: "Razorpay payment gateway is not configured." }, { status: 503 });
    }

    const expectedSignature = createHmac("sha256", credentials.keySecret)
      .update(`${orderId}|${paymentId}`)
      .digest("hex");

    const expectedBuffer = Buffer.from(expectedSignature, "utf8");
    const actualBuffer = Buffer.from(signature, "utf8");
    if (expectedBuffer.length !== actualBuffer.length || !timingSafeEqual(expectedBuffer, actualBuffer)) {
      return NextResponse.json({ error: "Payment signature verification failed." }, { status: 400 });
    }

    const snapshot = await assignPaidUserCategoryFromRazorpay({
      category: requestedCategory,
      displayName: actor.displayName,
      paymentId,
      paymentOrderId: orderId,
      userIdentifier: actor.identifier,
      userSub: actor.sub,
    });

    return NextResponse.json(snapshot);
  }

  if (!body.requestedCategory?.trim()) {
    return NextResponse.json({ error: "Select a category before sending an upgrade request." }, { status: 400 });
  }

  try {
    const snapshot = await createUserCategoryUpgradeRequest({
      currentCategory: actor.userCategory,
      displayName: actor.displayName,
      identifier: actor.identifier,
      requestedCategory: body.requestedCategory as typeof actor.userCategory,
      sub: actor.sub,
    });

    return NextResponse.json(snapshot);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to send the upgrade request." },
      { status: 400 },
    );
  }
}