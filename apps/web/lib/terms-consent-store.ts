import "server-only";

import { getSessionIdentifier, type AuthSession } from "@trapit/auth";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

const DEFAULT_PRODUCTION_DATA_DIR = path.join(path.sep, "var", "lib", "trapit");
export const TERMS_CONSENT_VERSION = "2026-08-01";

type TermsConsentRecord = {
  acceptedAt: string;
  actorKey: string;
  version: string;
};

type TermsConsentState = {
  records: TermsConsentRecord[];
};

function resolveStorePath() {
  const configuredFilePath = process.env.TRAPIT_TERMS_CONSENT_FILE?.trim();

  if (configuredFilePath) {
    return configuredFilePath;
  }

  const configuredDataDir = process.env.TRAPIT_DATA_DIR?.trim();

  if (configuredDataDir) {
    return path.join(configuredDataDir, "terms-consent.json");
  }

  return process.env.NODE_ENV === "production"
    ? path.join(DEFAULT_PRODUCTION_DATA_DIR, "terms-consent.json")
    : path.join(process.cwd(), "data", "terms-consent.json");
}

const STORE_PATH = resolveStorePath();

function normalizeIdentifier(value: string | null | undefined) {
  return value?.trim().toLowerCase() || null;
}

function normalizePhone(value: string | null | undefined) {
  return value?.trim().replace(/[\s()-]/g, "").toLowerCase() || null;
}

function getSessionActorKeys(session: AuthSession) {
  const keys = new Set<string>();
  const sub = normalizeIdentifier(session.sub);
  const phoneNumber = normalizePhone(session.phoneNumber ?? getSessionIdentifier(session));
  const email = normalizeIdentifier(session.email);

  if (sub) {
    keys.add(`sub:${sub}`);
  }

  if (phoneNumber) {
    keys.add(`phone:${phoneNumber}`);
  }

  if (email) {
    keys.add(`email:${email}`);
  }

  return Array.from(keys);
}

function normalizeState(parsed: Partial<TermsConsentState>): TermsConsentState {
  return {
    records: (parsed.records ?? [])
      .map((record) => ({
        acceptedAt: record.acceptedAt ?? new Date().toISOString(),
        actorKey: record.actorKey?.trim() ?? "",
        version: record.version ?? "",
      }))
      .filter((record) => record.actorKey && record.version),
  };
}

async function ensureStoreDirectory() {
  await mkdir(path.dirname(STORE_PATH), { recursive: true });
}

async function readState() {
  try {
    const rawValue = await readFile(STORE_PATH, "utf8");
    return normalizeState(JSON.parse(rawValue) as Partial<TermsConsentState>);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      const state = normalizeState({});
      await writeState(state);
      return state;
    }

    throw error;
  }
}

async function writeState(state: TermsConsentState) {
  await ensureStoreDirectory();
  const temporaryStorePath = `${STORE_PATH}.${process.pid}.${Date.now()}.tmp`;

  await writeFile(temporaryStorePath, JSON.stringify(state, null, 2), "utf8");
  await rename(temporaryStorePath, STORE_PATH);
}

export async function hasAcceptedCurrentTerms(session: AuthSession) {
  const actorKeys = getSessionActorKeys(session);

  if (!actorKeys.length) {
    return false;
  }

  const state = await readState();

  return actorKeys.some((actorKey) =>
    state.records.some((record) => record.actorKey === actorKey && record.version === TERMS_CONSENT_VERSION),
  );
}

export async function recordTermsConsentForPhone(phoneNumber: string) {
  const normalizedPhoneNumber = normalizePhone(phoneNumber);

  if (!normalizedPhoneNumber) {
    return;
  }

  await recordTermsConsentForKeys([`phone:${normalizedPhoneNumber}`]);
}

export async function recordTermsConsentForSession(session: AuthSession) {
  await recordTermsConsentForKeys(getSessionActorKeys(session));
}

async function recordTermsConsentForKeys(actorKeys: string[]) {
  const uniqueActorKeys = Array.from(new Set(actorKeys.map((actorKey) => actorKey.trim()).filter(Boolean)));

  if (!uniqueActorKeys.length) {
    return;
  }

  const state = await readState();
  const acceptedAt = new Date().toISOString();

  for (const actorKey of uniqueActorKeys) {
    const existingRecord = state.records.find((record) => record.actorKey === actorKey && record.version === TERMS_CONSENT_VERSION);

    if (existingRecord) {
      existingRecord.acceptedAt = acceptedAt;
      continue;
    }

    state.records.push({
      acceptedAt,
      actorKey,
      version: TERMS_CONSENT_VERSION,
    });
  }

  await writeState(state);
}
