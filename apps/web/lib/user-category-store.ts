import "server-only";

import {
  createEntityId,
} from "@trapit/testing";
import {
  defaultNormalUserCategory,
  findNextNormalUserCategory,
  getNormalUserCategoryDefinition,
  normalUserCategoryDefinitions,
  normalUserCategoryLabels,
  orderedNormalUserCategories,
  type AuthSession,
  type NormalUserCategory,
} from "@trapit/auth";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const DEFAULT_PRODUCTION_DATA_DIR = path.join(path.sep, "var", "lib", "trapit");

type UserCategoryAssignmentStatus = "active" | "expired" | "replaced";
type UserCategoryRequestStatus = "accepted" | "pending" | "rejected";

export type StoredUserCategoryAssignment = {
  assignedAt: string;
  assignedByDisplayName: string | null;
  assignedByIdentifier: string | null;
  category: NormalUserCategory;
  expiresAt: string | null;
  id: string;
  reason: "manual" | "upgrade-request";
  status: UserCategoryAssignmentStatus;
  userIdentifier: string | null;
  userSub: string | null;
};

export type StoredUserCategoryUpgradeRequest = {
  approvedDurationMonths: 3 | 12 | null;
  currentCategory: NormalUserCategory;
  id: string;
  requestedAt: string;
  requestedCategory: NormalUserCategory;
  requesterDisplayName: string | null;
  requesterIdentifier: string | null;
  requesterSub: string | null;
  resolvedAt: string | null;
  reviewerDisplayName: string | null;
  reviewerIdentifier: string | null;
  status: UserCategoryRequestStatus;
};

type UserCategoryState = {
  assignments: StoredUserCategoryAssignment[];
  requests: StoredUserCategoryUpgradeRequest[];
};

export type UserCategoryPlanSummary = {
  category: NormalUserCategory;
  definition: (typeof normalUserCategoryDefinitions)[NormalUserCategory];
  isCurrent: boolean;
  label: string;
};

function resolveStorePath() {
  const configuredFilePath = process.env.TRAPIT_USER_CATEGORY_FILE?.trim();

  if (configuredFilePath) {
    return configuredFilePath;
  }

  const configuredDataDir = process.env.TRAPIT_DATA_DIR?.trim();

  if (configuredDataDir) {
    return path.join(configuredDataDir, "user-category-state.json");
  }

  return process.env.NODE_ENV === "production"
    ? path.join(DEFAULT_PRODUCTION_DATA_DIR, "user-category-state.json")
    : path.join(process.cwd(), "data", "user-category-state.json");
}

const STORE_PATH = resolveStorePath();

function normalizeIdentifier(value: string | null | undefined) {
  return value?.trim().toLowerCase() ?? "";
}

async function ensureStoreDirectory() {
  await mkdir(path.dirname(STORE_PATH), { recursive: true });
}

function normalizeState(parsed: Partial<UserCategoryState>): UserCategoryState {
  return {
    assignments: (parsed.assignments ?? []).map((assignment) => ({
      assignedAt: assignment.assignedAt ?? new Date().toISOString(),
      assignedByDisplayName: assignment.assignedByDisplayName?.trim() || null,
      assignedByIdentifier: assignment.assignedByIdentifier?.trim() || null,
      category: assignment.category ?? defaultNormalUserCategory,
      expiresAt: assignment.expiresAt ?? null,
      id: assignment.id ?? createEntityId("user-category-assignment"),
      reason: assignment.reason ?? "manual",
      status: assignment.status ?? "active",
      userIdentifier: assignment.userIdentifier?.trim() || null,
      userSub: assignment.userSub?.trim() || null,
    })),
    requests: (parsed.requests ?? []).map((request) => ({
      approvedDurationMonths:
        request.approvedDurationMonths === 3 || request.approvedDurationMonths === 12
          ? request.approvedDurationMonths
          : null,
      currentCategory: request.currentCategory ?? defaultNormalUserCategory,
      id: request.id ?? createEntityId("user-category-request"),
      requestedAt: request.requestedAt ?? new Date().toISOString(),
      requestedCategory: request.requestedCategory ?? defaultNormalUserCategory,
      requesterDisplayName: request.requesterDisplayName?.trim() || null,
      requesterIdentifier: request.requesterIdentifier?.trim() || null,
      requesterSub: request.requesterSub?.trim() || null,
      resolvedAt: request.resolvedAt ?? null,
      reviewerDisplayName: request.reviewerDisplayName?.trim() || null,
      reviewerIdentifier: request.reviewerIdentifier?.trim() || null,
      status: request.status ?? "pending",
    })),
  };
}

async function writeState(state: UserCategoryState) {
  await ensureStoreDirectory();
  await writeFile(STORE_PATH, JSON.stringify(state, null, 2), "utf8");
}

