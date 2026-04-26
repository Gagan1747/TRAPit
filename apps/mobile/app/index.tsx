import { Redirect, type Href } from "expo-router";

import { getMobileDashboardPath } from "@trapit/auth";

import { isMobileAuthConfigured } from "../src/auth/auth-config";
import { useAuth } from "../src/auth/auth-context";

export default function IndexScreen() {
  const { isLoading, session } = useAuth();
  const authConfigured = isMobileAuthConfigured();

  if (isLoading) {
    return null;
  }

  return <Redirect href={(session ? getMobileDashboardPath(session.role) : authConfigured ? "/sign-in" : "/user") as Href} />;
}