import "server-only";

import { getDashboardPath, type AuthSession, type UserRole } from "@trapit/auth";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { getWebAuthSetupMessage, isWebAuthConfigured } from "./auth-config";
import { verifyWebTokens, type CognitoTokens } from "./cognito";

const COOKIE_NAMES = {
  accessToken: "trapit-access-token",
  idToken: "trapit-id-token",
  refreshToken: "trapit-refresh-token",
} as const;

function getCookieOptions(maxAge?: number) {
  return {
    httpOnly: true,
    maxAge,
    path: "/",
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
  };
}

export async function createWebSession(tokens: CognitoTokens) {
  const cookieStore = cookies();

  cookieStore.set(
    COOKIE_NAMES.idToken,
    tokens.idToken,
    getCookieOptions(tokens.expiresIn),
  );
  cookieStore.set(
    COOKIE_NAMES.accessToken,
    tokens.accessToken,
    getCookieOptions(tokens.expiresIn),
  );

  if (tokens.refreshToken) {
    cookieStore.set(
      COOKIE_NAMES.refreshToken,
      tokens.refreshToken,
      getCookieOptions(60 * 60 * 24 * 30),
    );
  }
}

export async function destroyWebSession() {
  const cookieStore = cookies();

  cookieStore.delete(COOKIE_NAMES.idToken);
  cookieStore.delete(COOKIE_NAMES.accessToken);
  cookieStore.delete(COOKIE_NAMES.refreshToken);
}

export async function getWebSession(): Promise<AuthSession | null> {
  if (!isWebAuthConfigured()) {
    return {
      displayIdentifier: null,
      displayName: null,
      email: null,
      expiresAt: null,
      phoneNumber: null,
      role: "user",
      sub: null,
    };
  }

  const idToken = cookies().get(COOKIE_NAMES.idToken)?.value;
  const accessToken = cookies().get(COOKIE_NAMES.accessToken)?.value;

  if (!idToken) {
    return null;
  }

  try {
    return await verifyWebTokens({ accessToken, idToken });
  } catch {
    return null;
  }
}

export async function requireWebSession(role: UserRole | UserRole[]) {
  const allowedRoles = Array.isArray(role) ? role : [role];

  if (!isWebAuthConfigured()) {
    return {
      displayIdentifier: getWebAuthSetupMessage(),
      displayName: null,
      email: getWebAuthSetupMessage(),
      expiresAt: null,
      phoneNumber: null,
      role: allowedRoles[0],
      sub: null,
    };
  }

  const session = await getWebSession();

  if (!session) {
    redirect("/sign-in?error=session");
  }

  if (!allowedRoles.includes(session.role)) {
    redirect(getDashboardPath(session.role));
  }

  return session;
}