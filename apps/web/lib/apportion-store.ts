import "server-only";

import { createEntityId } from "@trapit/testing";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const DEFAULT_PRODUCTION_DATA_DIR = path.join(path.sep, "var", "lib", "trapit");

export type ApportionAppointment = {
  canceledAt: string | null;
  canceledByIdentifier: string | null;
  bookedQueuePosition: number;
  createdAt: string;
  currentStatus: ApportionAppointmentStatus;
  history: ApportionAppointmentHistoryEntry[];
  id: string;
  justAddToList: boolean;
  notes: string | null;
  ownerIdentifier: string;
  ownerName: string | null;
  presentInPersonAt: string | null;
  queueOrder: number;
  requesterIdentifier: string;
  requesterName: string;
  requesterPhone: string | null;
  serviceDateKey: string;
  statusUpdatedAt: string;
  startsAt: string;
};

export type ApportionAppointmentStatus =
  | "pending"
  | "present-in-person"
  | "done"
  | "pushed-back"
  | "rejected"
  | "cancelled";

export type ApportionAppointmentHistoryAction =
  | "booked"
  | "present-in-person"
  | "done"
  | "pushed-back"
  | "rejected"
  | "cancelled"
  | "rescheduled";

export type ApportionAppointmentHistoryEntry = {
  action: ApportionAppointmentHistoryAction;
  actorIdentifier: string;
  at: string;
  fromStartsAt: string | null;
  note: string | null;
  toStartsAt: string | null;
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

function normalizeStatus(value: string | null | undefined, canceledAt: string | null): ApportionAppointmentStatus {
  if (value === "pending"
    || value === "present-in-person"
    || value === "done"
    || value === "pushed-back"
    || value === "rejected"
    || value === "cancelled") {
    return value;
  }

  return canceledAt ? "cancelled" : "pending";
}

function normalizeHistoryAction(value: string | null | undefined): ApportionAppointmentHistoryAction | null {
  if (value === "booked"
    || value === "present-in-person"
    || value === "done"
    || value === "pushed-back"
    || value === "rejected"
    || value === "cancelled"
    || value === "rescheduled") {
    return value;
  }

  return null;
}

function createHistoryEntry(input: {
  action: ApportionAppointmentHistoryAction;
  actorIdentifier: string;
  at?: string;
  fromStartsAt?: string | null;
  note?: string | null;
  toStartsAt?: string | null;
}): ApportionAppointmentHistoryEntry {
  return {
    action: input.action,
    actorIdentifier: input.actorIdentifier.trim(),
    at: input.at ?? new Date().toISOString(),
    fromStartsAt: input.fromStartsAt ?? null,
    note: input.note?.trim() || null,
    toStartsAt: input.toStartsAt ?? null,
  };
}

function getAppointmentDayKey(startsAt: string) {
  const date = new Date(startsAt);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function getOwnerDayKey(appointment: Pick<ApportionAppointment, "ownerIdentifier" | "serviceDateKey" | "startsAt">) {
  return `${normalizeIdentifier(appointment.ownerIdentifier)}::${appointment.serviceDateKey || getAppointmentDayKey(appointment.startsAt)}`;
}

function isActiveStatus(status: ApportionAppointmentStatus) {
  return status === "pending" || status === "present-in-person" || status === "pushed-back";
}

function compareAppointments(left: Pick<ApportionAppointment, "createdAt" | "queueOrder" | "startsAt">, right: Pick<ApportionAppointment, "createdAt" | "queueOrder" | "startsAt">) {
  const leftStartsAtMs = new Date(left.startsAt).getTime();
  const rightStartsAtMs = new Date(right.startsAt).getTime();

  if (leftStartsAtMs !== rightStartsAtMs) {
    return leftStartsAtMs - rightStartsAtMs;
  }

  if (left.queueOrder !== right.queueOrder) {
    return left.queueOrder - right.queueOrder;
  }

  return new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
}

function compareQueueOrder(left: Pick<ApportionAppointment, "createdAt" | "queueOrder" | "startsAt">, right: Pick<ApportionAppointment, "createdAt" | "queueOrder" | "startsAt">) {
  if (left.queueOrder !== right.queueOrder) {
    return left.queueOrder - right.queueOrder;
  }

  return compareAppointments(left, right);
}

function normalizeHistory(
  history: ApportionAppointment["history"] | null | undefined,
  fallbackAppointment: Pick<ApportionAppointment, "canceledAt" | "canceledByIdentifier" | "createdAt" | "currentStatus" | "ownerIdentifier" | "requesterIdentifier" | "startsAt">,
) {
  const normalizedHistory = (history ?? []).map((entry) => {
    const action = normalizeHistoryAction(entry?.action);

    if (!action) {
      return null;
    }

    return createHistoryEntry({
      action,
      actorIdentifier: entry.actorIdentifier ?? fallbackAppointment.requesterIdentifier,
      at: entry.at ?? fallbackAppointment.createdAt,
      fromStartsAt: entry.fromStartsAt,
      note: entry.note,
      toStartsAt: entry.toStartsAt,
    });
  }).filter((entry): entry is ApportionAppointmentHistoryEntry => Boolean(entry));

  if (!normalizedHistory.length) {
    normalizedHistory.push(createHistoryEntry({
      action: "booked",
      actorIdentifier: fallbackAppointment.requesterIdentifier,
      at: fallbackAppointment.createdAt,
      toStartsAt: fallbackAppointment.startsAt,
    }));
  }

  if (fallbackAppointment.currentStatus === "cancelled" && fallbackAppointment.canceledAt) {
    const hasCancelEntry = normalizedHistory.some((entry) => entry.action === "cancelled" && entry.at === fallbackAppointment.canceledAt);

    if (!hasCancelEntry) {
      normalizedHistory.push(createHistoryEntry({
        action: "cancelled",
        actorIdentifier: fallbackAppointment.canceledByIdentifier ?? fallbackAppointment.requesterIdentifier,
        at: fallbackAppointment.canceledAt,
        toStartsAt: fallbackAppointment.startsAt,
      }));
    }
  }

  return normalizedHistory.sort((left, right) => new Date(left.at).getTime() - new Date(right.at).getTime());
}

function normalizeAppointments(appointments: ApportionAppointment[]) {
  const bookedCountsByOwnerDay = new Map<string, number>();

  const normalized = appointments
    .sort(compareAppointments)
    .map((appointment) => {
      const ownerDayKey = getOwnerDayKey(appointment);
      const nextBookedPosition = (bookedCountsByOwnerDay.get(ownerDayKey) ?? 0) + 1;
      bookedCountsByOwnerDay.set(ownerDayKey, nextBookedPosition);

      return {
        ...appointment,
        bookedQueuePosition: Number.isFinite(appointment.bookedQueuePosition) && appointment.bookedQueuePosition > 0
          ? Math.floor(appointment.bookedQueuePosition)
          : nextBookedPosition,
        queueOrder: Number.isFinite(appointment.queueOrder) && appointment.queueOrder > 0
          ? Math.floor(appointment.queueOrder)
          : nextBookedPosition,
      };
    });

  const activeAppointmentsByOwnerDay = normalized.reduce<Map<string, ApportionAppointment[]>>((groups, appointment) => {
    if (!isActiveStatus(appointment.currentStatus)) {
      return groups;
    }

    const ownerDayKey = getOwnerDayKey(appointment);
    const entries = groups.get(ownerDayKey) ?? [];
    entries.push(appointment);
    groups.set(ownerDayKey, entries);
    return groups;
  }, new Map<string, ApportionAppointment[]>());

  activeAppointmentsByOwnerDay.forEach((appointmentsForDay) => {
    appointmentsForDay
      .sort(compareQueueOrder)
      .forEach((appointment, index) => {
        appointment.queueOrder = index + 1;
      });
  });

  return normalized;
}

function normalizeState(parsed: Partial<ApportionState>): ApportionState {
  return {
    appointments: normalizeAppointments(
      (parsed.appointments ?? [])
        .map((appointment) => {
          const canceledAt = appointment.canceledAt?.trim() || null;
          const canceledByIdentifier = appointment.canceledByIdentifier?.trim() || null;
          const createdAt = appointment.createdAt ?? new Date().toISOString();
          const currentStatus = normalizeStatus(appointment.currentStatus, canceledAt);
          const ownerIdentifier = appointment.ownerIdentifier?.trim() ?? "";
          const requesterIdentifier = appointment.requesterIdentifier?.trim() ?? "";
          const startsAt = appointment.startsAt ?? "";

          const normalizedAppointment: ApportionAppointment = {
            canceledAt,
            canceledByIdentifier,
            bookedQueuePosition: Number.isFinite(appointment.bookedQueuePosition) ? appointment.bookedQueuePosition : 0,
            createdAt,
            currentStatus,
            history: [],
            id: appointment.id ?? createEntityId("appointment"),
            justAddToList: appointment.justAddToList === true,
            notes: appointment.notes?.trim() || null,
            ownerIdentifier,
            ownerName: appointment.ownerName?.trim() || null,
            presentInPersonAt: appointment.presentInPersonAt?.trim() || null,
            queueOrder: Number.isFinite(appointment.queueOrder) ? appointment.queueOrder : 0,
            requesterIdentifier,
            requesterName: appointment.requesterName?.trim() || "Registered user",
            requesterPhone: appointment.requesterPhone?.trim() || null,
            serviceDateKey: appointment.serviceDateKey?.trim() || getAppointmentDayKey(startsAt),
            statusUpdatedAt: appointment.statusUpdatedAt?.trim() || canceledAt || createdAt,
            startsAt,
          };

          normalizedAppointment.history = normalizeHistory(appointment.history, normalizedAppointment);

          return normalizedAppointment;
        })
        .filter((appointment) => appointment.ownerIdentifier && appointment.requesterIdentifier && appointment.startsAt),
    ),
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
    .filter((appointment) => normalizeIdentifier(appointment.ownerIdentifier) === normalizedOwner)
    .sort(compareAppointments);
}

export async function listApportionAppointmentsForRequester(requesterIdentifier: string) {
  const normalizedRequester = normalizeIdentifier(requesterIdentifier);
  const state = await readState();

  return state.appointments
    .filter((appointment) => normalizeIdentifier(appointment.requesterIdentifier) === normalizedRequester)
    .sort(compareAppointments);
}

export async function listApportionSlotCounts(ownerIdentifier: string) {
  const appointments = (await listApportionAppointmentsForOwner(ownerIdentifier))
    .filter((appointment) => isActiveStatus(appointment.currentStatus));

  return Object.entries(
    appointments.reduce<Record<string, number>>((counts, appointment) => {
      counts[appointment.startsAt] = (counts[appointment.startsAt] ?? 0) + 1;
      return counts;
    }, {}),
  ).map(([startsAt, count]) => ({ count, startsAt }));
}

export async function createApportionAppointment(input: {
  appointmentsPerSlot: number;
  bookedQueuePosition?: number;
  justAddToList?: boolean;
  notes?: string | null;
  ownerIdentifier: string;
  ownerName?: string | null;
  requesterIdentifier: string;
  requesterName: string;
  requesterPhone?: string | null;
  serviceDateKey?: string;
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
    && isActiveStatus(appointment.currentStatus)
    && appointment.startsAt === startsAt.toISOString(),
  ).length;

  if (slotCount >= input.appointmentsPerSlot) {
    throw new Error("This appointment slot is already full.");
  }

  const serviceDateKey = input.serviceDateKey?.trim() || getAppointmentDayKey(startsAt.toISOString());
  const ownerDayKey = `${normalizeIdentifier(ownerIdentifier)}::${serviceDateKey}`;
  const ownerDayAppointments = state.appointments.filter((appointment) => getOwnerDayKey(appointment) === ownerDayKey);
  const activeOwnerDayAppointments = ownerDayAppointments.filter((appointment) => isActiveStatus(appointment.currentStatus));
  const createdAt = new Date().toISOString();
  const bookedQueuePosition = Number.isFinite(input.bookedQueuePosition) && (input.bookedQueuePosition ?? 0) > 0
    ? Math.floor(input.bookedQueuePosition ?? 0)
    : ownerDayAppointments.length + 1;

  const appointment: ApportionAppointment = {
    canceledAt: null,
    canceledByIdentifier: null,
    bookedQueuePosition,
    createdAt,
    currentStatus: "pending",
    history: [createHistoryEntry({
      action: "booked",
      actorIdentifier: requesterIdentifier,
      at: createdAt,
      toStartsAt: startsAt.toISOString(),
    })],
    id: createEntityId("appointment"),
    justAddToList: input.justAddToList === true,
    notes: input.notes?.trim() || null,
    ownerIdentifier,
    ownerName: input.ownerName?.trim() || null,
    presentInPersonAt: null,
    queueOrder: activeOwnerDayAppointments.length + 1,
    requesterIdentifier,
    requesterName: input.requesterName.trim() || "Registered user",
    requesterPhone: input.requesterPhone?.trim() || null,
    serviceDateKey,
    statusUpdatedAt: createdAt,
    startsAt: startsAt.toISOString(),
  };

  state.appointments.push(appointment);
  state.appointments = normalizeAppointments(state.appointments);
  await writeState(state);

  return appointment;
}

function getLatestInPersonAppointment(state: ApportionState, ownerIdentifier: string, startsAt: string, excludedAppointmentId?: string) {
  const ownerDayKey = `${normalizeIdentifier(ownerIdentifier)}::${getAppointmentDayKey(startsAt)}`;

  return state.appointments
    .filter((appointment) => getOwnerDayKey(appointment) === ownerDayKey)
    .filter((appointment) => appointment.id !== excludedAppointmentId)
    .filter((appointment) => appointment.currentStatus === "present-in-person")
    .sort(compareQueueOrder)[0] ?? null;
}

function reindexOwnerDayQueue(state: ApportionState, ownerIdentifier: string, startsAt: string) {
  const ownerDayKey = `${normalizeIdentifier(ownerIdentifier)}::${getAppointmentDayKey(startsAt)}`;

  state.appointments
    .filter((appointment) => getOwnerDayKey(appointment) === ownerDayKey)
    .filter((appointment) => isActiveStatus(appointment.currentStatus))
    .sort(compareQueueOrder)
    .forEach((appointment, index) => {
      appointment.queueOrder = index + 1;
    });
}

export async function updateApportionAppointment(input: {
  action: "cancel" | "done" | "present-in-person" | "push-back" | "reject" | "reschedule";
  actorIdentifier: string;
  appointmentId: string;
  nextStartsAt?: string;
  notes?: string | null;
  requesterOnly?: boolean;
}) {
  const actorIdentifier = input.actorIdentifier.trim();
  const appointmentId = input.appointmentId.trim();

  if (!actorIdentifier || !appointmentId) {
    throw new Error("Appointment and signed-in user are required.");
  }

  const state = await readState();
  const appointment = state.appointments.find((entry) => entry.id === appointmentId);

  if (!appointment) {
    throw new Error("Appointment not found.");
  }

  const normalizedActor = normalizeIdentifier(actorIdentifier);
  const isOwner = normalizeIdentifier(appointment.ownerIdentifier) === normalizedActor;
  const isRequester = normalizeIdentifier(appointment.requesterIdentifier) === normalizedActor;

  if (!isOwner && !isRequester) {
    throw new Error("You can only update your own appointments.");
  }

  const timestamp = new Date().toISOString();

  if (input.action === "cancel") {
    if (!isOwner && !isRequester) {
      throw new Error("You can only cancel your own appointments.");
    }

    if (!isActiveStatus(appointment.currentStatus)) {
      throw new Error("This appointment is no longer active.");
    }

    appointment.canceledAt = timestamp;
    appointment.canceledByIdentifier = actorIdentifier;
    appointment.currentStatus = "cancelled";
    appointment.statusUpdatedAt = timestamp;
    appointment.presentInPersonAt = null;
    appointment.history.push(createHistoryEntry({
      action: "cancelled",
      actorIdentifier,
      at: timestamp,
      toStartsAt: appointment.startsAt,
      note: input.notes,
    }));
  } else if (input.action === "present-in-person") {
    if (!isOwner) {
      throw new Error("Only the business owner can mark a user present in person.");
    }

    if (!isActiveStatus(appointment.currentStatus)) {
      throw new Error("Only active appointments can be marked present.");
    }

    appointment.currentStatus = "present-in-person";
    appointment.presentInPersonAt = timestamp;
    appointment.statusUpdatedAt = timestamp;
    appointment.history.push(createHistoryEntry({
      action: "present-in-person",
      actorIdentifier,
      at: timestamp,
      toStartsAt: appointment.startsAt,
    }));
  } else if (input.action === "done") {
    if (!isOwner) {
      throw new Error("Only the business owner can mark an appointment done.");
    }

    if (!isActiveStatus(appointment.currentStatus)) {
      throw new Error("Only active appointments can be marked done.");
    }

    appointment.currentStatus = "done";
    appointment.presentInPersonAt = null;
    appointment.statusUpdatedAt = timestamp;
    appointment.history.push(createHistoryEntry({
      action: "done",
      actorIdentifier,
      at: timestamp,
      toStartsAt: appointment.startsAt,
    }));
  } else if (input.action === "push-back") {
    if (!isOwner) {
      throw new Error("Only the business owner can push back an appointment.");
    }

    if (!isActiveStatus(appointment.currentStatus)) {
      throw new Error("Only active appointments can be pushed back.");
    }

    const ownerDayKey = getOwnerDayKey(appointment);
    const activeAppointments = state.appointments
      .filter((entry) => getOwnerDayKey(entry) === ownerDayKey)
      .filter((entry) => isActiveStatus(entry.currentStatus))
      .sort(compareQueueOrder);
    const currentIndex = activeAppointments.findIndex((entry) => entry.id === appointment.id);

    if (currentIndex === -1) {
      throw new Error("Appointment queue could not be updated.");
    }

    const remainingAppointments = activeAppointments.filter((entry) => entry.id !== appointment.id);
    const targetIndex = Math.min(remainingAppointments.length, currentIndex + 5);
    remainingAppointments.splice(targetIndex, 0, appointment);
    remainingAppointments.forEach((entry, index) => {
      entry.queueOrder = index + 1;
    });

    appointment.currentStatus = "pushed-back";
    appointment.presentInPersonAt = null;
    appointment.statusUpdatedAt = timestamp;
    appointment.history.push(createHistoryEntry({
      action: "pushed-back",
      actorIdentifier,
      at: timestamp,
      toStartsAt: appointment.startsAt,
      note: "Moved back in queue",
    }));
  } else if (input.action === "reject") {
    if (!isOwner) {
      throw new Error("Only the business owner can reject an appointment.");
    }

    if (!isActiveStatus(appointment.currentStatus)) {
      throw new Error("Only active appointments can be rejected.");
    }

    appointment.currentStatus = "rejected";
    appointment.presentInPersonAt = null;
    appointment.statusUpdatedAt = timestamp;
    appointment.history.push(createHistoryEntry({
      action: "rejected",
      actorIdentifier,
      at: timestamp,
      toStartsAt: appointment.startsAt,
      note: input.notes,
    }));
  } else {
    if (!isRequester) {
      throw new Error("Only the requester can reschedule an appointment.");
    }

    if (!isActiveStatus(appointment.currentStatus)) {
      throw new Error("Only active future appointments can be rescheduled.");
    }

    if (new Date(appointment.startsAt).getTime() <= Date.now()) {
      throw new Error("Only future appointments can be rescheduled.");
    }

    const nextStartsAt = new Date(input.nextStartsAt ?? "");

    if (Number.isNaN(nextStartsAt.getTime()) || nextStartsAt.getTime() <= Date.now()) {
      throw new Error("Choose a valid future appointment time.");
    }

    const previousStartsAt = appointment.startsAt;
    appointment.startsAt = nextStartsAt.toISOString();
    appointment.currentStatus = "pending";
    appointment.presentInPersonAt = null;
    appointment.statusUpdatedAt = timestamp;
    appointment.history.push(createHistoryEntry({
      action: "rescheduled",
      actorIdentifier,
      at: timestamp,
      fromStartsAt: previousStartsAt,
      note: input.notes,
      toStartsAt: appointment.startsAt,
    }));

    const newOwnerDayKey = getOwnerDayKey(appointment);
    const sameDayAppointments = state.appointments
      .filter((entry) => entry.id !== appointment.id)
      .filter((entry) => getOwnerDayKey(entry) === newOwnerDayKey)
      .filter((entry) => isActiveStatus(entry.currentStatus))
      .sort(compareQueueOrder);
    appointment.queueOrder = sameDayAppointments.length + 1;
  }

  reindexOwnerDayQueue(state, appointment.ownerIdentifier, appointment.startsAt);
  state.appointments = normalizeAppointments(state.appointments);
  await writeState(state);

  return {
    appointment,
    nextInPersonAppointment: (input.action === "done" || input.action === "push-back")
      ? getLatestInPersonAppointment(state, appointment.ownerIdentifier, appointment.startsAt, appointment.id)
      : null,
  };
}

export async function cancelApportionAppointment(input: {
  actorIdentifier: string;
  appointmentId: string;
}) {
  const result = await updateApportionAppointment({
    action: "cancel",
    actorIdentifier: input.actorIdentifier,
    appointmentId: input.appointmentId,
  });

  return result.appointment;
}