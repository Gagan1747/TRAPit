import { getDashboardPath, type UserRole } from "@trapit/auth";
import { NextResponse } from "next/server";

import { getAdminRoleMismatchMessage } from "../../../../lib/admin-access-contact";
import { getCognitoErrorMessage, signInWithCognito, verifyWebTokens } from "../../../../lib/cognito";
import { createWebSession, getWebSession } from "../../../../lib/session";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      phoneNumber?: string;
      password?: string;
      role?: UserRole;
    };
    const phoneNumber = body.phoneNumber?.trim();
    const password = body.password?.trim();

    if (!phoneNumber || !password) {
      return NextResponse.json(
        { error: "Phone number and password are required." },
        { status: 400 },
      );
    }

    const tokens = await signInWithCognito(phoneNumber, password);
    const session = await verifyWebTokens(tokens);
    const existingSession = await getWebSession();

    if (body.role && session.role !== body.role) {
      return NextResponse.json(
        { error: getAdminRoleMismatchMessage(session.role, body.role) },
        { status: 403 },
      );
    }

    if (
      existingSession &&
      ((existingSession.sub && session.sub && existingSession.sub !== session.sub) ||
        (!existingSession.sub && !session.sub && existingSession.phoneNumber !== session.phoneNumber))
    ) {
      return NextResponse.json(
        {
          error:
            "This device is already signed in to another account. Please sign out first before using a different account.",
        },
        { status: 409 },
      );
    }

    await createWebSession(tokens);
    return NextResponse.json({
      redirectTo: getDashboardPath(session.role),
      session,
    });
  } catch (error) {
    return NextResponse.json(
      { error: getCognitoErrorMessage(error) },
      { status: 400 },
    );
  }
}