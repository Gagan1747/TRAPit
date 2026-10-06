import "server-only";

import { createEntityId, getApportionBookableServices, getApportionWeeklyIntervals, intersectApportionWeeklyIntervals, matchApportionIdentity, normalizeApportionProviderSettings, participantIdentifiersMatch, resolveApportionController, type ApportionProviderSettings } from "@trapit/testing";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { getApportionBusinessContext, type ApportionBusinessContext } from "./apportion-directory";
import { getApportionLifecycleBoundaries, resolveAppointmentLocationSchedule, validateAppointmentLocationSlot } from "./appointment-locations";

const DEFAULT_PRODUCTION_DATA_DIR = path.join(path.sep, "var", "lib", "trapit");
const IST_OFFSET_MINUTES = 5 * 60 + 30;

export type ApportionAppointment = {
  serviceId?: string;
  serviceName?: string;
  assignedStaffIdentifier?: string | null;
  bookedSettings?: ApportionProviderSettings;
  notifications?: ApportionNotification[];
  canceledAt: string | null;
  canceledByIdentifier: string | null;
  bookedQueuePosition: number;
  createdAt: string;
  currentStatus: ApportionAppointmentStatus;
  history: ApportionAppointmentHistoryEntry[];
  id: string;
  justAddToList: boolean;
  locationAddress: string;
  locationId: string;
  locationName: string;
  messages: ApportionAppointmentMessage[];
  notes: string | null;
  originalStartsAt?: string;
  slotEndsAt?: string;
  queueExpiresAt?: string;
  queueConvertedAt?: string;
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

export type ApportionAppointmentMessage = {
  id: string;
  authorIdentifier: string;
  createdAt: string;
  body: string;
};

export type ApportionAppointmentStatus =
  | "pending"
  | "present-in-person"
  | "done"
  | "pushed-back"
  | "rejected"
  | "missed"
  | "cancelled";

export type ApportionAppointmentHistoryAction =
  | "booked"
  | "present-in-person"
  | "done"
  | "pushed-back"
  | "rejected"
  | "missed"
  | "cancelled"
  | "rescheduled"
  | "address-opt-out";

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
  invitations: ApportionInvitation[];
};

export type ApportionInvitation = {
  id: string;
  status: "pending" | "accepted" | "declined" | "expired" | "cancelled";
  ownerIdentifier: string;
  creatorIdentifier: string;
  requesterIdentifier: string;
  requesterName: string;
  requesterPhone?: string | null;
  ownerName: string | null;
  locationId: string;
  locationName: string;
  locationAddress: string;
  serviceId: string;
  serviceName: string;
  notes: string | null;
  createdAt: string;
  statusUpdatedAt: string;
  expiresAt: string;
  occurrences: Array<{ serviceDateKey: string; startsAt: string; slotEndsAt: string }>;
  appointmentIds: string[];
  notifications: ApportionNotification[];
  bookedSettings: ApportionProviderSettings;
};

export class ApportionInvitationError extends Error {
  constructor(message: string, public readonly status: 400 | 403 = 400) {
    super(message);
  }
}