function matchesUser(
  record: Pick<StoredUserCategoryAssignment, "userIdentifier" | "userSub"> | Pick<StoredUserCategoryUpgradeRequest, "requesterIdentifier" | "requesterSub">,
  user: { identifier?: string | null; sub?: string | null },
) {
  const userSub = user.sub?.trim() ?? "";

  if (userSub) {
    if ("userSub" in record) {
      return (record.userSub ?? "") === userSub;
    }

    return (record.requesterSub ?? "") === userSub;
  }

  const targetIdentifier = normalizeIdentifier(user.identifier);

  if (!targetIdentifier) {
    return false;
  }

  if ("userIdentifier" in record) {
    return normalizeIdentifier(record.userIdentifier) === targetIdentifier;
  }

  return normalizeIdentifier(record.requesterIdentifier) === targetIdentifier;
}

function applyAssignmentExpiry(state: UserCategoryState) {
  const now = Date.now();
  let didChange = false;

  state.assignments = state.assignments.map((assignment) => {
    if (assignment.status !== "active" || !assignment.expiresAt) {
      return assignment;
    }

    if (new Date(assignment.expiresAt).getTime() > now) {
      return assignment;
    }

    didChange = true;

    return {
      ...assignment,
      status: "expired",
    };
  });

  return didChange;
}

async function readState() {
  try {
    const rawValue = await readFile(STORE_PATH, "utf8");
    const state = normalizeState(JSON.parse(rawValue) as Partial<UserCategoryState>);
    const didChange = applyAssignmentExpiry(state);

    if (didChange) {
      await writeState(state);
    }

    return state;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      const state = normalizeState({});
      await writeState(state);
      return state;
    }

    throw error;
  }
}

function findLatestActiveAssignment(
  state: UserCategoryState,
  user: { identifier?: string | null; sub?: string | null },
) {
  return state.assignments
    .filter((assignment) => assignment.status === "active")
    .filter((assignment) => matchesUser(assignment, user))
    .sort((leftAssignment, rightAssignment) =>
      new Date(rightAssignment.assignedAt).getTime() - new Date(leftAssignment.assignedAt).getTime(),
    )[0] ?? null;
}

function createPlanSummaries(currentCategory: NormalUserCategory): UserCategoryPlanSummary[] {
  return orderedNormalUserCategories.map((category) => ({
    category,
    definition: getNormalUserCategoryDefinition(category),
    isCurrent: category === currentCategory,
    label: normalUserCategoryLabels[category],
  }));
}

export async function resolveAssignedCategoryForSession(session: AuthSession) {
  const state = await readState();
  const assignment = findLatestActiveAssignment(state, {
    identifier: session.displayIdentifier,
    sub: session.sub,
  });

  return assignment?.category ?? session.userCategory ?? defaultNormalUserCategory;
}

export async function getUserCategorySnapshot(input: {
  identifier: string | null;
  currentCategory: NormalUserCategory;
  displayName: string | null;
  sub: string | null;
}) {
  const state = await readState();
  const requests = state.requests
    .filter((request) => matchesUser(request, input))
    .sort((leftRequest, rightRequest) =>
      new Date(rightRequest.requestedAt).getTime() - new Date(leftRequest.requestedAt).getTime(),
    );
  const activeAssignment = findLatestActiveAssignment(state, input);

  return {
    activeAssignment,
    availableCategories: createPlanSummaries(input.currentCategory),
    currentCategory: input.currentCategory,
    currentCategoryLabel: normalUserCategoryLabels[input.currentCategory],
    requests,
  };
}

export async function createUserCategoryUpgradeRequest(input: {
  currentCategory: NormalUserCategory;
  displayName: string | null;
  identifier: string | null;
  requestedCategory: NormalUserCategory;
  sub: string | null;
}) {
  if (!input.identifier?.trim() && !input.sub?.trim()) {
    throw new Error("A signed-in user identifier is required to send an upgrade request.");
  }

  if (input.requestedCategory === input.currentCategory) {
    throw new Error("You are already using this category.");
  }

  const currentCategoryIndex = orderedNormalUserCategories.indexOf(input.currentCategory);
  const requestedCategoryIndex = orderedNormalUserCategories.indexOf(input.requestedCategory);

  if (requestedCategoryIndex <= currentCategoryIndex) {
    throw new Error("Select a higher category before sending an upgrade request.");
  }

  const state = await readState();
  const hasPendingRequest = state.requests.some(
    (request) => request.status === "pending" && matchesUser(request, input),
  );

  if (hasPendingRequest) {
    throw new Error("An upgrade request is already pending review.");
  }

  const nextRequest: StoredUserCategoryUpgradeRequest = {
    approvedDurationMonths: null,
    currentCategory: input.currentCategory,
    id: createEntityId("user-category-request"),
    requestedAt: new Date().toISOString(),
    requestedCategory: input.requestedCategory,
    requesterDisplayName: input.displayName?.trim() || null,
    requesterIdentifier: input.identifier?.trim() || null,
    requesterSub: input.sub?.trim() || null,
    resolvedAt: null,
    reviewerDisplayName: null,
    reviewerIdentifier: null,
    status: "pending",
  };

  state.requests = [nextRequest, ...state.requests];
  await writeState(state);

  return getUserCategorySnapshot({
    currentCategory: input.currentCategory,
    displayName: input.displayName,
    identifier: input.identifier,
    sub: input.sub,
  });
}

