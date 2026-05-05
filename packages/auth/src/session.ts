import { USER_ROLES, type UserRole } from "./roles";
import {
  defaultNormalUserCategory,
  resolveNormalUserCategory,
  type NormalUserCategory,
} from "./user-categories";

export type RoleClaimValue = string | string[] | undefined;

export type TokenClaims = {
  email?: string;
  phone_number?: string;
  name?: string;
  preferred_username?: string;
  given_name?: string;
  exp?: number;
  sub?: string;
  "cognito:groups"?: RoleClaimValue;
  "custom:appRole"?: string;
  "custom:appUserCategory"?: string;
  "custom:role"?: string;
  "custom:userCategory"?: string;
};

export type RoleClaimOptions = {
  adminGroup?: string;
  defaultRole?: UserRole;
  defaultUserCategory?: NormalUserCategory;
  userGroup?: string;
};

export type AuthSession = {
  displayIdentifier: string | null;
  displayName: string | null;
  email: string | null;
  expiresAt: number | null;
  phoneNumber: string | null;
  role: UserRole;
  sub: string | null;
  userCategory: NormalUserCategory | null;
};

export function getSessionDisplayName(
  session: Pick<AuthSession, "displayName">,
) {
  return session.displayName;
}

export function getSessionIdentifier(session: Pick<AuthSession, "displayIdentifier" | "phoneNumber" | "email" | "sub">): string | null {
  return session.displayIdentifier ?? session.phoneNumber ?? session.email ?? session.sub;
}

export function getGroupsFromClaims(value: RoleClaimValue): string[] {
  if (Array.isArray(value)) {
    return value.filter((group): group is string => typeof group === "string");
  }

  if (typeof value === "string") {
    return [value];
  }

  return [];
}

function normalizeGroupName(group: string): string {
  return group.trim().toLowerCase();
}

function getGroupCandidates(group: string | undefined, fallbacks: string[]): Set<string> {
  const candidates = new Set<string>();

  if (group) {
    candidates.add(normalizeGroupName(group));
  }

  for (const fallback of fallbacks) {
    candidates.add(normalizeGroupName(fallback));
  }

  return candidates;
}

export function resolveUserRole(
  claims: TokenClaims,
  options: RoleClaimOptions = {},
): UserRole | null {
  const adminGroup = options.adminGroup ?? "admins";
  const defaultRole = options.defaultRole;
  const userGroup = options.userGroup ?? "users";
  const groups = getGroupsFromClaims(claims["cognito:groups"]).map(normalizeGroupName);
  const adminGroups = getGroupCandidates(adminGroup, ["admin", "admins"]);
  const userGroups = getGroupCandidates(userGroup, ["user", "users"]);

  if (groups.some((group) => adminGroups.has(group))) {
    return "admin";
  }

  if (groups.some((group) => userGroups.has(group))) {
    return "user";
  }

  const customRole = claims["custom:appRole"] ?? claims["custom:role"];

  if (typeof customRole === "string" && USER_ROLES.includes(customRole as UserRole)) {
    return customRole as UserRole;
  }

  if (defaultRole && USER_ROLES.includes(defaultRole)) {
    return defaultRole;
  }

  return null;
}

export function buildSessionFromClaims(
  claims: TokenClaims,
  options: RoleClaimOptions = {},
): AuthSession | null {
  const role = resolveUserRole(claims, options);

  if (!role) {
    return null;
  }

  const phoneNumber = claims.phone_number ?? null;
  const email = claims.email ?? null;
  const defaultUserCategory = options.defaultUserCategory ?? defaultNormalUserCategory;
  const displayName =
    claims.name?.trim() || claims.preferred_username?.trim() || claims.given_name?.trim() || null;
  const userCategory = role === "user"
    ? resolveNormalUserCategory(
        claims["custom:appUserCategory"] ?? claims["custom:userCategory"],
        defaultUserCategory,
      )
    : null;

  return {
    displayIdentifier: phoneNumber ?? email ?? claims.sub ?? null,
    displayName,
    email,
    expiresAt: typeof claims.exp === "number" ? claims.exp : null,
    phoneNumber,
    role,
    sub: claims.sub ?? null,
    userCategory,
  };
}