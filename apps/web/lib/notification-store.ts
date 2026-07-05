import "server-only";

import { createEntityId } from "@trapit/testing";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const DEFAULT_PRODUCTION_DATA_DIR = path.join(path.sep, "var", "lib", "trapit");

export type StoredPushToken = {
  createdAt: string;
  deviceName: string | null;
  id: string;
  lastSeenAt: string;
  platform: "android" | "ios" | "unknown";
  token: string;
  userIdentifier: string | null;
  userSub: string | null;
};

export type StoredWebPushSubscription = {
  createdAt: string;
  endpoint: string;
  id: string;
  keys: {
    auth: string;
    p256dh: string;
  };
  lastSeenAt: string;
  userAgent: string | null;
  userIdentifier: string | null;
  userSub: string | null;
};

type NotificationDelivery = {
  deliveredAt: string;
  key: string;
  tokenId: string;
};

type NotificationState = {
  deliveries: NotificationDelivery[];
  pushTokens: StoredPushToken[];
  webPushSubscriptions: StoredWebPushSubscription[];
};

function normalizePlatform(value: unknown): StoredPushToken["platform"] {
  return value === "android" || value === "ios" ? value : "unknown";
}

function resolveStorePath() {
  const configuredFilePath = process.env.TRAPIT_NOTIFICATION_FILE?.trim();

  if (configuredFilePath) {
    return configuredFilePath;
  }

  const configuredDataDir = process.env.TRAPIT_DATA_DIR?.trim();

  if (configuredDataDir) {
    return path.join(configuredDataDir, "notification-state.json");
  }

  return process.env.NODE_ENV === "production"
    ? path.join(DEFAULT_PRODUCTION_DATA_DIR, "notification-state.json")
    : path.join(process.cwd(), "data", "notification-state.json");
}

const STORE_PATH = resolveStorePath();

async function ensureStoreDirectory() {
  await mkdir(path.dirname(STORE_PATH), { recursive: true });
}

function normalizeState(parsed: Partial<NotificationState>): NotificationState {
  return {
    deliveries: (parsed.deliveries ?? []).map((delivery) => ({
      deliveredAt: delivery.deliveredAt ?? new Date().toISOString(),
      key: delivery.key ?? "",
      tokenId: delivery.tokenId ?? "",
    })).filter((delivery) => delivery.key && delivery.tokenId),
    pushTokens: (parsed.pushTokens ?? []).map((pushToken) => ({
      createdAt: pushToken.createdAt ?? new Date().toISOString(),
      deviceName: pushToken.deviceName?.trim() || null,
      id: pushToken.id ?? createEntityId("push-token"),
      lastSeenAt: pushToken.lastSeenAt ?? new Date().toISOString(),
      platform: normalizePlatform(pushToken.platform),
      token: pushToken.token ?? "",
      userIdentifier: pushToken.userIdentifier?.trim() || null,
      userSub: pushToken.userSub?.trim() || null,
    })).filter((pushToken) => pushToken.token),
    webPushSubscriptions: (parsed.webPushSubscriptions ?? []).map((subscription) => ({
      createdAt: subscription.createdAt ?? new Date().toISOString(),
      endpoint: subscription.endpoint ?? "",
      id: subscription.id ?? createEntityId("web-push-subscription"),
      keys: {
        auth: subscription.keys?.auth ?? "",
        p256dh: subscription.keys?.p256dh ?? "",
      },
      lastSeenAt: subscription.lastSeenAt ?? new Date().toISOString(),
      userAgent: subscription.userAgent?.trim() || null,
      userIdentifier: subscription.userIdentifier?.trim() || null,
      userSub: subscription.userSub?.trim() || null,
    })).filter((subscription) => subscription.endpoint && subscription.keys.auth && subscription.keys.p256dh),
  };
}

async function readState() {
  try {
    const rawValue = await readFile(STORE_PATH, "utf8");
    return normalizeState(JSON.parse(rawValue) as Partial<NotificationState>);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      const state = normalizeState({});
      await writeState(state);
      return state;
    }

    throw error;
  }
}

async function writeState(state: NotificationState) {
  await ensureStoreDirectory();
  await writeFile(STORE_PATH, JSON.stringify(state, null, 2), "utf8");
}

