import { NextResponse } from "next/server";

import {
  addUserToDefaultGroup,
  deleteCognitoUser,
  getCognitoErrorCode,
  getCognitoErrorMessage,
  getCognitoRawErrorMessage,
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
    let deliveryDestination = result.CodeDeliveryDetails?.Destination ?? null;
    let warning: string | undefined;

    if (!result.UserConfirmed && !deliveryDestination) {
      try {
        await deleteCognitoUser(phoneNumber);

        console.error("[auth/sign-up] Deleted unconfirmed user after missing OTP delivery", {
          phoneSuffix: maskPhoneForLogs(phoneNumber),
        });
      } catch (deleteError) {
        console.error("[auth/sign-up] Failed to delete unconfirmed user after missing OTP delivery", {
          code: getCognitoErrorCode(deleteError),
          message: getCognitoRawErrorMessage(deleteError) ?? getCognitoErrorMessage(deleteError),
          phoneSuffix: maskPhoneForLogs(phoneNumber),
        });
      }

      return NextResponse.json(
        {
          error: "Cognito created the account but did not generate a signup OTP. Check Cognito phone-number signup verification and Custom SMS Sender settings, then try again.",
        },
        { status: 502 },
      );
    }

    await recordTermsConsentForPhone(phoneNumber);

    try {
      await addUserToDefaultGroup(phoneNumber);
    } catch {
      warning = "User created, but automatic assignment to the users group failed. Configure AWS credentials for the web server or add the user to the Cognito users group manually.";
    }

    if (!result.UserConfirmed && !deliveryDestination) {
      console.warn("[auth/sign-up] Cognito returned unconfirmed user without delivery destination", {
        phoneSuffix: maskPhoneForLogs(phoneNumber),
      });
    }

    console.info("[auth/sign-up] Sign-up completed", {
      attributeName: result.CodeDeliveryDetails?.AttributeName ?? null,
      deliveryMedium: result.CodeDeliveryDetails?.DeliveryMedium ?? null,
      phoneSuffix: maskPhoneForLogs(phoneNumber),
      requiresConfirmation: !result.UserConfirmed,
      hasDeliveryDestination: Boolean(deliveryDestination),
    });

    return NextResponse.json({
      deliveryDestination,
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
        const resendCode = getCognitoErrorCode(resendError);
        const resendMessage = getCognitoRawErrorMessage(resendError)?.toLowerCase() ?? "";

        if (
          resendCode === "InvalidParameterException"
          && resendMessage.includes("already confirmed")
        ) {
          return NextResponse.json({
            requiresConfirmation: false,
            shouldSignIn: true,
            warning: "This phone number is already confirmed. Sign in with your password.",
          });
        }

        console.error("[auth/sign-up] Failed to resend confirmation code for existing account", {
          code: resendCode,
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