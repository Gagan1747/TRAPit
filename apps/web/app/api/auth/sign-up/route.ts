import { NextResponse } from "next/server";

import {
  addUserToDefaultGroup,
  getCognitoErrorCode,
  getCognitoErrorMessage,
  resendCognitoConfirmationCode,
  signUpWithCognito,
} from "../../../../lib/cognito";
import { recordTermsConsentForPhone } from "../../../../lib/terms-consent-store";

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
  let phoneNumber: string | null = null;

  try {
    const body = (await request.json()) as {
      fullName?: string;
      phoneNumber?: string;
      password?: string;
      acceptedTerms?: boolean;
    };
    const fullName = body.fullName?.trim();
    phoneNumber = body.phoneNumber?.trim() ?? null;
    const password = body.password?.trim();

    if (!fullName || !phoneNumber || !password) {
      return NextResponse.json(
        { error: "Full name, phone number, and password are required." },
        { status: 400 },
      );
    }

    if (!body.acceptedTerms) {
      return NextResponse.json(
        { error: "Accept the TRAPit.in Terms of Service to create an account." },
        { status: 400 },
      );
    }

    const result = await signUpWithCognito(phoneNumber, password, fullName);
    let warning: string | undefined;

    await recordTermsConsentForPhone(phoneNumber);

    try {
      await addUserToDefaultGroup(phoneNumber);
    } catch {
      warning = "User created, but automatic assignment to the users group failed. Configure AWS credentials for the web server or add the user to the Cognito users group manually.";
    }

    if (!result.UserConfirmed && !result.CodeDeliveryDetails?.Destination) {
      console.warn("[auth/sign-up] Cognito returned unconfirmed user without delivery destination", {
        phoneSuffix: maskPhoneForLogs(phoneNumber),
      });
    }

    console.info("[auth/sign-up] Sign-up completed", {
      phoneSuffix: maskPhoneForLogs(phoneNumber),
      requiresConfirmation: !result.UserConfirmed,
      hasDeliveryDestination: Boolean(result.CodeDeliveryDetails?.Destination),
    });

    return NextResponse.json({
      deliveryDestination: result.CodeDeliveryDetails?.Destination ?? null,
      requiresConfirmation: !result.UserConfirmed,
      warning,
    });
  } catch (error) {
    const code = getCognitoErrorCode(error);

    if (code === "UsernameExistsException" && phoneNumber) {
      try {
        const resend = await resendCognitoConfirmationCode(phoneNumber);

        console.info("[auth/sign-up] Existing account detected, resent confirmation code", {
          phoneSuffix: maskPhoneForLogs(phoneNumber),
          hasDeliveryDestination: Boolean(resend.CodeDeliveryDetails?.Destination),
        });

        return NextResponse.json({
          deliveryDestination: resend.CodeDeliveryDetails?.Destination ?? null,
          requiresConfirmation: true,
          warning: "An account already exists for this phone number. A fresh OTP has been sent.",
        });
      } catch (resendError) {
        console.error("[auth/sign-up] Failed to resend confirmation code for existing account", {
          code: getCognitoErrorCode(resendError),
          phoneSuffix: maskPhoneForLogs(phoneNumber),
        });
      }
    }

    console.error("[auth/sign-up] Sign-up failed", {
      code,
      phoneSuffix: maskPhoneForLogs(phoneNumber),
    });

    return NextResponse.json(
      { error: getCognitoErrorMessage(error) },
      { status: 400 },
    );
  }
}