export function isExpoPushToken(value: string) {
  return /^Expo(nent)?PushToken\[[^\]]+\]$/.test(value.trim());
}

export async function upsertPushToken(input: {
  deviceName?: string | null;
  platform?: string | null;
  token: string;
  userIdentifier: string | null;
  userSub: string | null;
}) {
  const token = input.token.trim();

  if (!isExpoPushToken(token)) {
    throw new Error("A valid Expo push token is required.");
  }

  const state = await readState();
  const timestamp = new Date().toISOString();
  const existingToken = state.pushTokens.find((entry) => entry.token === token);

  if (existingToken) {
    existingToken.deviceName = input.deviceName?.trim() || existingToken.deviceName;
    existingToken.lastSeenAt = timestamp;
    existingToken.platform = normalizePlatform(input.platform ?? existingToken.platform);
    existingToken.userIdentifier = input.userIdentifier?.trim() || existingToken.userIdentifier;
    existingToken.userSub = input.userSub?.trim() || existingToken.userSub;
    await writeState(state);
    return existingToken;
  }

  const nextToken: StoredPushToken = {
    createdAt: timestamp,
    deviceName: input.deviceName?.trim() || null,
    id: createEntityId("push-token"),
    lastSeenAt: timestamp,
    platform: normalizePlatform(input.platform),
    token,
    userIdentifier: input.userIdentifier?.trim() || null,
    userSub: input.userSub?.trim() || null,
  };

  state.pushTokens = [nextToken, ...state.pushTokens];
  await writeState(state);
  return nextToken;
}

export async function listPushTokens() {
  const state = await readState();
  return state.pushTokens;
}

export async function upsertWebPushSubscription(input: {
  endpoint: string;
  keys: {
    auth?: string;
    p256dh?: string;
  };
  userAgent?: string | null;
  userIdentifier: string | null;
  userSub: string | null;
}) {
  const endpoint = input.endpoint.trim();
  const auth = input.keys.auth?.trim() ?? "";
  const p256dh = input.keys.p256dh?.trim() ?? "";

  if (!endpoint || !auth || !p256dh) {
    throw new Error("A valid web push subscription is required.");
  }

  const state = await readState();
  const timestamp = new Date().toISOString();
  const existingSubscription = state.webPushSubscriptions.find((entry) => entry.endpoint === endpoint);

  if (existingSubscription) {
    existingSubscription.keys = { auth, p256dh };
    existingSubscription.lastSeenAt = timestamp;
    existingSubscription.userAgent = input.userAgent?.trim() || existingSubscription.userAgent;
    existingSubscription.userIdentifier = input.userIdentifier?.trim() || existingSubscription.userIdentifier;
    existingSubscription.userSub = input.userSub?.trim() || existingSubscription.userSub;
    await writeState(state);
    return existingSubscription;
  }

  const nextSubscription: StoredWebPushSubscription = {
    createdAt: timestamp,
    endpoint,
    id: createEntityId("web-push-subscription"),
    keys: { auth, p256dh },
    lastSeenAt: timestamp,
    userAgent: input.userAgent?.trim() || null,
    userIdentifier: input.userIdentifier?.trim() || null,
    userSub: input.userSub?.trim() || null,
  };

  state.webPushSubscriptions = [nextSubscription, ...state.webPushSubscriptions];
  await writeState(state);
  return nextSubscription;
}

export async function listWebPushSubscriptions() {
  const state = await readState();
  return state.webPushSubscriptions;
}

export async function hasNotificationDelivery(key: string, tokenId: string) {
  const state = await readState();
  return state.deliveries.some((delivery) => delivery.key === key && delivery.tokenId === tokenId);
}

export async function recordNotificationDelivery(key: string, tokenId: string) {
  const state = await readState();

  if (state.deliveries.some((delivery) => delivery.key === key && delivery.tokenId === tokenId)) {
    return;
  }

  state.deliveries = [
    {
      deliveredAt: new Date().toISOString(),
      key,
      tokenId,
    },
    ...state.deliveries,
  ].slice(0, 5000);
  await writeState(state);
}