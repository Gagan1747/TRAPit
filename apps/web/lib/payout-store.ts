import "server-only";

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

const DEFAULT_PRODUCTION_DATA_DIR = path.join(path.sep, "var", "lib", "trapit");

export type UserPayoutAccountStatus = "created" | "onboarding" | "verified";

/**
 * Security Note:
 * Raw bank account numbers, IFSC codes, PAN numbers, UPI IDs, and sensitive banking credentials
 * are NEVER stored on TRAPit servers. Only the unique Razorpay linked account identifier (`acc_...`)
 * is persisted and mapped to the user's account.
 */
export type UserPayoutAccountRecord = {
  createdAt: string;
  linkedAccountId: string;
  status: UserPayoutAccountStatus;
  updatedAt: string;
  userIdentifier: string | null;
  userSub: string | null;
};

type PayoutStoreState = {
  accounts: UserPayoutAccountRecord[];
};

const queueGlobal = globalThis as typeof globalThis & { trapitPayoutQueues?: Map<string, Promise<unknown>> };
const queues = (queueGlobal.trapitPayoutQueues ??= new Map());

function resolveStorePath() {
  const configuredFilePath = process.env.TRAPIT_PAYOUT_FILE?.trim();
  if (configuredFilePath) {
    return configuredFilePath;
  }

  const configuredDataDir = process.env.TRAPIT_DATA_DIR?.trim();
  if (configuredDataDir) {
    return path.join(configuredDataDir, "payout-state.json");
  }

  return process.env.NODE_ENV === "production"
    ? path.join(DEFAULT_PRODUCTION_DATA_DIR, "payout-state.json")
    : path.join(process.cwd(), "data", "payout-state.json");
}

const STORE_PATH = resolveStorePath();

function serialized<T>(operation: () => Promise<T>): Promise<T> {
  const result = (queues.get(STORE_PATH) ?? Promise.resolve()).then(operation);
  queues.set(
    STORE_PATH,
    result.then(
      () => undefined,
      () => undefined,
    ),
  );
  return result;
}

function normalizeIdentifier(value: string | null | undefined) {
  return (value ?? "").trim().toLowerCase().replace(/[\s()-]/g, "");
}

function identifiersMatch(left: string | null | undefined, right: string | null | undefined) {
  const a = normalizeIdentifier(left);
  const b = normalizeIdentifier(right);
  if (!a || !b) return false;
  if (a === b) return true;
  const digitsA = a.replace(/\D/g, "");
  const digitsB = b.replace(/\D/g, "");
  return digitsA.length >= 10 && digitsB.length >= 10 && digitsA.slice(-10) === digitsB.slice(-10);
}

function isValidLinkedAccountId(value: string | null | undefined): boolean {
  const trimmed = (value ?? "").trim();
  return /^acc_[A-Za-z0-9]{6,32}$/.test(trimmed);
}

function normalizeState(parsed: Partial<PayoutStoreState>): PayoutStoreState {
  return {
    accounts: (parsed.accounts ?? [])
      .filter((entry) => entry && isValidLinkedAccountId(entry.linkedAccountId))
      .map((entry) => ({
        createdAt: entry.createdAt ?? new Date().toISOString(),
        linkedAccountId: entry.linkedAccountId.trim(),
        status:
          entry.status === "verified" || entry.status === "onboarding"
            ? entry.status
            : "created",
        updatedAt: entry.updatedAt ?? entry.createdAt ?? new Date().toISOString(),
        userIdentifier: entry.userIdentifier?.trim() || null,
        userSub: entry.userSub?.trim() || null,
      })),
  };
}

async function readState(): Promise<PayoutStoreState> {
  try {
    const raw = await readFile(STORE_PATH, "utf8");
    return normalizeState(JSON.parse(raw) as Partial<PayoutStoreState>);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { accounts: [] };
    }
    throw error;
  }
}

async function writeState(state: PayoutStoreState) {
  await mkdir(path.dirname(STORE_PATH), { recursive: true });
  const stagingPath = `${STORE_PATH}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(stagingPath, JSON.stringify(state, null, 2), "utf8");
  await rename(stagingPath, STORE_PATH);
}

export async function getPayoutAccountForUser(input: {
  userIdentifier?: string | null;
  userSub?: string | null;
}): Promise<UserPayoutAccountRecord | null> {
  return serialized(async () => {
    const state = await readState();
    const sub = input.userSub?.trim() || null;
    const identifier = input.userIdentifier?.trim() || null;

    return (
      state.accounts.find(
        (entry) =>
          (sub && entry.userSub === sub)
          || (identifier && identifiersMatch(entry.userIdentifier, identifier)),
      ) ?? null
    );
  });
}

export async function saveLinkedAccountIdForUser(input: {
  linkedAccountId: string;
  status?: UserPayoutAccountStatus;
  userIdentifier?: string | null;
  userSub?: string | null;
}): Promise<UserPayoutAccountRecord> {
  const linkedAccountId = input.linkedAccountId.trim();
  if (!isValidLinkedAccountId(linkedAccountId)) {
    throw new Error("A valid Razorpay linked account ID (acc_...) is required.");
  }

  return serialized(async () => {
    const state = await readState();
    const now = new Date().toISOString();
    const sub = input.userSub?.trim() || null;
    const identifier = input.userIdentifier?.trim() || null;
    const existing = state.accounts.find(
      (entry) =>
        (sub && entry.userSub === sub)
        || (identifier && identifiersMatch(entry.userIdentifier, identifier)),
    );

    if (existing) {
      existing.linkedAccountId = linkedAccountId;
      existing.status = input.status ?? existing.status ?? "verified";
      existing.updatedAt = now;
      if (sub) existing.userSub = sub;
      if (identifier) existing.userIdentifier = identifier;
      await writeState(state);
      return existing;
    }

    const created: UserPayoutAccountRecord = {
      createdAt: now,
      linkedAccountId,
      status: input.status ?? "verified",
      updatedAt: now,
      userIdentifier: identifier,
      userSub: sub,
    };

    state.accounts = [created, ...state.accounts];
    await writeState(state);
    return created;
  });
}
