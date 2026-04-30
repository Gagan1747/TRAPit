import { buildSessionFromClaims, type AuthSession } from "@trapit/auth";
import * as SecureStore from "expo-secure-store";
import { jwtDecode } from "jwt-decode";

import { type MobileTokens } from "./cognito";

const SESSION_KEY = "trapit.mobile.session";

type StoredSession = {
  accessToken: string;
  expiresIn: number;
  idToken: string;
  refreshToken?: string;
};

export type MobileAuthSession = AuthSession & {
  accessToken: string;
  idToken: string;
  refreshToken?: string;
};

function getRoleOptions() {
  return {
    adminGroup: process.env.EXPO_PUBLIC_COGNITO_ADMIN_GROUP ?? "admins",
    defaultRole: "user" as const,
    userGroup: process.env.EXPO_PUBLIC_COGNITO_USER_GROUP ?? "users",
  };
}

function decodeTokens(tokens: StoredSession): MobileAuthSession {
  const claims = jwtDecode(tokens.idToken) as {
    [key: string]: unknown;
    email?: string;
    exp?: number;
    phone_number?: string;
    sub?: string;
  };
  const session = buildSessionFromClaims(claims, getRoleOptions());

  if (!session) {
    throw new Error("Signed in user does not carry a supported Cognito role claim.");
  }

  return {
    ...session,
    accessToken: tokens.accessToken,
    idToken: tokens.idToken,
    refreshToken: tokens.refreshToken,
  };
}

export async function readStoredSession() {
  const rawValue = await SecureStore.getItemAsync(SESSION_KEY);

  if (!rawValue) {
    return null;
  }

  const stored = JSON.parse(rawValue) as StoredSession;
  const session = decodeTokens(stored);

  if (session.expiresAt && session.expiresAt * 1000 <= Date.now()) {
    await clearStoredSession();
    return null;
  }

  return session;
}

export async function persistSession(tokens: MobileTokens) {
  await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(tokens));
  return readStoredSession();
}

export async function clearStoredSession() {
  await SecureStore.deleteItemAsync(SESSION_KEY);
}