export type ApportionNotification = {
  id: string;
  recipientIdentifier: string;
  title: string;
  body: string;
  url: string;
  createdAt: string;
  deliveredAt?: string | null;
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

const appointmentGlobal = globalThis as typeof globalThis & { __trapitApportionQueues?: Map<string, Promise<void>> };
const appointmentQueues = appointmentGlobal.__trapitApportionQueues ??= new Map();

function withAppointmentLock<Result>(operation: () => Promise<Result>): Promise<Result> {
  const previous = appointmentQueues.get(STORE_PATH) ?? Promise.resolve();
  const result = previous.then(operation);
  appointmentQueues.set(STORE_PATH, result.then(() => undefined, () => undefined));
  return result;
}

function normalizeStatus(value: string | null | undefined, canceledAt: string | null): ApportionAppointmentStatus {
  if (value === "pending"
    || value === "present-in-person"
    || value === "done"
    || value === "pushed-back"
    || value === "rejected"
    || value === "missed"
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
    || value === "missed"
    || value === "cancelled"
    || value === "rescheduled"
    || value === "address-opt-out") {
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

  const shifted = new Date(date.getTime() + (IST_OFFSET_MINUTES * 60 * 1000));
  const year = shifted.getUTCFullYear();
  const month = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const day = String(shifted.getUTCDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

type ApportionServiceDay = Pick<ApportionAppointment, "locationId" | "ownerIdentifier" | "serviceId" | "serviceDateKey" | "startsAt">;

function getOwnerDayKey(appointment: ApportionServiceDay) {
  return `${appointment.ownerIdentifier}::${appointment.locationId || "location-1"}::${appointment.serviceId || "consultation"}::${appointment.serviceDateKey || getAppointmentDayKey(appointment.startsAt)}`;
}

function appointmentsShareServiceDay(first: ApportionServiceDay, second: ApportionServiceDay) {
  return participantIdentifiersMatch(first.ownerIdentifier, second.ownerIdentifier)
    && first.locationId === second.locationId
    && (first.serviceId || "consultation") === (second.serviceId || "consultation")
    && (first.serviceDateKey || getAppointmentDayKey(first.startsAt)) === (second.serviceDateKey || getAppointmentDayKey(second.startsAt));
}

function resolveServiceDateKey(value: string | undefined, startsAt: string, allowPastDay = false) {
  const serviceDateKey = value?.trim() || getAppointmentDayKey(startsAt);
  const date = new Date(`${serviceDateKey}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(serviceDateKey) || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== serviceDateKey
    || (!allowPastDay && serviceDateKey < getAppointmentDayKey(new Date().toISOString()))) {
    throw new Error("Choose a valid current or future service day.");
  }
  return serviceDateKey;
}

function assertProviderOpenOnDay(context: ApportionBusinessContext, providerIdentifier: string | null, locationId: string, serviceDateKey: string) {
  if (!providerIdentifier) return;
  const providerClosedDates = Object.entries(context.providerClosedDateKeys ?? {})
    .find(([identifier]) => participantIdentifiersMatch(identifier, providerIdentifier))?.[1] ?? [];
  if (providerClosedDates.includes(serviceDateKey)) throw new Error("Provider unavailable on this day.");
  const membership = context.memberships.find((entry) => entry.locationId === locationId
    && participantIdentifiersMatch(entry.ownerIdentifier, context.business.ownerIdentifier)
    && participantIdentifiersMatch(entry.providerIdentifier, providerIdentifier));
  if (membership?.closedDateKeys.includes(serviceDateKey)) throw new Error("Staff address unavailable on this day.");
}

function providerIsLinked(context: ApportionBusinessContext, provider: string, locationId: string) {
  return participantIdentifiersMatch(provider, context.business.ownerIdentifier)
    || context.memberships.some((membership) => membership.locationId === locationId
      && participantIdentifiersMatch(membership.ownerIdentifier, context.business.ownerIdentifier)
      && participantIdentifiersMatch(membership.providerIdentifier, provider));
}

export async function resolveApportionAppointmentAccess(appointment: ApportionAppointment, actorIdentifier: string) {
  const context = await getApportionBusinessContext(appointment.ownerIdentifier);
  return appointmentAccessFromContext(appointment, actorIdentifier, context);
}

function appointmentAccessFromContext(appointment: ApportionAppointment, actorIdentifier: string, context: ApportionBusinessContext | null) {
  const serviceId = appointment.serviceId || "consultation";
  const service = context?.business.services.find((entry) => entry.id === serviceId);
  let controllerIdentifier: string | null = null;
  if (serviceId === "consultation") {
    controllerIdentifier = appointment.ownerIdentifier;
  } else if (context) {
    const assignedIdentifier = service?.assignedIdentifier;
    const linked = assignedIdentifier && service.locationIds.includes(appointment.locationId)
      && providerIsLinked(context, assignedIdentifier, appointment.locationId);
    controllerIdentifier = resolveApportionController(context.business, {
      id: serviceId, name: service?.name || appointment.serviceName || serviceId,
      active: service?.active ?? false, locationIds: service?.locationIds ?? [],
      assignedIdentifier: linked ? assignedIdentifier : null,
    });
  }
  const isOwner = participantIdentifiersMatch(appointment.ownerIdentifier, actorIdentifier);
  const isRequester = participantIdentifiersMatch(appointment.requesterIdentifier, actorIdentifier);
  const isAssignedStaff = Boolean(appointment.assignedStaffIdentifier
    && participantIdentifiersMatch(appointment.assignedStaffIdentifier, actorIdentifier));
  const isAdminDelegate = Boolean(context?.business.adminDelegateIdentifier
    && participantIdentifiersMatch(context.business.adminDelegateIdentifier, actorIdentifier));
  const canManage = Boolean(controllerIdentifier && participantIdentifiersMatch(controllerIdentifier, actorIdentifier));
  return { controllerIdentifier, isOwner, isRequester, isAssignedStaff, isAdminDelegate, canManage, canView: isOwner || isRequester || isAssignedStaff || isAdminDelegate || canManage };
}

async function resolveBookingContext(ownerIdentifier: string, locationId: string, serviceId: string, existingBooking = false) {
  const context = await getApportionBusinessContext(ownerIdentifier);
  if (!context || !matchApportionIdentity(context.business.ownerIdentifier, ownerIdentifier)) {
    throw new Error("Appointment business is unavailable.");
  }
  const service = (existingBooking ? context.business.services : getApportionBookableServices(context.business, context.ownerCategory)).find((entry) => entry.id === serviceId);
  const location = context.branding.appointmentLocations?.find((entry) => entry.id === locationId);
  if (!service || !location || !service.locationIds.includes(locationId)) {
    throw new Error("This service is not bookable at this address.");
  }
  const providerIdentifier = service.assignedIdentifier || (service.id === "consultation" ? context.business.ownerIdentifier : null);
  if (providerIdentifier && !providerIsLinked(context, providerIdentifier, locationId)) {
    throw new Error("Staff address unavailable.");
  }
  const settingsKey = providerIdentifier
    ? Object.keys(context.providerSettings).find((identifier) => participantIdentifiersMatch(identifier, providerIdentifier))
    : undefined;
  const settings = normalizeApportionProviderSettings(settingsKey
    ? context.providerSettings[settingsKey]
    : providerIdentifier
      ? undefined
      : {
          appointmentsPerSlot: context.branding.appointmentsPerSlot ?? undefined,
          justAddToList: context.branding.justAddToList ?? undefined,
          slotDurationMinutes: context.branding.slotDurationMinutes ?? undefined,
        });
  return { context, service, location, providerIdentifier, settings };
}

function isActiveStatus(status: ApportionAppointmentStatus) {
  return status === "pending" || status === "present-in-person" || status === "pushed-back";
}

function addAppointmentNotifications(appointment: ApportionAppointment, title: string, body: string, timestamp: string, controllerIdentifier?: string | null) {
  const recipients = [appointment.requesterIdentifier, appointment.ownerIdentifier, appointment.assignedStaffIdentifier, controllerIdentifier]
    .filter((identifier): identifier is string => Boolean(identifier))
    .filter((identifier, index, identifiers) => !identifiers.slice(0, index).some((other) => participantIdentifiersMatch(identifier, other)));
  appointment.notifications ??= [];
  for (const recipientIdentifier of recipients) {
    appointment.notifications.push({ id: createEntityId("apportion-notification"), recipientIdentifier, title, body,
      url: `/user?section=apportion&appointmentId=${encodeURIComponent(appointment.id)}`, createdAt: timestamp, deliveredAt: null });
  }
}

function bookingBoundaries(appointment: Pick<ApportionAppointment, "assignedStaffIdentifier" | "locationId" | "serviceDateKey" | "startsAt">, context: ApportionBusinessContext | null, duration: number) {
  const membership = context?.memberships.find((entry) => entry.locationId === appointment.locationId
    && appointment.assignedStaffIdentifier && participantIdentifiersMatch(entry.providerIdentifier, appointment.assignedStaffIdentifier));
  const branding = context ? { ...context.branding, ...(membership ? {
    appointmentLocations: context.branding.appointmentLocations?.map((location) => location.id === appointment.locationId ? { ...location, ...membership } : location),
    appointmentDateOverrides: { closedDateKeys: [], openedDateKeys: [] },
    appointmentDateHoursOverrides: [], appointmentWeeklyHoursOverrides: [],
  } : {}) } : null;
  return getApportionLifecycleBoundaries({
    location: branding ? resolveAppointmentLocationSchedule(branding, appointment.locationId, appointment.serviceDateKey) : null,
    serviceDateKey: appointment.serviceDateKey, startsAt: appointment.startsAt, slotDurationMinutes: duration,
  });
}

function moveToQueue(state: ApportionState, appointment: ApportionAppointment, timestamp: string, actorIdentifier: string, action: "rejected" | "pushed-back") {
  const active = state.appointments.filter((entry) => appointmentsShareServiceDay(entry, appointment) && isActiveStatus(entry.currentStatus)).sort(compareQueueOrder);
  const currentIndex = active.findIndex((entry) => entry.id === appointment.id);
  const remaining = active.filter((entry) => entry.id !== appointment.id);
  if (!appointment.justAddToList) {
    appointment.justAddToList = true;
    appointment.queueConvertedAt = timestamp;
    remaining.push(appointment);
  } else {
    remaining.splice(Math.min(remaining.length, currentIndex + 4), 0, appointment);
  }
  remaining.forEach((entry, index) => { entry.queueOrder = index + 1; });
  appointment.currentStatus = "pushed-back";
  appointment.presentInPersonAt = null;
  appointment.statusUpdatedAt = timestamp;
  appointment.history.push(createHistoryEntry({ action, actorIdentifier, at: timestamp, toStartsAt: appointment.startsAt,
    note: action === "rejected" ? "Absent: moved back in the service-day queue." : "Booked slot ended: moved to the end of the service-day queue." }));
}

async function applyMissedTransitions(state: ApportionState) {
  const timestamp = new Date().toISOString();
  let changed = false;
  const contexts = new Map<string, ApportionBusinessContext | null>();

  for (const appointment of state.appointments) {
    if (!isActiveStatus(appointment.currentStatus)) continue;
    if (!appointment.slotEndsAt || !appointment.queueExpiresAt) {
      if (!contexts.has(appointment.ownerIdentifier)) contexts.set(appointment.ownerIdentifier, await getApportionBusinessContext(appointment.ownerIdentifier));
      const context = contexts.get(appointment.ownerIdentifier) ?? null;
      const settingsKey = Object.keys(context?.providerSettings ?? {}).find((identifier) => participantIdentifiersMatch(identifier, appointment.assignedStaffIdentifier ?? appointment.ownerIdentifier));
      const duration = appointment.bookedSettings?.slotDurationMinutes ?? (settingsKey ? context?.providerSettings[settingsKey].slotDurationMinutes : undefined) ?? 10;
      const boundaries = bookingBoundaries(appointment, context, duration);
      appointment.slotEndsAt ||= boundaries.slotEndsAt;
      appointment.queueExpiresAt ||= boundaries.queueExpiresAt;
      changed = true;
    }
    if (Date.now() < new Date(appointment.queueExpiresAt!).getTime()) {
      if (!appointment.justAddToList && Date.now() >= new Date(appointment.slotEndsAt!).getTime()) {
        moveToQueue(state, appointment, timestamp, "system", "pushed-back");
        const { controllerIdentifier } = await resolveApportionAppointmentAccess(appointment, "system");
        addAppointmentNotifications(appointment, "Appointment moved to queue", `${appointment.serviceName || "Consultation"} at ${appointment.locationName}: the booked slot ended. Your appointment remains in the service-day queue without a fixed time.`, timestamp, controllerIdentifier);
        changed = true;
      }
      continue;
    }
    appointment.currentStatus = "missed";
    appointment.presentInPersonAt = null;
    appointment.statusUpdatedAt = timestamp;
    appointment.history.push(createHistoryEntry({
      action: "missed",
      actorIdentifier: "system",
      at: timestamp,
      toStartsAt: appointment.startsAt,
    }));
    const { controllerIdentifier } = await resolveApportionAppointmentAccess(appointment, "system");
    addAppointmentNotifications(appointment, "Appointment missed", `${appointment.serviceName || "Consultation"} at ${appointment.locationName} on ${appointment.serviceDateKey} was not completed before the service-day queue expired.`, timestamp, controllerIdentifier);
    changed = true;
  }

  return changed;
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
    const action = normalizeHistoryAction(entry?.action) ?? entry?.action;

    if (!action) {
      return null;
    }

    return {
      ...entry,
      action,
      actorIdentifier: entry.actorIdentifier ?? fallbackAppointment.requesterIdentifier,
      at: entry.at ?? fallbackAppointment.createdAt,
      fromStartsAt: entry.fromStartsAt ?? null,
      note: entry.note ?? null,
      toStartsAt: entry.toStartsAt ?? null,
    };
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

  return normalizedHistory;
}

function originalAppointmentStartsAt(appointment: Pick<ApportionAppointment, "history" | "startsAt">) {
  const bookedEntry = appointment.history.find((entry) => entry.action === "booked" && entry.toStartsAt);
  if (bookedEntry?.toStartsAt) return bookedEntry.toStartsAt;
  const earliestReschedule = appointment.history
    .filter((entry) => entry.action === "rescheduled" && entry.fromStartsAt)
    .sort((left, right) => left.at.localeCompare(right.at))[0];
  return earliestReschedule?.fromStartsAt ?? appointment.startsAt;
}

function normalizeMessages(appointment: Pick<ApportionAppointment, "createdAt" | "id" | "messages" | "notes" | "requesterIdentifier">) {
  const messages = (appointment.messages ?? []).filter((entry) => entry
    && typeof entry.id === "string"
    && typeof entry.authorIdentifier === "string"
    && typeof entry.createdAt === "string"
    && typeof entry.body === "string");
  const initialMessageId = `initial-note:${appointment.id}`;
  if (appointment.notes && !messages.some((entry) => entry.id === initialMessageId)) {
    messages.unshift({
      id: initialMessageId,
      authorIdentifier: appointment.requesterIdentifier,
      createdAt: appointment.createdAt,
      body: appointment.notes,
    });
  }
  return messages;
}

function normalizeAppointments(appointments: ApportionAppointment[]) {
  const bookedCountsByOwnerDay = new Map<string, number>();
  const owners: string[] = [];
  const ownerDayKeyFor = (appointment: ApportionAppointment) => {
    let ownerIdentifier = owners.find((identifier) => participantIdentifiersMatch(identifier, appointment.ownerIdentifier));
    if (!ownerIdentifier) {
      ownerIdentifier = appointment.ownerIdentifier;
      owners.push(ownerIdentifier);
    }
    return getOwnerDayKey({ ...appointment, ownerIdentifier });
  };

  const normalized = appointments
    .sort(compareAppointments)
    .map((appointment) => {
      const ownerDayKey = ownerDayKeyFor(appointment);
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

    const ownerDayKey = ownerDayKeyFor(appointment);
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
    ...parsed,
    invitations: (parsed.invitations ?? []).map((invitation) => ({ ...invitation,
      occurrences: invitation.occurrences.map((occurrence) => ({ ...occurrence })),
      appointmentIds: [...(invitation.appointmentIds ?? [])],
      notifications: (invitation.notifications ?? []).map((notification) => ({ ...notification })),
    })),
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
            ...appointment,
            serviceId: appointment.serviceId?.trim() || "consultation",
            serviceName: appointment.serviceName?.trim() || "Consultation",
            assignedStaffIdentifier: appointment.assignedStaffIdentifier === null ? null : appointment.assignedStaffIdentifier?.trim() || ownerIdentifier,
            bookedSettings: appointment.bookedSettings ? { ...appointment.bookedSettings } : undefined,
            notifications: (appointment.notifications ?? []).map((notification) => ({ ...notification })),
            canceledAt,
            canceledByIdentifier,
            bookedQueuePosition: Number.isFinite(appointment.bookedQueuePosition) ? appointment.bookedQueuePosition : 0,
            createdAt,
            currentStatus,
            history: [],
            id: appointment.id ?? createEntityId("appointment"),
            justAddToList: appointment.justAddToList === true,
            locationAddress: appointment.locationAddress?.trim() || "",
            locationId: appointment.locationId?.trim() || "location-1",
            locationName: appointment.locationName?.trim() || "Location 1",
            messages: [],
            notes: appointment.notes?.trim() || null,
            originalStartsAt: appointment.originalStartsAt?.trim() || undefined,
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
          normalizedAppointment.originalStartsAt ||= originalAppointmentStartsAt(normalizedAppointment);
          normalizedAppointment.messages = normalizeMessages({ ...normalizedAppointment, messages: appointment.messages ?? [] });

          return normalizedAppointment;
        })
        .filter((appointment) => appointment.ownerIdentifier && appointment.requesterIdentifier && appointment.startsAt),
    ),
  };
}

async function ensureStoreDirectory() {
  await mkdir(path.dirname(STORE_PATH), { recursive: true });
}

async function readState(applyLifecycle = true): Promise<ApportionState> {
  try {
    const rawValue = await readFile(STORE_PATH, "utf8");
    const parsed = JSON.parse(rawValue) as Partial<ApportionState>;
    const state = normalizeState(parsed);
    let changed = JSON.stringify(parsed) !== JSON.stringify(state);

    if (applyLifecycle && expireApportionInvitations(state)) changed = true;
    if (applyLifecycle && await applyMissedTransitions(state)) {
      state.appointments = normalizeAppointments(state.appointments);
      changed = true;
    }
    if (changed) await writeState(state);

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

async function writeState(state: ApportionState) {
  await ensureStoreDirectory();
  const temporaryPath = `${STORE_PATH}.${createEntityId("write")}.tmp`;
  try {
    await writeFile(temporaryPath, JSON.stringify(state, null, 2), "utf8");
    await rename(temporaryPath, STORE_PATH);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

export async function listApportionAppointmentsForOwner(ownerIdentifier: string) {
  return withAppointmentLock(async () => {
  const state = await readState();

  return state.appointments
    .filter((appointment) => participantIdentifiersMatch(appointment.ownerIdentifier, ownerIdentifier))
    .map((appointment) => ({ ...appointment, notifications: appointment.notifications?.filter((notification) => participantIdentifiersMatch(notification.recipientIdentifier, ownerIdentifier)) }))
    .sort(compareAppointments);
  });
}

export async function listApportionAppointmentsForRequester(requesterIdentifier: string) {
  return withAppointmentLock(async () => {
  const state = await readState();

  return state.appointments
    .filter((appointment) => participantIdentifiersMatch(appointment.requesterIdentifier, requesterIdentifier))
    .map((appointment) => ({ ...appointment, notifications: appointment.notifications?.filter((notification) => participantIdentifiersMatch(notification.recipientIdentifier, requesterIdentifier)) }))
    .sort(compareAppointments);
  });
}

export async function listApportionAppointmentsForActor(identifier: string) {
  return withAppointmentLock(async () => {
    const state = await readState();
    const contexts = new Map<string, ApportionBusinessContext | null>();
    for (const appointment of state.appointments) {
      if (!contexts.has(appointment.ownerIdentifier)) {
        contexts.set(appointment.ownerIdentifier, await getApportionBusinessContext(appointment.ownerIdentifier));
      }
    }
    const projections = state.appointments.map((appointment) => {
      const access = appointmentAccessFromContext(appointment, identifier, contexts.get(appointment.ownerIdentifier) ?? null);
      return access.canView ? { ...appointment, notifications: appointment.notifications?.filter((notification) => participantIdentifiersMatch(notification.recipientIdentifier, identifier)), canManage: access.canManage, canMessage: isActiveStatus(appointment.currentStatus) && (access.isRequester || access.canManage) } : null;
    });
    return projections.filter((entry): entry is NonNullable<typeof entry> => entry !== null).sort(compareAppointments);
  });
}

export async function listApportionSlotCounts(ownerIdentifier: string, locationId?: string, serviceId = "consultation") {
  return withAppointmentLock(async () => {
  const appointments = (await readState()).appointments
    .filter((appointment) => participantIdentifiersMatch(appointment.ownerIdentifier, ownerIdentifier))
    .filter((appointment) => appointment.serviceId === serviceId)
    .filter((appointment) => isActiveStatus(appointment.currentStatus))
    .filter((appointment) => !locationId || appointment.locationId === locationId);

  return Object.values(
    appointments.reduce<Record<string, { count: number; locationId: string; serviceId: string; startsAt: string }>>((counts, appointment) => {
      const key = `${appointment.locationId}::${appointment.startsAt}`;
      counts[key] = counts[key] ?? { count: 0, locationId: appointment.locationId, serviceId, startsAt: appointment.startsAt };
      counts[key].count += 1;
      return counts;
    }, {}),
  );
  });
}

type ApportionAppointmentInput = {
  appointmentsPerSlot?: number;
  serviceId?: string;
  bookedSettings?: ApportionProviderSettings;
  bookedQueuePosition?: number;
  justAddToList?: boolean;
  locationAddress?: string;
  locationId: string;
  locationName: string;
  notes?: string | null;
  ownerIdentifier: string;
  ownerName?: string | null;
  requesterIdentifier: string;
  requesterName: string;
  requesterPhone?: string | null;
  serviceDateKey?: string;
  startsAt: string;
};

export async function createApportionAppointment(input: ApportionAppointmentInput) {
  return withAppointmentLock(async () => {
    const state = await readState();
    const appointment = await buildApportionAppointment(state, input);
    state.appointments.push(appointment);
    state.appointments = normalizeAppointments(state.appointments);
    await writeState(state);
    return appointment;
  });
}

async function buildApportionAppointment(state: ApportionState, input: ApportionAppointmentInput, allowStartedSlot = false, validatedBooking?: Awaited<ReturnType<typeof resolveBookingContext>>) {
  const startsAt = new Date(input.startsAt);

  if (Number.isNaN(startsAt.getTime())) {
    throw new Error("Choose a valid appointment date and time.");
  }

  const ownerIdentifier = input.ownerIdentifier.trim();
  const requesterIdentifier = input.requesterIdentifier.trim();
  const locationId = input.locationId.trim();

  if (!ownerIdentifier || !requesterIdentifier || !locationId) {
    throw new Error("Appointment owner, requester, and location are required.");
  }

  const serviceId = input.serviceId?.trim() || "consultation";
  const booking = validatedBooking ?? await resolveBookingContext(ownerIdentifier, locationId, serviceId);
  if (!allowStartedSlot && !booking.settings.justAddToList && startsAt.getTime() <= Date.now()) {
    throw new Error("Choose a future appointment time.");
  }
  const serviceDateKey = resolveServiceDateKey(input.serviceDateKey, startsAt.toISOString(), allowStartedSlot);
  assertProviderOpenOnDay(booking.context, booking.providerIdentifier, locationId, serviceDateKey);
  const slotCount = state.appointments.filter((appointment) =>
    participantIdentifiersMatch(appointment.ownerIdentifier, ownerIdentifier)
    && appointment.locationId === locationId
    && appointment.serviceId === serviceId
    && isActiveStatus(appointment.currentStatus)
    && appointment.startsAt === startsAt.toISOString(),
  ).length;

  if (!booking.settings.justAddToList && slotCount >= booking.settings.appointmentsPerSlot) {
    throw new Error("This appointment slot is already full.");
  }

  const serviceDay = { ownerIdentifier: booking.context.business.ownerIdentifier, locationId, serviceId, serviceDateKey, startsAt: startsAt.toISOString() };
  const ownerDayAppointments = state.appointments.filter((appointment) => appointmentsShareServiceDay(appointment, serviceDay));
  const activeOwnerDayAppointments = ownerDayAppointments.filter((appointment) => isActiveStatus(appointment.currentStatus));
  const createdAt = new Date().toISOString();
  const bookedQueuePosition = Number.isFinite(input.bookedQueuePosition) && (input.bookedQueuePosition ?? 0) > 0
    ? Math.floor(input.bookedQueuePosition ?? 0)
    : ownerDayAppointments.length + 1;

  const appointment: ApportionAppointment = {
    serviceId,
    serviceName: booking.service.name,
    assignedStaffIdentifier: booking.service.assignedIdentifier,
    bookedSettings: { ...booking.settings },
    notifications: [],
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
    justAddToList: booking.settings.justAddToList,
    locationAddress: booking.location.address,
    locationId,
    locationName: booking.location.name,
    messages: [],
    notes: input.notes?.trim() || null,
    originalStartsAt: startsAt.toISOString(),
    ...bookingBoundaries({ assignedStaffIdentifier: booking.service.assignedIdentifier, locationId, serviceDateKey, startsAt: startsAt.toISOString() }, booking.context, booking.settings.slotDurationMinutes),
    ownerIdentifier: booking.context.business.ownerIdentifier,
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
  appointment.messages = normalizeMessages(appointment);

  return appointment;
}

function invitationProjection(invitation: ApportionInvitation, identifier: string): ApportionInvitation {
  return { ...invitation, notifications: invitation.notifications.filter((notification) => matchApportionIdentity(notification.recipientIdentifier, identifier)) };
}

function addInvitationNotifications(invitation: ApportionInvitation, title: string, body: string, timestamp: string) {
  for (const recipientIdentifier of [invitation.ownerIdentifier, invitation.requesterIdentifier]) {
    invitation.notifications.push({ id: createEntityId("apportion-notification"), recipientIdentifier, title, body,
      url: `/user?section=apportion&invitationId=${encodeURIComponent(invitation.id)}`, createdAt: timestamp, deliveredAt: null });
  }
}

function expireApportionInvitations(state: ApportionState) {
  let changed = false;
  const timestamp = new Date().toISOString();
  for (const invitation of state.invitations) {
    if (invitation.status !== "pending" || Date.now() < new Date(invitation.expiresAt).getTime()) continue;
    invitation.status = "expired";
    invitation.statusUpdatedAt = timestamp;
    addInvitationNotifications(invitation, "Appointment invitation expired", `${invitation.serviceName} at ${invitation.locationName}: the acceptance deadline has passed.`, timestamp);
    changed = true;
  }
  return changed;
}

async function validateInvitationOccurrence(ownerIdentifier: string, locationId: string, serviceId: string, occurrence: { serviceDateKey: string; startsAt: string }, allowPastDay = false, savedSettings?: ApportionProviderSettings) {
  const booking = await resolveBookingContext(ownerIdentifier, locationId, serviceId);
  if (savedSettings) booking.settings = { ...booking.settings, slotDurationMinutes: savedSettings.slotDurationMinutes, justAddToList: savedSettings.justAddToList };
  const startsAt = new Date(occurrence.startsAt);
  if (Number.isNaN(startsAt.getTime())) throw new Error("Choose a valid appointment date and time.");
  const serviceDateKey = resolveServiceDateKey(occurrence.serviceDateKey, startsAt.toISOString(), allowPastDay);
  assertProviderOpenOnDay(booking.context, booking.providerIdentifier, locationId, serviceDateKey);
  const master = resolveAppointmentLocationSchedule(booking.context.branding, locationId, serviceDateKey);
  if (!master) throw new Error("This address is unavailable on this day.");
  const membership = booking.providerIdentifier ? booking.context.memberships.find((entry) => entry.locationId === locationId
    && matchApportionIdentity(entry.ownerIdentifier, booking.context.business.ownerIdentifier)
    && matchApportionIdentity(entry.providerIdentifier, booking.providerIdentifier!)) : undefined;
  const provider = membership ? resolveAppointmentLocationSchedule({ ...booking.context.branding,
    appointmentLocations: [{ ...booking.location, ...membership }], appointmentDateOverrides: { closedDateKeys: [], openedDateKeys: [] },
    appointmentDateHoursOverrides: [], appointmentWeeklyHoursOverrides: [],
  }, locationId, serviceDateKey) : master;
  if (!provider) throw new Error("Provider unavailable on this day.");
  const weekday = new Date(`${serviceDateKey}T00:00:00Z`).getUTCDay();
  const masterIntervals = getApportionWeeklyIntervals({ dailyHours: [{ weekday, workingHours: master.workingHours, workingHoursSecondWindow: master.workingHoursSecondWindow }] });
  const providerIntervals = getApportionWeeklyIntervals({ dailyHours: [{ weekday, workingHours: provider.workingHours, workingHoursSecondWindow: provider.workingHoursSecondWindow }] });
  const effectiveIntervals = intersectApportionWeeklyIntervals(
    getApportionWeeklyIntervals({ dailyHours: [{ weekday: 0, workingHours: provider.workingHours, workingHoursSecondWindow: provider.workingHoursSecondWindow }] }),
    getApportionWeeklyIntervals({ dailyHours: [{ weekday: 0, workingHours: master.workingHours, workingHoursSecondWindow: master.workingHoursSecondWindow }] }),
  );
  if (!effectiveIntervals.length) throw new Error("Provider hours are outside the business schedule.");
  if (!booking.settings.justAddToList) {
    validateAppointmentLocationSlot({ location: provider, serviceDateKey, startsAt: startsAt.toISOString(), slotDurationMinutes: booking.settings.slotDurationMinutes });
    const day = new Date(`${serviceDateKey}T00:00:00+05:30`);
    const startMinute = (weekday * 1440 + (startsAt.getTime() - day.getTime()) / 60_000) % 10080;
    const endMinute = startMinute + booking.settings.slotDurationMinutes;
    const segments = [{ start: startMinute, end: Math.min(endMinute, 10080) }, ...(endMinute > 10080 ? [{ start: 0, end: endMinute - 10080 }] : [])];
    if (!segments.every((segment) => masterIntervals.some((interval) => interval.startMinute <= segment.start && interval.endMinute >= segment.end))) {
      throw new Error("Choose a slot within the current business hours.");
    }
  }
  return { booking, effectiveIntervals };
}

function estimateInvitationQueueStart(state: ApportionState, invitation: ApportionInvitation, occurrence: ApportionInvitation["occurrences"][number], validated: Awaited<ReturnType<typeof validateInvitationOccurrence>>) {
  const activeCount = state.appointments.filter((entry) => matchApportionIdentity(entry.ownerIdentifier, invitation.ownerIdentifier)
    && entry.locationId === invitation.locationId && entry.serviceId === invitation.serviceId
    && entry.serviceDateKey === occurrence.serviceDateKey && isActiveStatus(entry.currentStatus)).length;
  const { slotDurationMinutes, appointmentsPerSlot } = validated.booking.settings;
  let remaining = Math.ceil(activeCount / Math.max(1, appointmentsPerSlot)) * slotDurationMinutes;
  const dayStart = new Date(`${occurrence.serviceDateKey}T00:00:00+05:30`).getTime();
  for (const interval of validated.effectiveIntervals) {
    const start = Math.max(dayStart + interval.startMinute * 60_000, Date.now());
    const end = dayStart + interval.endMinute * 60_000;
    const available = Math.max(0, (end - start) / 60_000);
    if (remaining + slotDurationMinutes <= available) return new Date(start + remaining * 60_000).toISOString();
    remaining = Math.max(0, remaining - available);
  }
  throw new ApportionInvitationError("No queue appointment fits within the current working hours.");
}

export async function listApportionInvitationsForActor(identifier: string) {
  return withAppointmentLock(async () => (await readState()).invitations
    .filter((invitation) => matchApportionIdentity(invitation.ownerIdentifier, identifier) || matchApportionIdentity(invitation.requesterIdentifier, identifier))
    .map((invitation) => invitationProjection(invitation, identifier))
    .sort((first, second) => second.createdAt.localeCompare(first.createdAt)));
}

export async function createApportionInvitation(input: {
  actorIdentifier: string; ownerIdentifier: string; serviceId: string; locationId: string;
  requesterIdentifier: string; requesterName: string; requesterPhone?: string | null; notes?: string | null;
  occurrences: Array<{ serviceDateKey: string; startsAt: string }>;
}) {
  return withAppointmentLock(async () => {
    if (!input.actorIdentifier?.trim() || !input.ownerIdentifier?.trim() || !input.requesterIdentifier?.trim()) throw new ApportionInvitationError("Owner and registered requester are required.");
    if (!matchApportionIdentity(input.actorIdentifier, input.ownerIdentifier)) throw new ApportionInvitationError("Only the business owner can invite a requester.", 403);
    if (matchApportionIdentity(input.requesterIdentifier, input.ownerIdentifier)) throw new ApportionInvitationError("Use normal booking for your own appointment.");
    if (!Array.isArray(input.occurrences) || !input.occurrences.length || input.occurrences.length > 6) throw new ApportionInvitationError("Choose one to six total occurrences.");
    const occurrences: ApportionInvitation["occurrences"] = [];
    let snapshot: Awaited<ReturnType<typeof resolveBookingContext>> | undefined;
    for (const occurrence of input.occurrences) {
      const { booking } = await validateInvitationOccurrence(input.ownerIdentifier, input.locationId, input.serviceId, occurrence, false, snapshot?.settings);
      snapshot ??= booking;
      const startsAt = new Date(occurrence.startsAt).toISOString();
      if (occurrences.some((entry) => entry.serviceDateKey === occurrence.serviceDateKey)) throw new ApportionInvitationError("Choose distinct service days.");
      occurrences.push({ serviceDateKey: occurrence.serviceDateKey, startsAt,
        slotEndsAt: new Date(new Date(startsAt).getTime() + booking.settings.slotDurationMinutes * 60_000).toISOString() });
    }
    occurrences.sort((first, second) => first.startsAt.localeCompare(second.startsAt));
    if (new Date(occurrences[0].slotEndsAt).getTime() <= Date.now()) throw new ApportionInvitationError("The first appointment slot has already ended.");
    const booking = snapshot!;
    const timestamp = new Date().toISOString();
    const invitation: ApportionInvitation = {
      id: createEntityId("apportion-invitation"), status: "pending", ownerIdentifier: booking.context.business.ownerIdentifier,
      creatorIdentifier: input.actorIdentifier.trim(), requesterIdentifier: input.requesterIdentifier.trim(), requesterName: input.requesterName.trim() || "Registered user",
      requesterPhone: input.requesterPhone?.trim() || null, ownerName: booking.context.branding.instituteName || null,
      serviceId: booking.service.id, serviceName: booking.service.name, locationId: booking.location.id, locationName: booking.location.name,
      locationAddress: booking.location.address, notes: input.notes?.trim() || null, createdAt: timestamp, statusUpdatedAt: timestamp,
      expiresAt: occurrences[0].slotEndsAt, occurrences, appointmentIds: [], notifications: [], bookedSettings: { ...booking.settings },
    };
    addInvitationNotifications(invitation, "Appointment invitation", `${invitation.serviceName} at ${invitation.locationName}: ${occurrences.length} appointment(s) awaiting acceptance.`, timestamp);
    const state = await readState();
    state.invitations.push(invitation);
    await writeState(state);
    return invitationProjection(invitation, input.actorIdentifier);
  });
}

export async function respondToApportionInvitation(input: { actorIdentifier: string; invitationId: string; action: "accept" | "decline" | "cancel" }) {
  return withAppointmentLock(async () => {
    if (!["accept", "decline", "cancel"].includes(input.action)) throw new ApportionInvitationError("Choose a valid invitation action.");
    const state = await readState();
    const invitation = state.invitations.find((entry) => entry.id === input.invitationId);
    if (!invitation) throw new ApportionInvitationError("Invitation not found.");
    const authorized = matchApportionIdentity(input.actorIdentifier, input.action === "cancel" ? invitation.ownerIdentifier : invitation.requesterIdentifier);
    if (!authorized) throw new ApportionInvitationError(input.action === "cancel" ? "Only the owner can cancel this invitation." : "Only the target requester can respond to this invitation.", 403);
    const nextStatus = input.action === "accept" ? "accepted" : input.action === "decline" ? "declined" : "cancelled";
    if (invitation.status === nextStatus) return { invitation: invitationProjection(invitation, input.actorIdentifier), appointmentIds: [...invitation.appointmentIds] };
    if (invitation.status !== "pending") throw new ApportionInvitationError("This invitation is no longer pending.");
    const timestamp = new Date().toISOString();
    const staged: ApportionState = { ...state, appointments: [...state.appointments] };
    const appointments: ApportionAppointment[] = [];
    if (input.action === "accept") {
      for (const occurrence of invitation.occurrences) {
        const validated = await validateInvitationOccurrence(invitation.ownerIdentifier, invitation.locationId, invitation.serviceId, occurrence, true, invitation.bookedSettings);
        if (staged.appointments.some((entry) => appointmentsShareServiceDay(entry, { ...occurrence, ...invitation })
          && matchApportionIdentity(entry.requesterIdentifier, invitation.requesterIdentifier) && entry.currentStatus !== "cancelled" && entry.currentStatus !== "rejected")) {
          throw new ApportionInvitationError("The requester already has an appointment for this service day.");
        }
        const startsAt = validated.booking.settings.justAddToList ? estimateInvitationQueueStart(staged, invitation, occurrence, validated) : occurrence.startsAt;
        const appointment = await buildApportionAppointment(staged, { ...invitation, ...occurrence, startsAt }, true, validated.booking);
        staged.appointments.push(appointment);
        appointments.push(appointment);
      }
      for (const appointment of appointments) {
        const { controllerIdentifier } = await resolveApportionAppointmentAccess(appointment, input.actorIdentifier);
        addAppointmentNotifications(appointment, "Appointment booked", `${appointment.serviceName} at ${appointment.locationName} on ${appointment.serviceDateKey}: invitation accepted.`, timestamp, controllerIdentifier);
      }
    }
    state.appointments = normalizeAppointments(staged.appointments);
    invitation.appointmentIds = appointments.map((appointment) => appointment.id);
    invitation.status = nextStatus;
    invitation.statusUpdatedAt = timestamp;
    addInvitationNotifications(invitation, `Appointment invitation ${nextStatus}`, `${invitation.serviceName} at ${invitation.locationName}: invitation ${nextStatus}.`, timestamp);
    await writeState(state);
    return { invitation: invitationProjection(invitation, input.actorIdentifier), appointmentIds: [...invitation.appointmentIds] };
  });
}

function getLatestInPersonAppointment(state: ApportionState, ownerIdentifier: string, locationId: string, serviceDateKey: string, serviceId: string, excludedAppointmentId?: string) {
  const serviceDay = { ownerIdentifier, locationId, serviceDateKey, serviceId, startsAt: "" };

  return state.appointments
    .filter((appointment) => appointmentsShareServiceDay(appointment, serviceDay))
    .filter((appointment) => appointment.id !== excludedAppointmentId)
    .filter((appointment) => isActiveStatus(appointment.currentStatus))
    .sort(compareQueueOrder)[0] ?? null;
}

function reindexOwnerDayQueue(state: ApportionState, ownerIdentifier: string, locationId: string, serviceDateKey: string, serviceId: string) {
  const serviceDay = { ownerIdentifier, locationId, serviceDateKey, serviceId, startsAt: "" };

  state.appointments
    .filter((appointment) => appointmentsShareServiceDay(appointment, serviceDay))
    .filter((appointment) => isActiveStatus(appointment.currentStatus))
    .sort(compareQueueOrder)
    .forEach((appointment, index) => {
      appointment.queueOrder = index + 1;
    });
}

export async function updateApportionAppointment(input: {
  action: "cancel" | "done" | "present-in-person" | "push-back" | "reject" | "reschedule" | "send-message";
  actorIdentifier: string;
  appointmentsPerSlot?: number;
  appointmentId: string;
  nextServiceDateKey?: string;
  nextStartsAt?: string;
  notes?: string | null;
  message?: string;
  requesterOnly?: boolean;
}) {
  return withAppointmentLock(async () => {
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

  const { canManage, isRequester, controllerIdentifier } = await resolveApportionAppointmentAccess(appointment, actorIdentifier);

  if (!canManage && !isRequester) {
    throw new Error("You can only update your own appointments.");
  }

  const timestamp = new Date().toISOString();

  if (input.action === "send-message") {
    if (!canManage && !isRequester) throw new Error("Only the requester or current controller can send a message.");
    if (!isActiveStatus(appointment.currentStatus)) throw new Error("Messages are closed for this appointment.");
    const body = input.message?.trim() ?? "";
    if (!body || body.length > 2000 || /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(body)) {
      throw new Error("Enter a message of 1 to 2000 characters without control characters.");
    }
    appointment.messages.push({ id: createEntityId("message"), authorIdentifier: actorIdentifier, createdAt: timestamp, body });
    await writeState(state);
    return { appointment, nextInPersonAppointment: null };
  } else if (input.action === "cancel") {
    if (!isRequester) throw new Error("Only the requester can cancel this appointment.");

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
    if (!canManage) {
      throw new Error("Only the current controller can mark a user present in person.");
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
    if (!canManage) {
      throw new Error("Only the current controller can mark an appointment done.");
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
    if (!canManage) {
      throw new Error("Only the current controller can push back an appointment.");
    }

    if (!isActiveStatus(appointment.currentStatus)) {
      throw new Error("Only active appointments can be pushed back.");
    }

    const activeAppointments = state.appointments
      .filter((entry) => appointmentsShareServiceDay(entry, appointment))
      .filter((entry) => isActiveStatus(entry.currentStatus))
      .sort(compareQueueOrder);
    const currentIndex = activeAppointments.findIndex((entry) => entry.id === appointment.id);

    if (currentIndex === -1) {
      throw new Error("Appointment queue could not be updated.");
    }

    const remainingAppointments = activeAppointments.filter((entry) => entry.id !== appointment.id);
    const targetIndex = Math.min(remainingAppointments.length, currentIndex + 4);
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
    if (!canManage) {
      throw new Error("Only the current controller can reject an appointment.");
    }

    if (!isActiveStatus(appointment.currentStatus)) {
      throw new Error("Only active appointments can be rejected.");
    }

    moveToQueue(state, appointment, timestamp, actorIdentifier, "rejected");
    addAppointmentNotifications(appointment, "Appointment moved back", `${appointment.serviceName || "Consultation"} at ${appointment.locationName}: marked absent and moved in the service-day queue.`, timestamp, controllerIdentifier);
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

    if (appointment.justAddToList) throw new Error("Queue appointments cannot be rescheduled.");
    const booking = await resolveBookingContext(appointment.ownerIdentifier, appointment.locationId, appointment.serviceId || "consultation", true);
    const nextServiceDateKey = resolveServiceDateKey(input.nextServiceDateKey, nextStartsAt.toISOString());
    assertProviderOpenOnDay(booking.context, booking.providerIdentifier, appointment.locationId, nextServiceDateKey);
    const slotCount = state.appointments.filter((entry) =>
      entry.id !== appointment.id
      && participantIdentifiersMatch(entry.ownerIdentifier, appointment.ownerIdentifier)
      && entry.locationId === appointment.locationId
      && entry.serviceId === appointment.serviceId
      && isActiveStatus(entry.currentStatus)
      && entry.startsAt === nextStartsAt.toISOString(),
    ).length;

    if (slotCount >= (appointment.bookedSettings?.appointmentsPerSlot ?? booking.settings.appointmentsPerSlot)) {
      throw new Error("This appointment slot is already full.");
    }

    const previousStartsAt = appointment.startsAt;
    appointment.startsAt = nextStartsAt.toISOString();
    appointment.serviceDateKey = nextServiceDateKey;
    Object.assign(appointment, bookingBoundaries(appointment, booking.context, appointment.bookedSettings?.slotDurationMinutes ?? booking.settings.slotDurationMinutes));
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

    const sameDayAppointments = state.appointments
      .filter((entry) => entry.id !== appointment.id)
      .filter((entry) => appointmentsShareServiceDay(entry, appointment))
      .filter((entry) => isActiveStatus(entry.currentStatus))
      .sort(compareQueueOrder);
    appointment.queueOrder = sameDayAppointments.length + 1;
  }

  reindexOwnerDayQueue(state, appointment.ownerIdentifier, appointment.locationId, appointment.serviceDateKey, appointment.serviceId || "consultation");
  state.appointments = normalizeAppointments(state.appointments);
  await writeState(state);

  return {
    appointment,
    nextInPersonAppointment: (input.action === "done" || input.action === "push-back")
      ? getLatestInPersonAppointment(state, appointment.ownerIdentifier, appointment.locationId, appointment.serviceDateKey, appointment.serviceId || "consultation", appointment.id)
      : null,
  };
  });
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

export async function applyApportionAddressOptOut(ownerIdentifier: string, locationId: string, providerIdentifier: string, optedOutDateKey?: string, optedOutAt?: string) {
  return withAppointmentLock(async () => {
    const state = await readState();
    const cutoff = optedOutDateKey ?? getAppointmentDayKey(new Date().toISOString());
    const timestamp = new Date().toISOString();
    const changed: ApportionAppointment[] = [];
    for (const appointment of state.appointments) {
      const latestHistory = appointment.history[appointment.history.length - 1];
      const missedAfterOptOut = appointment.currentStatus === "missed" && Boolean(optedOutAt)
        && appointment.serviceDateKey > cutoff && latestHistory?.action === "missed"
        && latestHistory.actorIdentifier === "system" && latestHistory.at === appointment.statusUpdatedAt
        && new Date(appointment.statusUpdatedAt).getTime() >= new Date(optedOutAt!).getTime();
      if (!participantIdentifiersMatch(appointment.ownerIdentifier, ownerIdentifier)
        || appointment.locationId !== locationId
        || !appointment.assignedStaffIdentifier
        || !participantIdentifiersMatch(appointment.assignedStaffIdentifier, providerIdentifier)
        || (!isActiveStatus(appointment.currentStatus) && !missedAfterOptOut)
        || appointment.serviceDateKey < cutoff) continue;
      const note = `Provider opted out of address ${locationId}.`;
      if (appointment.serviceDateKey === cutoff) {
        if (appointment.history.some((entry) => entry.action === "address-opt-out" && entry.note === note
          && participantIdentifiersMatch(entry.actorIdentifier, providerIdentifier))) continue;
        appointment.history.push(createHistoryEntry({ action: "address-opt-out", actorIdentifier: providerIdentifier, at: timestamp, toStartsAt: appointment.startsAt, note }));
      } else {
        appointment.currentStatus = "cancelled";
        appointment.canceledAt = timestamp;
        appointment.canceledByIdentifier = providerIdentifier;
        appointment.presentInPersonAt = null;
        appointment.statusUpdatedAt = timestamp;
        appointment.history.push(createHistoryEntry({ action: "cancelled", actorIdentifier: providerIdentifier, at: timestamp, toStartsAt: appointment.startsAt, note }));
        const { controllerIdentifier } = await resolveApportionAppointmentAccess(appointment, providerIdentifier);
        const recipients = [appointment.requesterIdentifier, appointment.ownerIdentifier, providerIdentifier, controllerIdentifier]
          .filter((identifier): identifier is string => Boolean(identifier))
          .filter((identifier, index, identifiers) => !identifiers.slice(0, index).some((other) => participantIdentifiersMatch(identifier, other)));
        appointment.notifications ??= [];
        for (const recipientIdentifier of recipients) {
          appointment.notifications.push({
            id: createEntityId("apportion-notification"), recipientIdentifier,
            title: "Appointment cancelled",
            body: `${appointment.serviceName || "Consultation"} at ${appointment.locationName} on ${appointment.serviceDateKey} was cancelled because the provider left this address.`,
            url: "/user?section=apportion", createdAt: timestamp, deliveredAt: null,
          });
        }
      }
      changed.push(appointment);
    }
    if (changed.length) {
      state.appointments = normalizeAppointments(state.appointments);
      await writeState(state);
    }
    return changed;
  });
}

export async function reconcileApportionLifecycle() {
  return withAppointmentLock(async () => {
    const before = await readFile(STORE_PATH, "utf8").catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return ""; throw error; });
    const state = await readState();
    return JSON.stringify(JSON.parse(before || '{"appointments":[]}')) !== JSON.stringify(state);
  });
}

export async function applyApportionProviderLeave(providerIdentifier: string, closedDateKeys: string[], leaveDateKey: string, leaveAt: string) {
  return withAppointmentLock(async () => {
    const state = await readState(false);
    const timestamp = new Date().toISOString();
    const changed: ApportionAppointment[] = [];
    const contexts = new Map<string, ApportionBusinessContext | null>();
    for (const appointment of state.appointments) {
      const missedAfterLeave = appointment.currentStatus === "missed" && appointment.history.at(-1)?.actorIdentifier === "system"
        && new Date(appointment.statusUpdatedAt).getTime() >= new Date(leaveAt).getTime();
      if ((!isActiveStatus(appointment.currentStatus) && !missedAfterLeave) || appointment.serviceDateKey <= leaveDateKey
        || !closedDateKeys.includes(appointment.serviceDateKey) || !appointment.assignedStaffIdentifier
        || !participantIdentifiersMatch(appointment.assignedStaffIdentifier, providerIdentifier)) continue;
      if (!contexts.has(appointment.ownerIdentifier)) contexts.set(appointment.ownerIdentifier, await getApportionBusinessContext(appointment.ownerIdentifier));
      const context = contexts.get(appointment.ownerIdentifier);
      const service = context?.business.services.find((entry) => entry.id === appointment.serviceId);
      const stillClosed = Object.entries(context?.providerClosedDateKeys ?? {}).some(([identifier, dates]) => participantIdentifiersMatch(identifier, providerIdentifier) && dates.includes(appointment.serviceDateKey));
      if (!service?.assignedIdentifier || !participantIdentifiersMatch(service.assignedIdentifier, providerIdentifier)
        || !service.locationIds.includes(appointment.locationId) || !stillClosed) continue;
      appointment.currentStatus = "cancelled";
      appointment.canceledAt = timestamp;
      appointment.canceledByIdentifier = providerIdentifier;
      appointment.presentInPersonAt = null;
      appointment.statusUpdatedAt = timestamp;
      appointment.history.push(createHistoryEntry({ action: "cancelled", actorIdentifier: providerIdentifier, at: timestamp,
        toStartsAt: appointment.startsAt, note: "Provider marked future leave." }));
      const { controllerIdentifier } = await resolveApportionAppointmentAccess(appointment, providerIdentifier);
      addAppointmentNotifications(appointment, "Appointment cancelled", `${appointment.serviceName || "Consultation"} at ${appointment.locationName} on ${appointment.serviceDateKey} was cancelled because the provider is on leave.`, timestamp, controllerIdentifier);
      changed.push(appointment);
    }
    let invitationsChanged = false;
    for (const invitation of state.invitations) {
      const expiredAfterLeave = invitation.status === "expired"
        && new Date(invitation.statusUpdatedAt).getTime() >= new Date(leaveAt).getTime()
        && invitation.notifications.some((notice) => notice.title === "Appointment invitation expired" && notice.createdAt === invitation.statusUpdatedAt);
      if (invitation.status !== "pending" && !expiredAfterLeave) continue;
      if (!contexts.has(invitation.ownerIdentifier)) contexts.set(invitation.ownerIdentifier, await getApportionBusinessContext(invitation.ownerIdentifier));
      const context = contexts.get(invitation.ownerIdentifier);
      const service = context?.business.services.find((entry) => entry.id === invitation.serviceId);
      if (!service?.assignedIdentifier || !matchApportionIdentity(service.assignedIdentifier, providerIdentifier)
        || !service.locationIds.includes(invitation.locationId)) continue;
      const currentClosedDates = Object.entries(context?.providerClosedDateKeys ?? {})
        .find(([identifier]) => matchApportionIdentity(identifier, providerIdentifier))?.[1] ?? [];
      const remaining = invitation.occurrences.filter((occurrence) => occurrence.serviceDateKey <= leaveDateKey
        || !closedDateKeys.includes(occurrence.serviceDateKey) || !currentClosedDates.includes(occurrence.serviceDateKey));
      if (remaining.length === invitation.occurrences.length) continue;
      if (expiredAfterLeave) invitation.notifications = invitation.notifications.filter((notice) => notice.deliveredAt
        || notice.title !== "Appointment invitation expired" || new Date(notice.createdAt).getTime() < new Date(leaveAt).getTime());
      invitation.occurrences = remaining;
      invitation.statusUpdatedAt = timestamp;
      if (remaining.length) {
        invitation.expiresAt = remaining[0].slotEndsAt;
        invitation.status = "pending";
      }
      else invitation.status = "cancelled";
      addInvitationNotifications(invitation, remaining.length ? "Appointment invitation updated" : "Appointment invitation cancelled",
        `${invitation.serviceName} at ${invitation.locationName}: future leave removed appointment dates. ${remaining.length} appointment(s) remain.`, timestamp);
      invitationsChanged = true;
    }
    if (invitationsChanged) expireApportionInvitations(state);
    if (changed.length || invitationsChanged) {
      state.appointments = normalizeAppointments(state.appointments);
      await writeState(state);
    }
    return changed;
  });
}

export async function listApportionNotificationsForActor(identifier: string) {
  return withAppointmentLock(async () => apportionNotifications(await readState())
    .filter((notification) => matchApportionIdentity(notification.recipientIdentifier, identifier))
    .sort((first, second) => second.createdAt.localeCompare(first.createdAt)));
}

export async function listApportionPendingNotifications() {
  return withAppointmentLock(async () => apportionNotifications(await readState())
    .filter((notification) => !notification.deliveredAt));
}

export async function markApportionNotificationDelivered(notificationId: string) {
  return withAppointmentLock(async () => {
    const state = await readState();
    const notification = apportionNotifications(state).find((entry) => entry.id === notificationId);
    if (notification && !notification.deliveredAt) {
      notification.deliveredAt = new Date().toISOString();
      await writeState(state);
    }
    return notification ?? null;
  });
}

function apportionNotifications(state: ApportionState) {
  return [...state.appointments.flatMap((appointment) => appointment.notifications ?? []),
    ...state.invitations.flatMap((invitation) => invitation.notifications)];
}