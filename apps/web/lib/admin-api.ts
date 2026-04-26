import "server-only";

import { getSessionIdentifier } from "@trapit/auth";

import { isWebAuthConfigured } from "./auth-config";
import { getWebSession } from "./session";

export type AdminActor = {
  identifier: string | null;
  sub: string | null;
};

export async function getAdminActor(): Promise<AdminActor | null> {
  if (!isWebAuthConfigured()) {
    return {
      identifier: null,
      sub: null,
    };
  }

  const session = await getWebSession();

  if (!session || session.role !== "admin") {
    return null;
  }

  return {
    identifier: getSessionIdentifier(session),
    sub: session.sub,
  };
}
