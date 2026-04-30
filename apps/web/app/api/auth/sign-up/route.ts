import { NextResponse } from "next/server";

import { addUserToDefaultGroup, getCognitoErrorMessage, signUpWithCognito } from "../../../../lib/cognito";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      fullName?: string;
      phoneNumber?: string;
      password?: string;
    };
    const fullName = body.fullName?.trim();
    const phoneNumber = body.phoneNumber?.trim();
    const password = body.password?.trim();

    if (!fullName || !phoneNumber || !password) {
      return NextResponse.json(
        { error: "Full name, phone number, and password are required." },
        { status: 400 },
      );
    }

    const result = await signUpWithCognito(phoneNumber, password, fullName);
    let warning: string | undefined;

    try {
      await addUserToDefaultGroup(phoneNumber);
    } catch {
      warning = "User created, but automatic assignment to the users group failed. Configure AWS credentials for the web server or add the user to the Cognito users group manually.";
    }

    return NextResponse.json({
      deliveryDestination: result.CodeDeliveryDetails?.Destination ?? null,
      requiresConfirmation: !result.UserConfirmed,
      warning,
    });
  } catch (error) {
    return NextResponse.json(
      { error: getCognitoErrorMessage(error) },
      { status: 400 },
    );
  }
}