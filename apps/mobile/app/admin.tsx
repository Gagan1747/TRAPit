import { getMobileDashboardPath, getSessionIdentifier } from "@trapit/auth";
import { Redirect, type Href } from "expo-router";
import { SafeAreaView, ScrollView, StyleSheet, Text, View } from "react-native";

import { isMobileAuthConfigured } from "../src/auth/auth-config";
import { useAuth } from "../src/auth/auth-context";
import { MobileAdminQuestionWorkspace } from "../src/components/mobile-admin-question-workspace";
import { MobileCategoryApprovalPanel } from "../src/components/mobile-category-panels";

export default function AdminScreen() {
  const { isLoading, session, signOut } = useAuth();
  const authConfigured = isMobileAuthConfigured();

  if (isLoading) {
    return null;
  }

  if (authConfigured) {
    if (!session) {
      return <Redirect href="/sign-in" />;
    }

    if (session.role !== "admin") {
      return <Redirect href={getMobileDashboardPath(session.role) as Href} />;
    }
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.screen}>
        <View style={styles.headerBlock}>
          <Text style={styles.eyebrow}>Admin workspace</Text>
          <Text style={styles.title}>Admin dashboard</Text>
          <Text style={styles.copy}>
            Run the workspace, and if you are the super admin, clear upgrade approvals from the same mobile dashboard.
          </Text>
          <Text style={styles.copy}>
            {authConfigured ? `Signed in as ${session ? getSessionIdentifier(session) ?? "admin" : "admin"}` : "Auth setup pending. Admin space is open for feature work."}
          </Text>
          {authConfigured ? (
            <Text style={styles.signOut} onPress={() => void signOut()}>
              Sign out
            </Text>
          ) : null}
        </View>
        {session ? <MobileCategoryApprovalPanel session={session} /> : null}
        <MobileAdminQuestionWorkspace currentAdminIdentifier={session ? getSessionIdentifier(session) : null} />
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