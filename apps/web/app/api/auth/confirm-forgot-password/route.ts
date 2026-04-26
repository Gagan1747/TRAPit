import { NextResponse } from "next/server";

import { confirmPasswordReset, getCognitoErrorMessage } from "../../../../lib/cognito";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      code?: string;
      password?: string;
      phoneNumber?: string;
    };
    const code = body.code?.trim();
    const password = body.password?.trim();
    const phoneNumber = body.phoneNumber?.trim();

    if (!phoneNumber || !code || !password) {
      return NextResponse.json(
        { error: "Phone number, SMS code, and new password are required." },
        { status: 400 },
      );
    }

    await confirmPasswordReset(phoneNumber, code, password);

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: getCognitoErrorMessage(error) },
      { status: 400 },
    );
  }
}