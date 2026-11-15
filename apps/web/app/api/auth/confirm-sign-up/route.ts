import { NextResponse } from "next/server";

import { confirmCognitoSignUp, getCognitoErrorCode, getCognitoErrorMessage, listRegisteredDirectoryUsers } from "../../../../lib/cognito";
import { reconcileUnregisteredApportionRecordsForUser } from "../../../../lib/apportion-store";
import { participantIdentifiersMatch } from "@trapit/testing";

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
    try {
      const directoryUsers = await listRegisteredDirectoryUsers();
      const matchedUser = directoryUsers.find((entry) => participantIdentifiersMatch(entry.identifier, phoneNumber));
      if (matchedUser?.label) {
        await reconcileUnregisteredApportionRecordsForUser({
          identifier: matchedUser.identifier,
          registeredName: matchedUser.label,
        });
      }
    } catch {
      // Ignore directory lookup error after confirmation
    }
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