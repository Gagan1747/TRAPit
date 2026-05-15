import { getMobileDashboardPath, getSessionIdentifier, normalUserCategoryLabels } from "@trapit/auth";
import { Redirect, type Href } from "expo-router";
import { SafeAreaView, ScrollView, StyleSheet, Text, View } from "react-native";

import { isMobileAuthConfigured } from "../src/auth/auth-config";
import { useAuth } from "../src/auth/auth-context";
import { MobileCategoryMembershipPanel } from "../src/components/mobile-category-panels";
import { MobileRestrictedUserDashboardWorkspace } from "../src/components/mobile-restricted-user-dashboard-workspace";
import { MobileUserTestWorkspace } from "../src/components/mobile-user-test-workspace";
import { formatPhoneNumberForDisplay, isSuperAdminSession } from "../src/lib/privacy";

export default function UserScreen() {
  const { isLoading, session, signOut } = useAuth();
  const authConfigured = isMobileAuthConfigured();

  if (isLoading) {
    return null;
  }

  if (authConfigured) {
    if (!session) {
      return <Redirect href="/sign-in" />;
    }

    if (session.role !== "user" && session.role !== "admin") {
      return <Redirect href={getMobileDashboardPath(session.role) as Href} />;
    }
  }

  const currentIdentifier = session ? getSessionIdentifier(session) : null;
  const categoryLabel = session?.userCategory ? normalUserCategoryLabels[session.userCategory].replace(/ users$/i, " user") : null;
  const isSuperAdmin = session ? isSuperAdminSession(session) : false;
  const showRestrictedDashboard = !session || session.role === "user";

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.screen}>
        <View style={styles.headerBlock}>
          <Text style={styles.eyebrow}>User workspace</Text>
          <Text style={styles.title}>User dashboard</Text>
          <Text style={styles.copy}>
            Review your plan, request an upgrade, and access the parts of TRAPit that are already live for your account.
          </Text>
          <Text style={styles.copy}>
            {authConfigured
              ? `Signed in with ${formatPhoneNumberForDisplay(session ? getSessionIdentifier(session) ?? "user" : "user", { showFullPhoneNumber: isSuperAdmin })}${categoryLabel ? ` as ${categoryLabel}` : ""}`
              : "Auth setup pending. User space is open for feature work."}
          </Text>
          {authConfigured ? (
            <Text style={styles.signOut} onPress={() => void signOut()}>
              Sign out
            </Text>
          ) : null}
        </View>
        {session && session.role === "user" ? <MobileCategoryMembershipPanel session={session} /> : null}
        {showRestrictedDashboard ? (
          <MobileRestrictedUserDashboardWorkspace currentUserCategory={session?.userCategory ?? null} currentUserIdentifier={currentIdentifier} />
        ) : (
          <MobileUserTestWorkspace currentParticipantIdentifier={currentIdentifier} />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#efe3d2",
  },
  headerBlock: {
    gap: 10,
  },
  screen: {
    padding: 24,
    gap: 10,
  },
  eyebrow: {
    textTransform: "uppercase",
    letterSpacing: 2,
    color: "#8e3f2c",
    fontSize: 12,
    fontWeight: "700",
  },
  title: {
    fontSize: 34,
    color: "#231712",
    fontWeight: "700",
  },
  copy: {
    color: "#6d5a4e",
    fontSize: 16,
    lineHeight: 24,
  },
  signOut: {
    color: "#8e3f2c",
    fontSize: 16,
    fontWeight: "700",
  },
});