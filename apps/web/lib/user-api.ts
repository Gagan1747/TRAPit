import "server-only";

import { getSessionDisplayName, getSessionIdentifier, type UserRole } from "@trapit/auth";

import { isWebAuthConfigured } from "./auth-config";
import { getWebSession } from "./session";

export type UserActor = {
  displayName: string | null;
  identifier: string;
  role: UserRole;
  usingFallbackIdentifier: boolean;
};

export async function getUserActor(request: Request): Promise<UserActor | null> {
  if (!isWebAuthConfigured()) {
    const url = new URL(request.url);
    const fallbackIdentifier = url.searchParams.get("participantId")?.trim();

    if (!fallbackIdentifier) {
      return null;
    }

    return {
      displayName: null,
      identifier: fallbackIdentifier,
      role: "user",
      usingFallbackIdentifier: true,
    };
  }

  const session = await getWebSession();

  if (!session || (session.role !== "user" && session.role !== "admin")) {
    return null;
  }

  return {
    displayName: getSessionDisplayName(session),
    identifier: getSessionIdentifier(session) ?? "",
    role: session.role,
    usingFallbackIdentifier: false,
  };
}