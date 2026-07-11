import "server-only";

import { createEntityId } from "@trapit/testing";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const DEFAULT_PRODUCTION_DATA_DIR = path.join(path.sep, "var", "lib", "trapit");

export type ApportionAppointment = {
  canceledAt: string | null;
  canceledByIdentifier: string | null;
  createdAt: string;
  id: string;
  notes: string | null;
  ownerIdentifier: string;
  ownerName: string | null;
  requesterIdentifier: string;
  requesterName: string;
  requesterPhone: string | null;
  startsAt: string;
};

type ApportionState = {
  appointments: ApportionAppointment[];
};

function resolveStorePath() {
  const configuredDataDir = process.env.TRAPIT_DATA_DIR?.trim();

  if (configuredDataDir) {
    return path.join(configuredDataDir, "apportion-appointments.json");
  }

  return process.env.NODE_ENV === "production"
    ? path.join(DEFAULT_PRODUCTION_DATA_DIR, "apportion-appointments.json")
    : path.join(process.cwd(), "data", "apportion-appointments.json");
}

const STORE_PATH = resolveStorePath();

function normalizeIdentifier(value: string | null | undefined) {
  return value?.trim().toLowerCase().replace(/[\s()-]/g, "") ?? "";
}

function normalizeState(parsed: Partial<ApportionState>): ApportionState {
  return {
    appointments: (parsed.appointments ?? [])
      .map((appointment) => ({
        canceledAt: appointment.canceledAt?.trim() || null,
        canceledByIdentifier: appointment.canceledByIdentifier?.trim() || null,
        createdAt: appointment.createdAt ?? new Date().toISOString(),
        id: appointment.id ?? createEntityId("appointment"),
        notes: appointment.notes?.trim() || null,
        ownerIdentifier: appointment.ownerIdentifier?.trim() ?? "",
        ownerName: appointment.ownerName?.trim() || null,
        requesterIdentifier: appointment.requesterIdentifier?.trim() ?? "",
        requesterName: appointment.requesterName?.trim() || "Registered user",
        requesterPhone: appointment.requesterPhone?.trim() || null,
        startsAt: appointment.startsAt ?? "",
      }))
      .filter((appointment) => appointment.ownerIdentifier && appointment.requesterIdentifier && appointment.startsAt),
  };
}

async function ensureStoreDirectory() {
  await mkdir(path.dirname(STORE_PATH), { recursive: true });
}

async function readState(): Promise<ApportionState> {
  try {
    const rawValue = await readFile(STORE_PATH, "utf8");
    return normalizeState(JSON.parse(rawValue) as Partial<ApportionState>);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      const state = normalizeState({});
      await writeState(state);
      return state;
    }

    throw error;
  }
}

async function writeState(state: ApportionState) {
  await ensureStoreDirectory();
  await writeFile(STORE_PATH, JSON.stringify(state, null, 2), "utf8");
}

export async function listApportionAppointmentsForOwner(ownerIdentifier: string) {
  const normalizedOwner = normalizeIdentifier(ownerIdentifier);
  const state = await readState();

  return state.appointments
    .filter((appointment) => normalizeIdentifier(appointment.ownerIdentifier) === normalizedOwner && !appointment.canceledAt)
    .sort((left, right) => new Date(left.startsAt).getTime() - new Date(right.startsAt).getTime());
}

export async function listApportionAppointmentsForRequester(requesterIdentifier: string) {
  const normalizedRequester = normalizeIdentifier(requesterIdentifier);
  const state = await readState();

  return state.appointments
    .filter((appointment) => normalizeIdentifier(appointment.requesterIdentifier) === normalizedRequester && !appointment.canceledAt)
    .sort((left, right) => new Date(left.startsAt).getTime() - new Date(right.startsAt).getTime());
}

export async function listApportionSlotCounts(ownerIdentifier: string) {
  const appointments = await listApportionAppointmentsForOwner(ownerIdentifier);

  return Object.entries(
    appointments.reduce<Record<string, number>>((counts, appointment) => {
      counts[appointment.startsAt] = (counts[appointment.startsAt] ?? 0) + 1;
      return counts;
    }, {}),
  ).map(([startsAt, count]) => ({ count, startsAt }));
}

export async function createApportionAppointment(input: {
  appointmentsPerSlot: number;
  notes?: string | null;
  ownerIdentifier: string;
  ownerName?: string | null;
  requesterIdentifier: string;
  requesterName: string;
  requesterPhone?: string | null;
  startsAt: string;
}) {
  const startsAt = new Date(input.startsAt);

  if (Number.isNaN(startsAt.getTime())) {
    throw new Error("Choose a valid appointment date and time.");
  }

  if (startsAt.getTime() <= Date.now()) {
    throw new Error("Choose a future appointment time.");
  }

  const ownerIdentifier = input.ownerIdentifier.trim();
  const requesterIdentifier = input.requesterIdentifier.trim();

  if (!ownerIdentifier || !requesterIdentifier) {
    throw new Error("Appointment owner and requester are required.");
  }

  const state = await readState();
  const slotCount = state.appointments.filter((appointment) =>
    normalizeIdentifier(appointment.ownerIdentifier) === normalizeIdentifier(ownerIdentifier)
    && appointment.startsAt === startsAt.toISOString(),
  ).length;

  if (slotCount >= input.appointmentsPerSlot) {
    throw new Error("This appointment slot is already full.");
  }

  const appointment: ApportionAppointment = {
    canceledAt: null,
    canceledByIdentifier: null,
    createdAt: new Date().toISOString(),
    id: createEntityId("appointment"),
    notes: input.notes?.trim() || null,
    ownerIdentifier,
    ownerName: input.ownerName?.trim() || null,
    requesterIdentifier,
    requesterName: input.requesterName.trim() || "Registered user",
    requesterPhone: input.requesterPhone?.trim() || null,
    startsAt: startsAt.toISOString(),
  };

  state.appointments.push(appointment);
  await writeState(state);

  return appointment;
}

export async function cancelApportionAppointment(input: {
  actorIdentifier: string;
  appointmentId: string;
}) {
  const actorIdentifier = input.actorIdentifier.trim();
  const appointmentId = input.appointmentId.trim();

  if (!actorIdentifier || !appointmentId) {
    throw new Error("Appointment and signed-in user are required.");
  }

  const state = await readState();
  const appointment = state.appointments.find((entry) => entry.id === appointmentId);

  if (!appointment || appointment.canceledAt) {
    throw new Error("Appointment not found.");
  }

  const normalizedActor = normalizeIdentifier(actorIdentifier);
  const canCancel = normalizeIdentifier(appointment.ownerIdentifier) === normalizedActor
    || normalizeIdentifier(appointment.requesterIdentifier) === normalizedActor;

  if (!canCancel) {
    throw new Error("You can only cancel your own appointments.");
  }

  appointment.canceledAt = new Date().toISOString();
  appointment.canceledByIdentifier = actorIdentifier;
  await writeState(state);

  return appointment;
}