export const USER_ROLES = ["user", "admin"] as const;

export type UserRole = (typeof USER_ROLES)[number];

export const roleLabels: Record<UserRole, string> = {
  admin: "Admin",
  user: "User",
};

export const routeByRole: Record<UserRole, string> = {
  admin: "/admin",
  user: "/user",
};

export const mobileRouteByRole: Record<UserRole, string> = {
  admin: "/admin",
  user: "/user",
};

export const normalSignupRole: UserRole = "user";

export const authCopy = {
  signInTitle: "Sign in to TRAPit",
  signUpTitle: "Create your TRAPit account",
  adminProvisioningNote:
    "Admin accounts are provisioned separately and must be assigned to the admins group.",
};

export function getDashboardPath(role: UserRole): string {
  return routeByRole[role];
}

export function getMobileDashboardPath(role: UserRole): string {
  return mobileRouteByRole[role];
}