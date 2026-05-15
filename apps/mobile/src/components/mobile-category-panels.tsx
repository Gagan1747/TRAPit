import {
  normalUserCategoryDefinitions,
  orderedNormalUserCategories,
  type NormalUserCategory,
} from "@trapit/auth";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { isSuperAdminSession } from "../lib/privacy";
import { type MobileAuthSession } from "../auth/session";

type UserCategoryUpgradeRequest = {
  approvedDurationMonths: 3 | 12 | null;
  currentCategory: NormalUserCategory;
  id: string;
  requestedAt: string;
  requestedCategory: NormalUserCategory;
  requesterDisplayName: string | null;
  requesterIdentifier: string | null;
  status: "accepted" | "pending" | "rejected";
};

type UserCategoryPlan = {
  category: NormalUserCategory;
  isCurrent: boolean;
  label: string;
};

type UserCategorySnapshotResponse = {
  activeAssignment: {
    expiresAt: string | null;
    id: string;
  } | null;
  availableCategories: UserCategoryPlan[];
  currentCategory: NormalUserCategory;
  currentCategoryLabel: string;
  requests: UserCategoryUpgradeRequest[];
};

type SuperAdminCategoryManagementResponse = {
  managedUsers: Array<{
    currentCategory: NormalUserCategory;
    currentCategoryLabel: string;
    displayName: string | null;
    expiresAt: string | null;
    identifier: string;
    pendingRequest: UserCategoryUpgradeRequest | null;
    userSub: string | null;
  }>;
  requests: UserCategoryUpgradeRequest[];
};

function getApiBaseUrl() {
  return process.env.EXPO_PUBLIC_API_BASE_URL ?? "http://localhost:3000";
}

function formatShortDate(value: string) {
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
  }).format(new Date(value));
}

