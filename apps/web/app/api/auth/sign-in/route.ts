import { getDashboardPath } from "@trapit/auth";
import { NextResponse } from "next/server";

import { getCognitoErrorMessage, signInWithCognito, verifyWebTokens } from "../../../../lib/cognito";
import { createWebSession, getWebSession, recordWebSignIn } from "../../../../lib/session";
import { resolveAssignedCategoryForSession } from "../../../../lib/user-category-store";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      phoneNumber?: string;
      password?: string;
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
    const resolvedSession = {
      ...session,
      userCategory: session.role === "user"
        ? await resolveAssignedCategoryForSession(session)
        : null,
    };
    const signInActivity = await recordWebSignIn(resolvedSession);

    return NextResponse.json({
      previousSignInAt: signInActivity.previousSignInAt,
      redirectTo: getDashboardPath(resolvedSession.role),
      session: resolvedSession,
    });
  } catch (error) {
    return NextResponse.json(
      { error: getCognitoErrorMessage(error) },
      { status: 400 },
    );
  }
}