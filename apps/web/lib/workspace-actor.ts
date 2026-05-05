import "server-only";

import {
  defaultNormalUserCategory,
  getSessionDisplayName,
  getSessionIdentifier,
  type NormalUserCategory,
  type UserRole,
} from "@trapit/auth";

import { isWebAuthConfigured } from "./auth-config";
import { getWebSession } from "./session";

export type WorkspaceActor = {
  displayName: string | null;
  identifier: string | null;
  isSuperAdmin: boolean;
  phoneNumber: string | null;
  role: UserRole;
  sub: string | null;
  userCategory: NormalUserCategory;
};

function normalizeIdentifier(value: string | null | undefined) {
  return value?.trim().toLowerCase().replace(/[\s()-]/g, "") ?? "";
}

const SUPER_ADMIN_IDENTIFIER = normalizeIdentifier(process.env.TRAPIT_SUPER_ADMIN_PHONE ?? "+919899538637");

export function isSuperAdminIdentifier(value: string | null | undefined) {
  return Boolean(SUPER_ADMIN_IDENTIFIER && normalizeIdentifier(value) === SUPER_ADMIN_IDENTIFIER);
}

export async function getWorkspaceActor(request?: Request): Promise<WorkspaceActor | null> {
  if (!isWebAuthConfigured()) {
    return {
      displayName: null,
      identifier: null,
      isSuperAdmin: false,
      phoneNumber: null,
      role: "admin",
      sub: null,
      userCategory: defaultNormalUserCategory,
    };
  }

  const session = await getWebSession(request);

  if (!session || (session.role !== "admin" && session.role !== "user")) {
    return null;
  }

  const identifier = getSessionIdentifier(session);

  return {
    displayName: getSessionDisplayName(session),
    identifier,
    isSuperAdmin: isSuperAdminIdentifier(session.phoneNumber ?? identifier),
    phoneNumber: session.phoneNumber,
    role: session.role,
    sub: session.sub,
    userCategory: session.userCategory ?? defaultNormalUserCategory,
  };
}

export async function getSuperAdminActor(request?: Request) {
  const actor = await getWorkspaceActor(request);

  if (!actor?.isSuperAdmin) {
    return null;
  }

  return actor;
}