async function readAuthedJson<T>(session: MobileAuthSession, path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${getApiBaseUrl()}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${session.idToken}`,
      "Content-Type": "application/json",
      "X-TRAPit-Access-Token": session.accessToken,
      ...(init?.headers ?? {}),
    },
  });
  const payload = (await response.json().catch(() => null)) as T & { error?: string } | null;

  if (!response.ok) {
    throw new Error(payload?.error ?? "Request failed.");
  }

  return (payload ?? {}) as T;
}

function PlanFeatureLine({ label, value }: { label: string; value: string }) {
  return (
    <Text style={styles.planMeta}>
      <Text style={styles.planMetaLabel}>{label}: </Text>
      {value}
    </Text>
  );
}

export function MobileCategoryMembershipPanel({ session }: { session: MobileAuthSession }) {
  const [feedback, setFeedback] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [snapshot, setSnapshot] = useState<UserCategorySnapshotResponse | null>(null);

  useEffect(() => {
    let isMounted = true;

    void readAuthedJson<UserCategorySnapshotResponse>(session, "/api/user/category")
      .then((payload) => {
        if (isMounted) {
          setSnapshot(payload);
        }
      })
      .catch((error) => {
        if (isMounted) {
          setFeedback(error instanceof Error ? error.message : "Unable to load your plan details.");
        }
      })
      .finally(() => {
        if (isMounted) {
          setIsLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [session]);

  const pendingRequest = snapshot?.requests.find((request) => request.status === "pending") ?? null;
  const latestResolvedRequest = snapshot?.requests.find((request) => request.status !== "pending") ?? null;

  async function handleRequestUpgrade(category: NormalUserCategory) {
    try {
      const payload = await readAuthedJson<UserCategorySnapshotResponse>(session, "/api/user/category", {
        body: JSON.stringify({ requestedCategory: category }),
        method: "POST",
      });

      setSnapshot(payload);
      setFeedback("Upgrade request sent to the super admin for review.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to send the upgrade request.";
      setFeedback(message);
      Alert.alert("Upgrade request", message);
    }
  }

  if (session.role !== "user") {
    return null;
  }

  return (
    <View style={styles.panel}>
      <View style={styles.panelHeader}>
        <Text style={styles.eyebrow}>Membership</Text>
        <Text style={styles.title}>Choose your TRAPit plan</Text>
        <Text style={styles.copy}>
          Compare limits, see your current access window, and send the next upgrade request without leaving mobile.
        </Text>
      </View>

      {isLoading ? <ActivityIndicator color="#8e3f2c" /> : null}
      {snapshot ? (
        <>
          <View style={styles.bannerCard}>
            <Text style={styles.bannerTitle}>{snapshot.currentCategoryLabel}</Text>
            <Text style={styles.bannerCopy}>
              {pendingRequest
                ? `Upgrade request pending for ${normalUserCategoryDefinitions[pendingRequest.requestedCategory].label}.`
                : latestResolvedRequest
                  ? latestResolvedRequest.status === "accepted"
                    ? `Your request for ${normalUserCategoryDefinitions[latestResolvedRequest.requestedCategory].label} was approved.`
                    : `Your request for ${normalUserCategoryDefinitions[latestResolvedRequest.requestedCategory].label} was rejected.`
                  : "Your current plan is active across mobile and web."}
            </Text>
            {snapshot.activeAssignment?.expiresAt ? (
              <Text style={styles.bannerMeta}>Active access ends on {formatShortDate(snapshot.activeAssignment.expiresAt)}.</Text>
            ) : null}
          </View>

          <View style={styles.planStack}>
            {orderedNormalUserCategories.map((category) => {
              const definition = normalUserCategoryDefinitions[category];
              const isCurrent = snapshot.currentCategory === category;
              const isRequested = pendingRequest?.requestedCategory === category;
              const canRequest = orderedNormalUserCategories.indexOf(category) > orderedNormalUserCategories.indexOf(snapshot.currentCategory);

              return (
                <View key={category} style={[styles.planCard, isCurrent && styles.planCardActive]}>
                  <View style={styles.planHeader}>
                    <Text style={styles.planTitle}>{definition.label}</Text>
                    <Text style={styles.planBadge}>{isCurrent ? "Current" : isRequested ? "Pending" : "Available"}</Text>
                  </View>
                  <PlanFeatureLine label="Question pools" value={String(definition.test.maxQuestionPools)} />
                  <PlanFeatureLine label="Questions per pool" value={definition.test.maxQuestionsPerPool === null ? "Unlimited" : String(definition.test.maxQuestionsPerPool)} />
                  <PlanFeatureLine label="Scheduled tests / month" value={String(definition.test.maxScheduledTestsPerMonth)} />
                  <PlanFeatureLine label="Self tests / month" value={String(definition.test.maxSelfTestsPerMonth)} />
                  <PlanFeatureLine label="Poll scheduling" value={definition.poll.schedule ? "Included" : "Not included"} />
                  <PlanFeatureLine label="Group management" value={definition.group.manage ? "Included" : "Not included"} />
                  {!isCurrent && canRequest && !isRequested ? (
                    <Pressable style={styles.primaryButton} onPress={() => void handleRequestUpgrade(category)}>
                      <Text style={styles.primaryButtonText}>Request this upgrade</Text>
                    </Pressable>
                  ) : null}
                </View>
              );
            })}
          </View>
        </>
      ) : null}
      {feedback ? <Text style={styles.feedback}>{feedback}</Text> : null}
    </View>
  );
}

export function MobileCategoryApprovalPanel({ session }: { session: MobileAuthSession }) {
  const [assignmentCategory, setAssignmentCategory] = useState<NormalUserCategory>("trapit-normal");
  const [durationMonths, setDurationMonths] = useState<3 | 12>(3);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [management, setManagement] = useState<SuperAdminCategoryManagementResponse | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedIdentifier, setSelectedIdentifier] = useState("");

  useEffect(() => {
    if (!isSuperAdminSession(session)) {
      setIsLoading(false);
      return;
    }

    let isMounted = true;

    void readAuthedJson<SuperAdminCategoryManagementResponse>(session, "/api/admin/user-categories")
      .then((payload) => {
        if (isMounted) {
          setManagement(payload);
          setSelectedIdentifier(payload.managedUsers[0]?.identifier ?? "");
        }
      })
      .catch((error) => {
        if (isMounted) {
          setFeedback(error instanceof Error ? error.message : "Unable to load category approvals.");
        }
      })
      .finally(() => {
        if (isMounted) {
          setIsLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [session]);

  const pendingRequests = management?.requests.filter((request) => request.status === "pending") ?? [];
  const filteredUsers = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();

    if (!query) {
      return management?.managedUsers ?? [];
    }

    return (management?.managedUsers ?? []).filter((user) =>
      [user.identifier, user.displayName ?? "", user.userSub ?? ""].join(" ").toLowerCase().includes(query),
    );
  }, [management?.managedUsers, searchQuery]);

  async function refreshManagement() {
    const payload = await readAuthedJson<SuperAdminCategoryManagementResponse>(session, "/api/admin/user-categories");
    setManagement(payload);
    setSelectedIdentifier((current) => current || payload.managedUsers[0]?.identifier || "");
  }

  async function handleResolveRequest(requestId: string, decision: "accept" | "reject", requestDurationMonths?: 3 | 12) {
    try {
      const payload = await readAuthedJson<SuperAdminCategoryManagementResponse>(session, "/api/admin/user-categories", {
        body: JSON.stringify({
          decision,
          durationMonths: requestDurationMonths,
          mode: "resolve-request",
          requestId,
        }),
        method: "POST",
      });

      setManagement(payload);
      setFeedback(decision === "accept" ? "Upgrade request approved." : "Upgrade request rejected.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to update the request.";
      setFeedback(message);
      Alert.alert("Category approval", message);
    }
  }

  async function handleAssignCategory() {
    if (!selectedIdentifier.trim()) {
      setFeedback("Choose a user before applying a category.");
      return;
    }

    try {
      const selectedUser = management?.managedUsers.find((user) => user.identifier === selectedIdentifier) ?? null;
      const payload = await readAuthedJson<SuperAdminCategoryManagementResponse>(session, "/api/admin/user-categories", {
        body: JSON.stringify({
          category: assignmentCategory,
          durationMonths: assignmentCategory === "trapit-normal" ? null : durationMonths,
          mode: "assign-category",
          userIdentifier: selectedIdentifier,
          userSub: selectedUser?.userSub ?? null,
        }),
        method: "POST",
      });

      setManagement(payload);
      setFeedback("Category updated.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to update the category.";
      setFeedback(message);
      Alert.alert("Category update", message);
    }
  }

  if (!isSuperAdminSession(session)) {
    return null;
  }

  return (
    <View style={styles.panel}>
      <View style={styles.panelHeader}>
        <Text style={styles.eyebrow}>Super admin</Text>
        <Text style={styles.title}>Review category approvals</Text>
        <Text style={styles.copy}>
          Search for a user, apply a category directly, or clear the pending queue from the same mobile screen.
        </Text>
      </View>

      {isLoading ? <ActivityIndicator color="#8e3f2c" /> : null}
      <View style={styles.formCard}>
        <TextInput
          placeholder="Search by phone, name, or user id"
          placeholderTextColor="#8c7568"
          style={styles.input}
          value={searchQuery}
          onChangeText={setSearchQuery}
        />
        <View style={styles.selectionGrid}>
          {filteredUsers.slice(0, 8).map((user) => (
            <Pressable
              key={user.identifier}
              style={[styles.selectionChip, selectedIdentifier === user.identifier && styles.selectionChipActive]}
              onPress={() => setSelectedIdentifier(user.identifier)}
            >
              <Text style={[styles.selectionChipText, selectedIdentifier === user.identifier && styles.selectionChipTextActive]}>
                {user.displayName ? `${user.displayName} - ` : ""}{user.identifier}
              </Text>
            </Pressable>
          ))}
        </View>
        <Text style={styles.formLabel}>Assign category</Text>
        <View style={styles.selectionGrid}>
          {orderedNormalUserCategories.map((category) => (
            <Pressable
              key={category}
              style={[styles.selectionChip, assignmentCategory === category && styles.selectionChipActive]}
              onPress={() => setAssignmentCategory(category)}
            >
              <Text style={[styles.selectionChipText, assignmentCategory === category && styles.selectionChipTextActive]}>
                {normalUserCategoryDefinitions[category].label}
              </Text>
            </Pressable>
          ))}
        </View>
        {assignmentCategory !== "trapit-normal" ? (
          <View style={styles.inlineRow}>
            {[3, 12].map((option) => (
              <Pressable
                key={option}
                style={[styles.selectionChip, durationMonths === option && styles.selectionChipActive]}
                onPress={() => setDurationMonths(option as 3 | 12)}
              >
                <Text style={[styles.selectionChipText, durationMonths === option && styles.selectionChipTextActive]}>
                  {option === 12 ? "1 year" : "3 months"}
                </Text>
              </Pressable>
            ))}
          </View>
        ) : null}
        <Pressable style={styles.primaryButton} onPress={() => void handleAssignCategory()}>
          <Text style={styles.primaryButtonText}>Apply category</Text>
        </Pressable>
      </View>

      <View style={styles.planStack}>
        {pendingRequests.length === 0 ? (
          <Text style={styles.copy}>No pending upgrade requests right now.</Text>
        ) : (
          pendingRequests.map((request) => (
            <View key={request.id} style={styles.requestCard}>
              <Text style={styles.requestTitle}>{request.requesterDisplayName ?? request.requesterIdentifier ?? "Unknown user"}</Text>
              <Text style={styles.planMeta}>
                Wants {normalUserCategoryDefinitions[request.requestedCategory].label} from {normalUserCategoryDefinitions[request.currentCategory].label}
              </Text>
              <View style={styles.inlineRow}>
                <Pressable style={styles.secondaryButton} onPress={() => void handleResolveRequest(request.id, "accept", 3)}>
                  <Text style={styles.secondaryButtonText}>Approve 3 months</Text>
                </Pressable>
                <Pressable style={styles.secondaryButton} onPress={() => void handleResolveRequest(request.id, "accept", 12)}>
                  <Text style={styles.secondaryButtonText}>Approve 1 year</Text>
                </Pressable>
                <Pressable style={styles.secondaryButton} onPress={() => void handleResolveRequest(request.id, "reject")}>
                  <Text style={styles.secondaryButtonText}>Reject</Text>
                </Pressable>
              </View>
            </View>
          ))
        )}
      </View>

      <Pressable style={styles.ghostButton} onPress={() => void refreshManagement()}>
        <Text style={styles.ghostButtonText}>Refresh approvals</Text>
      </Pressable>
      {feedback ? <Text style={styles.feedback}>{feedback}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  bannerCard: {
    backgroundColor: "#f7ecdc",
    borderColor: "#d8b99e",
    borderRadius: 20,
    borderWidth: 1,
    gap: 8,
    padding: 18,
  },
  bannerCopy: {
    color: "#6d5a4e",
    fontSize: 14,
    lineHeight: 20,
  },
  bannerMeta: {
    color: "#8e3f2c",
    fontSize: 13,
    fontWeight: "700",
  },
  bannerTitle: {
    color: "#231712",
    fontSize: 20,
    fontWeight: "700",
  },
  copy: {
    color: "#6d5a4e",
    fontSize: 14,
    lineHeight: 21,
  },
  eyebrow: {
    color: "#8e3f2c",
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 2,
    textTransform: "uppercase",
  },
  feedback: {
    color: "#8e3f2c",
    fontSize: 14,
    lineHeight: 20,
  },
  formCard: {
    backgroundColor: "#f8efe3",
    borderColor: "#dcc2a7",
    borderRadius: 20,
    borderWidth: 1,
    gap: 12,
    padding: 18,
  },
  formLabel: {
    color: "#4b352d",
    fontSize: 14,
    fontWeight: "700",
  },
  ghostButton: {
    alignItems: "center",
    borderColor: "#8e3f2c",
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 10,
    alignSelf: "flex-start",
  },
  ghostButtonText: {
    color: "#8e3f2c",
    fontSize: 14,
    fontWeight: "700",
  },
  inlineRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  input: {
    backgroundColor: "#fffaf4",
    borderColor: "#dcc2a7",
    borderRadius: 14,
    borderWidth: 1,
    color: "#231712",
    fontSize: 15,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  panel: {
    backgroundColor: "#fff8ef",
    borderColor: "#d8b99e",
    borderRadius: 24,
    borderWidth: 1,
    gap: 16,
    padding: 20,
  },
  panelHeader: {
    gap: 8,
  },
  planBadge: {
    color: "#8e3f2c",
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
  },
  planCard: {
    backgroundColor: "#fffdf8",
    borderColor: "#e2ccba",
    borderRadius: 18,
    borderWidth: 1,
    gap: 8,
    padding: 16,
  },
  planCardActive: {
    borderColor: "#8e3f2c",
    shadowColor: "#8e3f2c",
    shadowOpacity: 0.08,
    shadowRadius: 12,
  },
  planHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 10,
  },
  planMeta: {
    color: "#6d5a4e",
    fontSize: 13,
    lineHeight: 19,
  },
  planMetaLabel: {
    color: "#4b352d",
    fontWeight: "700",
  },
  planStack: {
    gap: 12,
  },
  planTitle: {
    color: "#231712",
    flex: 1,
    fontSize: 16,
    fontWeight: "700",
  },
  primaryButton: {
    alignItems: "center",
    alignSelf: "flex-start",
    backgroundColor: "#8e3f2c",
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  primaryButtonText: {
    color: "#fff8ef",
    fontSize: 14,
    fontWeight: "700",
  },
  requestCard: {
    backgroundColor: "#fffdf8",
    borderColor: "#e2ccba",
    borderRadius: 18,
    borderWidth: 1,
    gap: 10,
    padding: 16,
  },
  requestTitle: {
    color: "#231712",
    fontSize: 16,
    fontWeight: "700",
  },
  secondaryButton: {
    alignItems: "center",
    backgroundColor: "#f1e0d0",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  secondaryButtonText: {
    color: "#4b352d",
    fontSize: 13,
    fontWeight: "700",
  },
  selectionChip: {
    backgroundColor: "#f4e6d7",
    borderColor: "#dcc2a7",
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  selectionChipActive: {
    backgroundColor: "#8e3f2c",
    borderColor: "#8e3f2c",
  },
  selectionChipText: {
    color: "#4b352d",
    fontSize: 13,
    fontWeight: "600",
  },
  selectionChipTextActive: {
    color: "#fff8ef",
  },
  selectionGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  title: {
    color: "#231712",
    fontSize: 24,
    fontWeight: "700",
  },
});