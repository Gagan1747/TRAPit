import "server-only";

import { createEntityId } from "@trapit/testing";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
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
  browserVersion?: number;
  browserBaseline?: boolean;
  browserObserved?: string[];
  browserIntents?: BrowserNotificationIntent[];
  deliveries: NotificationDelivery[];
  pushTokens: StoredPushToken[];
  webPushSubscriptions: StoredWebPushSubscription[];
};

export type BrowserSchedule = {
  kind: "test" | "poll";
  id: string;
  startsAt: string;
  endsAt: string;
  recipients: string[];
};

export type BrowserNotificationIntent = {
  key: string;
  instanceKey: string;
  recipientIdentifier: string;
  kind: "test" | "poll";
  entityId: string;
  phase: "confirmed" | "30min" | "1min";
  dueAt: string;
};

const queueGlobal = globalThis as typeof globalThis & { trapitNotificationQueues?: Map<string, Promise<unknown>> };
const queues = queueGlobal.trapitNotificationQueues ??= new Map();
function serialized<T>(operation: () => Promise<T>): Promise<T> {
  const result = (queues.get(STORE_PATH) ?? Promise.resolve()).then(operation);
  queues.set(STORE_PATH, result.then(() => undefined, () => undefined));
  return result;
}

export function browserScheduleInstanceKey(schedule: BrowserSchedule) {
  return `${schedule.kind}:${schedule.id}:${schedule.startsAt}`;
}

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
    browserVersion: parsed.browserVersion,
    browserBaseline: parsed.browserBaseline === true,
    browserObserved: parsed.browserObserved ?? [],
    browserIntents: parsed.browserIntents ?? [],
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
  const stagingPath = `${STORE_PATH}.${process.pid}.tmp`;
  await writeFile(stagingPath, JSON.stringify(state, null, 2), "utf8");
  await rename(stagingPath, STORE_PATH);
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
  return serialized(() => upsertPushTokenUnqueued(input));
}

async function upsertPushTokenUnqueued(input: {
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
  return serialized(async () => (await readState()).pushTokens);
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
  return serialized(() => upsertWebPushSubscriptionUnqueued(input));
}

async function upsertWebPushSubscriptionUnqueued(input: {
  endpoint: string;
  keys: { auth?: string; p256dh?: string };
  userAgent?: string | null;
  userIdentifier: string | null;
  userSub: string | null;
}) {
  const endpoint = input.endpoint.trim();
  const auth = input.keys.auth?.trim() ?? "";
  const p256dh = input.keys.p256dh?.trim() ?? "";

  if (!endpoint || !auth || !p256dh || !input.userSub?.trim() || !input.userIdentifier?.trim()) {
    throw new Error("A valid web push subscription is required.");
  }

  const state = await readState();
  const timestamp = new Date().toISOString();
  const existingSubscription = state.webPushSubscriptions.find((entry) => entry.endpoint === endpoint);

  if (existingSubscription) {
    if (existingSubscription.userSub !== input.userSub?.trim()
      || existingSubscription.userIdentifier !== input.userIdentifier?.trim()) {
      existingSubscription.id = createEntityId("web-push-subscription");
    }
    existingSubscription.keys = { auth, p256dh };
    existingSubscription.lastSeenAt = timestamp;
    existingSubscription.userAgent = input.userAgent?.trim() || existingSubscription.userAgent;
    existingSubscription.userIdentifier = input.userIdentifier.trim();
    existingSubscription.userSub = input.userSub.trim();
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
  return serialized(async () => (await readState()).webPushSubscriptions);
}

export async function hasNotificationDelivery(key: string, tokenId: string) {
  return serialized(async () => (await readState()).deliveries.some((delivery) => delivery.key === key && delivery.tokenId === tokenId));
}

export async function recordNotificationDelivery(key: string, tokenId: string) {
  return serialized(() => recordNotificationDeliveryUnqueued(key, tokenId));
}

async function recordNotificationDeliveryUnqueued(key: string, tokenId: string) {
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
  ];
  await writeState(state);
}

export async function removeWebPushSubscription(id: string) {
  return serialized(async () => {
    const state = await readState();
    state.webPushSubscriptions = state.webPushSubscriptions.filter((entry) => entry.id !== id);
    await writeState(state);
  });
}

export async function removeOwnedWebPushSubscription(endpoint: string, userSub: string) {
  return serialized(async () => {
    const state = await readState();
    state.webPushSubscriptions = state.webPushSubscriptions.filter((entry) => entry.endpoint !== endpoint || entry.userSub !== userSub);
    await writeState(state);
  });
}

export async function reconcileBrowserNotificationIntents(schedules: BrowserSchedule[], now = Date.now()) {
  return serialized(async () => {
    const state = await readState();
    // Upgrades baseline current schedules and discard obsolete 15-minute/at-start alerts.
    const baseline = state.browserVersion !== 2;
    const observed = new Set(baseline ? [] : state.browserObserved);
    const intents = new Map((baseline ? [] : state.browserIntents ?? [])
      .filter((entry) => ["confirmed", "30min", "1min"].includes(entry.phase))
      .map((entry) => [entry.key, entry]));
    const eligible = new Set<string>();
    for (const schedule of schedules) {
      if (!Number.isFinite(Date.parse(schedule.startsAt)) || !Number.isFinite(Date.parse(schedule.endsAt)) || Date.parse(schedule.endsAt) <= now) continue;
      const instanceKey = browserScheduleInstanceKey(schedule);
      for (const recipientIdentifier of new Set(schedule.recipients.map((value) => value.trim().toLowerCase()).filter(Boolean))) {
        const recipientKey = `${instanceKey}:${recipientIdentifier}`;
        eligible.add(recipientKey);
        if (!observed.has(recipientKey)) {
          const start = Date.parse(schedule.startsAt);
          const phases: Array<[BrowserNotificationIntent["phase"], number]> = [
            ["30min", start - 30 * 60_000],
            ["1min", start - 60_000],
          ];
          if (!baseline) phases.unshift(["confirmed", now]);
          for (const [phase, due] of phases) {
            // A late creation/share must not backfill already elapsed reminder phases.
            if (phase !== "confirmed" && due < now) continue;
            const key = `browser:${recipientKey}:${phase}`;
            intents.set(key, { key, instanceKey, recipientIdentifier, kind: schedule.kind, entityId: schedule.id, phase, dueAt: new Date(due).toISOString() });
          }
        }
        observed.add(recipientKey);
      }
    }
    state.browserBaseline = true;
    state.browserVersion = 2;
    state.browserObserved = [...observed];
    state.browserIntents = [...intents.values()].filter((entry) => eligible.has(`${entry.instanceKey}:${entry.recipientIdentifier}`));
    await writeState(state);
    return state.browserIntents.filter((entry) => {
      const schedule = schedules.find((item) => browserScheduleInstanceKey(item) === entry.instanceKey)!;
      const start = Date.parse(schedule.startsAt);
      return now >= Date.parse(entry.dueAt) && (entry.phase === "confirmed" || now < start);
    });
  });
}