import { NextResponse } from "next/server";

import { confirmCognitoSignUp, getCognitoErrorMessage } from "../../../../lib/cognito";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      code?: string;
      phoneNumber?: string;
    };
    const phoneNumber = body.phoneNumber?.trim();
    const code = body.code?.trim();

    if (!phoneNumber || !code) {
      return NextResponse.json(
        { error: "Phone number and confirmation code are required." },
        { status: 400 },
      );
    }

    await confirmCognitoSignUp(phoneNumber, code);
    return NextResponse.json({ confirmed: true });
  } catch (error) {
    return NextResponse.json(
      { error: getCognitoErrorMessage(error) },
      { status: 400 },
    );
  }
}