function replaceActiveAssignmentsForUser(
  state: UserCategoryState,
  user: { identifier?: string | null; sub?: string | null },
) {
  state.assignments = state.assignments.map((assignment) =>
    assignment.status === "active" && matchesUser(assignment, user)
      ? {
          ...assignment,
          status: "replaced",
        }
      : assignment,
  );
}

export async function assignUserCategory(input: {
  assignedByDisplayName: string | null;
  assignedByIdentifier: string | null;
  category: NormalUserCategory;
  durationMonths: 3 | 12 | null;
  reason: "manual" | "upgrade-request";
  userIdentifier: string | null;
  userSub: string | null;
}) {
  const state = await readState();

  replaceActiveAssignmentsForUser(state, {
    identifier: input.userIdentifier,
    sub: input.userSub,
  });

  if (input.category !== defaultNormalUserCategory) {
    const assignedAt = new Date();
    const expiresAt = new Date(assignedAt);

    if (input.durationMonths) {
      expiresAt.setMonth(expiresAt.getMonth() + input.durationMonths);
    }

    state.assignments = [
      {
        assignedAt: assignedAt.toISOString(),
        assignedByDisplayName: input.assignedByDisplayName?.trim() || null,
        assignedByIdentifier: input.assignedByIdentifier?.trim() || null,
        category: input.category,
        expiresAt: input.durationMonths ? expiresAt.toISOString() : null,
        id: createEntityId("user-category-assignment"),
        reason: input.reason,
        status: "active",
        userIdentifier: input.userIdentifier?.trim() || null,
        userSub: input.userSub?.trim() || null,
      },
      ...state.assignments,
    ];
  }

  await writeState(state);
}

export async function resolveUserCategoryUpgradeRequest(input: {
  decision: "accept" | "reject";
  durationMonths: 3 | 12 | null;
  reviewerDisplayName: string | null;
  reviewerIdentifier: string | null;
  requestId: string;
}) {
  const state = await readState();
  const request = state.requests.find((entry) => entry.id === input.requestId);

  if (!request) {
    throw new Error("Upgrade request not found.");
  }

  if (request.status !== "pending") {
    throw new Error("This upgrade request has already been reviewed.");
  }

  if (input.decision === "accept" && !input.durationMonths) {
    throw new Error("Choose 3 months or 1 year before accepting the request.");
  }

  const resolvedAt = new Date().toISOString();

  state.requests = state.requests.map((entry) =>
    entry.id === input.requestId
      ? {
          ...entry,
          approvedDurationMonths: input.decision === "accept" ? input.durationMonths : null,
          resolvedAt,
          reviewerDisplayName: input.reviewerDisplayName?.trim() || null,
          reviewerIdentifier: input.reviewerIdentifier?.trim() || null,
          status: input.decision === "accept" ? "accepted" : "rejected",
        }
      : entry,
  );

  await writeState(state);

  if (input.decision === "accept") {
    await assignUserCategory({
      assignedByDisplayName: input.reviewerDisplayName,
      assignedByIdentifier: input.reviewerIdentifier,
      category: request.requestedCategory,
      durationMonths: input.durationMonths,
      reason: "upgrade-request",
      userIdentifier: request.requesterIdentifier,
      userSub: request.requesterSub,
    });
  }

  return listUserCategoryManagementState();
}

export async function listActiveUserCategoryAssignments() {
  const state = await readState();

  return state.assignments.filter((assignment) => assignment.status === "active");
}

export async function listUserCategoryManagementState() {
  const state = await readState();
  const activeAssignments = state.assignments.filter((assignment) => assignment.status === "active");

  return {
    activeAssignments,
    requests: [...state.requests].sort((leftRequest, rightRequest) =>
      new Date(rightRequest.requestedAt).getTime() - new Date(leftRequest.requestedAt).getTime(),
    ),
  };
}

export function getUpgradeTargetCategory(
  currentCategory: NormalUserCategory,
  predicate: (definition: ReturnType<typeof getNormalUserCategoryDefinition>) => boolean,
) {
  return findNextNormalUserCategory(currentCategory, (candidate) => predicate(getNormalUserCategoryDefinition(candidate)));
}