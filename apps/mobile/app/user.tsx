import { getMobileDashboardPath, getSessionIdentifier } from "@trapit/auth";
import { Redirect, type Href } from "expo-router";
import { SafeAreaView, ScrollView, StyleSheet, Text, View } from "react-native";

import { isMobileAuthConfigured } from "../src/auth/auth-config";
import { useAuth } from "../src/auth/auth-context";
import { MobileRestrictedUserDashboardWorkspace } from "../src/components/mobile-restricted-user-dashboard-workspace";
import { MobileUserTestWorkspace } from "../src/components/mobile-user-test-workspace";

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
  const showRestrictedDashboard = !session || session.role === "user";

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.screen}>
        <View style={styles.headerBlock}>
          <Text style={styles.eyebrow}>User workspace</Text>
          <Text style={styles.title}>User dashboard</Text>
          <Text style={styles.copy}>
            This is the landing screen for normal users after sign-up or sign-in.
          </Text>
          <Text style={styles.copy}>
            {authConfigured ? `Signed in as ${session ? getSessionIdentifier(session) ?? "user" : "user"}` : "Auth setup pending. User space is open for feature work."}
          </Text>
          {authConfigured ? (
            <Text style={styles.signOut} onPress={() => void signOut()}>
              Sign out
            </Text>
          ) : null}
        </View>
        {showRestrictedDashboard ? (
          <MobileRestrictedUserDashboardWorkspace currentUserIdentifier={currentIdentifier} />
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