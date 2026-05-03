import "server-only";

import { getSessionDisplayName, getSessionIdentifier } from "@trapit/auth";

import { isWebAuthConfigured } from "./auth-config";
import { getWebSession } from "./session";

export type AdminActor = {
  displayName: string | null;
  identifier: string | null;
  sub: string | null;
};

export async function getAdminActor(): Promise<AdminActor | null> {
  if (!isWebAuthConfigured()) {
    return {
      displayName: null,
      identifier: null,
      sub: null,
    };
  }

  const session = await getWebSession();

  if (!session || session.role !== "admin") {
    return null;
  }

  return {
    displayName: getSessionDisplayName(session),
    identifier: getSessionIdentifier(session),
    sub: session.sub,
  };
}
