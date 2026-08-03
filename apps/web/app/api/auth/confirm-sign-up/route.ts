import { NextResponse } from "next/server";

import { confirmCognitoSignUp, getCognitoErrorCode, getCognitoErrorMessage } from "../../../../lib/cognito";

function maskPhoneForLogs(phoneNumber: string | null) {
  if (!phoneNumber) {
    return "unknown";
  }

  const digits = phoneNumber.replace(/\D/g, "");

  if (!digits) {
    return "unknown";
  }

  return `***${digits.slice(-4)}`;
}

export async function POST(request: Request) {
  let phoneNumberForLog: string | null = null;

  try {
    const body = (await request.json()) as {
      code?: string;
      phoneNumber?: string;
    };
    const phoneNumber = body.phoneNumber?.trim();
    const code = body.code?.trim();
    phoneNumberForLog = phoneNumber ?? null;

    if (!phoneNumber || !code) {
      return NextResponse.json(
        { error: "Phone number and confirmation code are required." },
        { status: 400 },
      );
    }

    await confirmCognitoSignUp(phoneNumber, code);
    console.info("[auth/confirm-sign-up] Confirmation completed", {
      phoneSuffix: maskPhoneForLogs(phoneNumberForLog),
    });
    return NextResponse.json({ confirmed: true });
  } catch (error) {
    console.error("[auth/confirm-sign-up] Confirmation failed", {
      code: getCognitoErrorCode(error),
      phoneSuffix: maskPhoneForLogs(phoneNumberForLog),
    });

    return NextResponse.json(
      { error: getCognitoErrorMessage(error) },
      { status: 400 },
    );
  }
}