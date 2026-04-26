import "server-only";

import { getSessionIdentifier } from "@trapit/auth";

import { isWebAuthConfigured } from "./auth-config";
import { getWebSession } from "./session";

export type UserActor = {
  identifier: string;
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
      identifier: fallbackIdentifier,
      usingFallbackIdentifier: true,
    };
  }

  const session = await getWebSession();

  if (!session || session.role !== "user") {
    return null;
  }

  return {
    identifier: getSessionIdentifier(session) ?? "",
    usingFallbackIdentifier: false,
  };
}