import "server-only";

import {
  assertApportionAddressCapacity,
  assertApportionServiceAssignment,
  clipApportionDailySchedule,
  createEntityId,
  getApportionBookableServices,
  getApportionServiceLimit,
  migrateApportionDirectory,
  normalizeApportionProviderSettings,
  normalizeWorkspaceBranding,
  participantIdentifiersMatch,
  resolveApportionDailySchedule,
  type AppointmentDailyHours,
  type ApportionAddressMembership,
  type ApportionBusiness,
  type ApportionProviderSettings,
  type ApportionService,
  type AppointmentLocation,
  type TestingWorkspaceState,
  type WorkspaceBranding,
} from "@trapit/testing";
import { isWebAuthConfigured } from "./auth-config";
import { listRegisteredDirectoryUsers } from "./cognito";
import {
  mutateWorkspaceBrandingState,
  readApportionWorkspaceState,
  withSerializedTestingMutation,
} from "./testing-store";
import { listUserCategoryManagementState } from "./user-category-store";
import type { WorkspaceActor } from "./workspace-actor";

export class ApportionDirectoryError extends Error {
  constructor(message: string, public readonly status: 400 | 403 = 400) {
    super(message);
  }
}

export type ApportionBusinessContext = {
  business: ApportionBusiness;
  branding: WorkspaceBranding;
  ownerCategory: string;
  providerSettings: Record<string, ApportionProviderSettings>;
  memberships: ApportionAddressMembership[];
  providerClosedDateKeys?: Record<string, string[]>;
};

export type ApportionPanelInput =
  | { operation: "set-service"; ownerIdentifier?: string; service: ApportionService }
  | { operation: "set-delegate"; ownerIdentifier?: string; delegateIdentifier: string | null }
  | { operation: "set-settings"; ownerIdentifier?: string; settings: ApportionProviderSettings }
  | { operation: "set-hours"; ownerIdentifier: string; locationId: string; hours: Pick<ApportionAddressMembership, "closedDateKeys"> & Partial<Pick<ApportionAddressMembership, "workingDays" | "workingHours" | "workingHoursSecondWindow">> & { dailyHours?: AppointmentDailyHours[] } }
  | { operation: "set-leaves"; closedDateKeys: string[] }
  | { operation: "unlink-address"; ownerIdentifier: string; locationId: string }
  | { operation: "business-branding"; ownerIdentifier?: string; branding: WorkspaceBranding | null; updateProviderSettings?: boolean };

const matches = participantIdentifiersMatch;

function identifierKey<T>(values: Record<string, T>, identifier: string) {
  return Object.keys(values).find((key) => matches(key, identifier));
}

function directory(state: TestingWorkspaceState) {
  state.apportionDirectory ??= migrateApportionDirectory(state.workspaceBrandingByActor);
  return state.apportionDirectory;
}

function actorIdentifier(actor: WorkspaceActor) {
  const identifier = actor.identifier?.trim() || actor.phoneNumber?.trim();
  if (!identifier) throw new ApportionDirectoryError("Signed-in phone access is required.", 403);
  return identifier;
}

async function registeredUsers(state: TestingWorkspaceState) {
  return isWebAuthConfigured()
    ? listRegisteredDirectoryUsers()
    : state.participants.map((participant) => ({ ...participant, sub: null }));
}

async function resolveRegisteredPhone(state: TestingWorkspaceState, input: string) {
  if (typeof input !== "string") throw new ApportionDirectoryError("Enter a full registered phone number.");
  const phone = input.trim().replace(/[\s()-]/g, "");
  if (!/^(?:\+[1-9]\d{7,14}|\d{10})$/.test(phone)) {
    throw new ApportionDirectoryError("Enter a full registered phone number.");
  }
  const user = (await registeredUsers(state)).find((entry) => matches(entry.identifier, phone));
  if (!user) throw new ApportionDirectoryError("No registered user was found for that phone number.");
  return user.identifier.trim().toLowerCase();
}

async function resolveOwnerCategory(state: TestingWorkspaceState, ownerIdentifier: string, verifiedActor?: WorkspaceActor) {
  const { activeAssignments } = await listUserCategoryManagementState();
  const phoneAssignments = activeAssignments.filter((entry) => entry.userIdentifier && matches(entry.userIdentifier, ownerIdentifier));
  let assignments = phoneAssignments;
  if (!assignments.length) {
    const registered = verifiedActor?.sub && verifiedActor.identifier && matches(verifiedActor.identifier, ownerIdentifier)
      ? { sub: verifiedActor.sub }
      : (await registeredUsers(state)).find((entry) => matches(entry.identifier, ownerIdentifier));
    if (!registered) return "unknown";
    assignments = activeAssignments.filter((entry) => registered.sub && entry.userSub === registered.sub);
  }
  const assignment = assignments
    .filter((entry) => !entry.expiresAt || new Date(entry.expiresAt).getTime() > Date.now())
    .sort((first, second) => second.assignedAt.localeCompare(first.assignedAt))[0];
  return assignment?.category ?? "trapit-normal";
}

function ownSettings(state: TestingWorkspaceState, identifier: string) {
  const values = directory(state).providerSettings;
  const key = identifierKey(values, identifier);
  return key ? values[key] : normalizeApportionProviderSettings();
}

function contextFromState(state: TestingWorkspaceState, identifier: string, ownerCategory: string): ApportionBusinessContext | null {
  const values = directory(state);
  const key = identifierKey(values.businesses, identifier);
  const brandingKey = identifierKey(state.workspaceBrandingByActor, identifier);
  if (!key || !brandingKey) return null;
  const business = values.businesses[key];
  const providers = [business.ownerIdentifier, ...business.services.map((service) => service.assignedIdentifier).filter((value): value is string => Boolean(value))];
  return {
    business,
    branding: state.workspaceBrandingByActor[brandingKey],
    ownerCategory,
    providerSettings: Object.fromEntries(providers.map((provider) => [provider, ownSettings(state, provider)])),
    memberships: values.memberships.filter((membership) => matches(membership.ownerIdentifier, business.ownerIdentifier)),
    providerClosedDateKeys: Object.fromEntries(providers.map((provider) => {
      const closedKey = identifierKey(values.providerClosedDateKeys ?? {}, provider);
      return [provider, closedKey ? values.providerClosedDateKeys![closedKey] : []];
    })),
  };
}

export async function getApportionBusinessContext(ownerIdentifier: string): Promise<ApportionBusinessContext | null> {
  const state = await readApportionWorkspaceState();
  const category = await resolveOwnerCategory(state, ownerIdentifier);
  return contextFromState(state, ownerIdentifier, category);
}

export async function listApportionDirectLinkServices(providerIdentifier: string) {
  const state = await readApportionWorkspaceState();
  const values = directory(state);
  const directServices = await Promise.all(Object.values(values.businesses).map(async (business) => {
    const category = await resolveOwnerCategory(state, business.ownerIdentifier);
    if (!getApportionServiceLimit(category)) return [];
    const brandingKey = identifierKey(state.workspaceBrandingByActor, business.ownerIdentifier);
    const branding = brandingKey ? state.workspaceBrandingByActor[brandingKey] : null;
    if (!branding) return [];
    const ownsBusiness = matches(business.ownerIdentifier, providerIdentifier);
    return getApportionBookableServices(business, category).flatMap((service) => {
      if (!ownsBusiness && !matches(service.assignedIdentifier ?? "", providerIdentifier)) return [];
      const locationIds = service.locationIds.filter((locationId) =>
        branding.appointmentLocations?.some((location) => location.id === locationId)
        && (ownsBusiness || values.memberships.some((membership) => membership.locationId === locationId
          && matches(membership.ownerIdentifier, business.ownerIdentifier)
          && matches(membership.providerIdentifier, providerIdentifier))),
      );
      if (!locationIds.length) return [];
      return [{
        businessName: branding.instituteName,
        id: service.id,
        locationIds,
        name: service.name,
        ownerIdentifier: business.ownerIdentifier,
      }];
    });
  }));
  return directServices.flat();
}

async function panelFromState(state: TestingWorkspaceState, actor: WorkspaceActor) {
  const identifier = actorIdentifier(actor);
  const values = directory(state);
  const businesses: Array<ApportionBusinessContext & { role: "owner" | "admin" | "staff"; bookableServiceIds: string[] }> = [];
  for (const business of Object.values(values.businesses)) {
    const role = matches(business.ownerIdentifier, identifier) ? "owner"
      : business.adminDelegateIdentifier && matches(business.adminDelegateIdentifier, identifier) ? "admin"
      : business.services.some((service) => service.assignedIdentifier && matches(service.assignedIdentifier, identifier)) ? "staff" : null;
    if (!role) continue;
    const category = await resolveOwnerCategory(state, business.ownerIdentifier, actor);
    const context = contextFromState(state, business.ownerIdentifier, category);
    if (!context) continue;
    const bookableServiceIds = getApportionBookableServices(business, category).map((service) => service.id);
    if (role === "staff") {
      const memberships = context.memberships.filter((membership) => matches(membership.providerIdentifier, identifier));
      const locationIds = new Set(memberships.map((membership) => membership.locationId));
      const locations = context.branding.appointmentLocations?.filter((location) => locationIds.has(location.id)) ?? [];
      businesses.push({
        ...context,
        role,
        business: { ...business, services: business.services.filter((service) => service.assignedIdentifier && matches(service.assignedIdentifier, identifier)) },
        branding: { ...context.branding, appointmentLocations: locations, address: locations[0]?.address ?? "", workingDays: locations[0]?.workingDays ?? "", workingHours: locations[0]?.workingHours ?? "", workingHoursSecondWindow: locations[0]?.workingHoursSecondWindow ?? "", appointmentDateHoursOverrides: context.branding.appointmentDateHoursOverrides?.map((entry) => ({ ...entry, locations: entry.locations.filter((location) => locationIds.has(location.locationId)) })), appointmentWeeklyHoursOverrides: context.branding.appointmentWeeklyHoursOverrides?.map((entry) => ({ ...entry, locations: entry.locations.filter((location) => locationIds.has(location.locationId)) })) },
        memberships,
        providerSettings: { [identifier]: ownSettings(state, identifier) },
        bookableServiceIds: bookableServiceIds.filter((serviceId) => business.services.some((service) => service.id === serviceId && service.assignedIdentifier && matches(service.assignedIdentifier, identifier))),
      });
    } else {
      businesses.push({ ...context, role, bookableServiceIds });
    }
  }
  return {
    canCreateBusiness: getApportionServiceLimit(await resolveOwnerCategory(state, identifier, actor)) > 0,
    businesses,
    providerSettings: ownSettings(state, identifier),
    memberships: values.memberships.filter((membership) => matches(membership.providerIdentifier, identifier)),
    providerClosedDateKeys: (() => {
      const key = identifierKey(values.providerClosedDateKeys ?? {}, identifier);
      return key ? values.providerClosedDateKeys![key] : [];
    })(),
  };
}

export async function getApportionPanel(actor: WorkspaceActor) {
  await reconcileApportionAddressOptOuts();
  await reconcileApportionProviderLeaves();
  return panelFromState(await readApportionWorkspaceState(), actor);
}

export async function reconcileApportionAddressOptOuts() {
  const pending = (await readApportionWorkspaceState()).apportionDirectory?.pendingAddressOptOuts ?? [];
  if (!pending.length) return;
  const { applyApportionAddressOptOut } = await import("./apportion-store");
  for (const operation of pending) {
    await applyApportionAddressOptOut(operation.ownerIdentifier, operation.locationId, operation.providerIdentifier, operation.optedOutDateKey, operation.optedOutAt);
    await withSerializedTestingMutation((state) => {
      const values = directory(state);
      values.pendingAddressOptOuts = (values.pendingAddressOptOuts ?? []).filter((entry) => operation.id
        ? entry.id !== operation.id
        : Boolean(entry.id) || entry.locationId !== operation.locationId
          || !matches(entry.ownerIdentifier, operation.ownerIdentifier) || !matches(entry.providerIdentifier, operation.providerIdentifier)
          || entry.optedOutDateKey !== operation.optedOutDateKey || entry.optedOutAt !== operation.optedOutAt);
    });
  }
}

/** Returns no appointments; successful intents are acknowledged, while failures reject and remain retryable. */
export async function reconcileApportionProviderLeaves(): Promise<void> {
  const pending = (await readApportionWorkspaceState()).apportionDirectory?.pendingProviderLeaves ?? [];
  if (!pending.length) return;
  for (const operation of pending) {
    const values = (await readApportionWorkspaceState()).apportionDirectory;
    if (!values?.pendingProviderLeaves?.some((entry) => entry.id === operation.id)) continue;
    const key = identifierKey(values.providerClosedDateKeys ?? {}, operation.providerIdentifier);
    const closedDates = key ? values.providerClosedDateKeys![key] : [];
    const closedDateKeys = operation.closedDateKeys.filter((date) => date > operation.leaveDateKey && closedDates.includes(date));
    if (closedDateKeys.length) {
      const { applyApportionProviderLeave } = await import("./apportion-store");
      await applyApportionProviderLeave(operation.providerIdentifier, closedDateKeys, operation.leaveDateKey, operation.leaveAt);
    }
    await withSerializedTestingMutation((state) => {
      const latest = directory(state);
      latest.pendingProviderLeaves = (latest.pendingProviderLeaves ?? []).filter((entry) => entry.id !== operation.id);
    });
  }
}

export async function listApportionScheduleNotificationsForActor(identifier: string) {
  const state = await readApportionWorkspaceState();
  return (state.apportionDirectory?.scheduleNotifications ?? [])
    .filter((notification) => matches(notification.recipientIdentifier, identifier))
    .sort((first, second) => second.createdAt.localeCompare(first.createdAt))
    .map((notification) => ({
      ...notification,
      title: "Schedule updated",
      body: notification.message,
      url: "/user?section=apportion",
    }));
}

export async function listPendingApportionScheduleNotifications() {
  const state = await readApportionWorkspaceState();
  return (state.apportionDirectory?.scheduleNotifications ?? []).filter((notification) => !notification.deliveredAt);
}

export async function markApportionScheduleNotificationDelivered(notificationId: string) {
  let delivered: { id: string; recipientIdentifier: string; message: string; createdAt: string; deliveredAt?: string } | null = null;
  await withSerializedTestingMutation((state) => {
    const notification = directory(state).scheduleNotifications.find((entry) => entry.id === notificationId);
    if (notification && !notification.deliveredAt) notification.deliveredAt = new Date().toISOString();
    delivered = notification ?? null;
  });
  return delivered;
}

type Interval = { start: number; end: number };
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function timeMinutes(value: string) {
  const match = value.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?$/i);
  if (!match) throw new ApportionDirectoryError("Invalid working-hours time.");
  let hour = Number(match[1]);
  const minute = Number(match[2] ?? "0");
  const suffix = match[3]?.toUpperCase();
  if (minute > 59 || hour > (suffix ? 12 : 24) || (suffix && hour < 1) || (!suffix && hour === 24 && minute !== 0)) throw new ApportionDirectoryError("Invalid working-hours time.");
  if (suffix) hour = hour % 12 + (suffix === "PM" ? 12 : 0);
  return hour * 60 + minute;
}

type ApportionHours = Partial<Pick<AppointmentLocation, "workingDays" | "workingHours" | "workingHoursSecondWindow">> & { dailyHours?: AppointmentDailyHours[] };

function weeklyIntervals(hours: ApportionHours, allowEmpty = false): Interval[] {
  let dailyHours: AppointmentDailyHours[];
  if (hours.dailyHours !== undefined) {
    if (!Array.isArray(hours.dailyHours) || hours.dailyHours.length !== 7
      || hours.dailyHours.some((entry) => !entry || !Number.isInteger(entry.weekday) || entry.weekday < 0 || entry.weekday > 6
        || typeof entry.workingHours !== "string" || typeof entry.workingHoursSecondWindow !== "string")
      || new Set(hours.dailyHours.map((entry) => entry.weekday)).size !== 7) {
      throw new ApportionDirectoryError("Choose valid daily working hours for all seven days.");
    }
    dailyHours = resolveApportionDailySchedule({ dailyHours: hours.dailyHours });
  } else {
    if (typeof hours.workingDays !== "string" || typeof hours.workingHours !== "string" || typeof hours.workingHoursSecondWindow !== "string") {
      throw new ApportionDirectoryError("Complete valid working hours.");
    }
    const tokens = hours.workingDays.toLowerCase().split(/[\s,;/|]+/).filter(Boolean);
    const days = WEEKDAYS.flatMap((day, index) => tokens.includes(day.toLowerCase()) || tokens.includes(day.slice(0, 3).toLowerCase()) ? [index] : []);
    if ((!days.length && !allowEmpty) || tokens.some((token) => !WEEKDAYS.some((day) => [day.toLowerCase(), day.slice(0, 3).toLowerCase()].includes(token)))) throw new ApportionDirectoryError("Choose valid working days.");
    dailyHours = resolveApportionDailySchedule(hours);
  }
  const intervals = dailyHours.flatMap((entry) => [entry.workingHours, entry.workingHoursSecondWindow].flatMap((range) => {
    if (!range.trim()) return [];
    const parts = range.split(/\s*-\s*/);
    if (parts.length !== 2) throw new ApportionDirectoryError("Invalid working-hours range.");
    const startMinute = timeMinutes(parts[0]);
    const endMinute = timeMinutes(parts[1]);
    if (startMinute >= 1440 || (endMinute >= 1440 && endMinute !== 1440)) throw new ApportionDirectoryError("Invalid working-hours time.");
    const start = entry.weekday * 1440 + startMinute;
    const end = start + ((endMinute - startMinute + 1440) % 1440 || 1440);
    return end <= 10080 ? [{ start, end }] : [{ start, end: 10080 }, { start: 0, end: end - 10080 }];
  }));
  if (!intervals.length && !allowEmpty) throw new ApportionDirectoryError("Working hours are required.");
  if (intervals.some((first, firstIndex) => intervals.some((second, secondIndex) => firstIndex < secondIndex && overlaps(first, second)))) throw new ApportionDirectoryError("Working-hour windows cannot overlap.");
  return intervals;
}

function overlaps(first: Interval, second: Interval) {
  return first.start < second.end && second.start < first.end;
}

export function assertApportionHoursWithinMaster(hours: ApportionHours, master: AppointmentLocation) {
  const allowed = weeklyIntervals(master).sort((first, second) => first.start - second.start);
  const merged: Interval[] = [];
  for (const interval of allowed) {
    const previous = merged[merged.length - 1];
    if (previous && interval.start <= previous.end) previous.end = Math.max(previous.end, interval.end);
    else merged.push({ ...interval });
  }
  if (weeklyIntervals(hours, true).some((interval) => !merged.some((outer) => interval.start >= outer.start && interval.end <= outer.end))) {
    throw new ApportionDirectoryError("Staff hours must stay within this address's master working hours.");
  }
}

function rangeClockMinutes(range: string) {
  const parts = range.split(/\s*-\s*/);
  if (parts.length !== 2) return null;
  const start = timeMinutes(parts[0]);
  const end = timeMinutes(parts[1]);
  return { duration: (end - start + 1440) % 1440 || 1440, end, start };
}

function preserveClippedOvernightWindows(dailyHours: AppointmentDailyHours[]) {
  const result = structuredClone(dailyHours);
  for (let weekday = 0; weekday < 7; weekday += 1) {
    const current = result[weekday];
    const previous = result[(weekday + 6) % 7];
    const currentFirst = rangeClockMinutes(current.workingHours);
    if (!currentFirst || currentFirst.start !== 0 || currentFirst.duration === 1440) continue;
    const previousField = previous.workingHoursSecondWindow ? "workingHoursSecondWindow" : "workingHours";
    const previousRange = previous[previousField];
    const previousClock = rangeClockMinutes(previousRange);
    if (!previousClock || previousClock.end !== 0 || previousClock.duration === 1440) continue;
    const currentEnd = current.workingHours.split(/\s*-\s*/)[1];
    previous[previousField] = `${previousRange.split(/\s*-\s*/)[0]} - ${currentEnd}`;
    current.workingHours = current.workingHoursSecondWindow;
    current.workingHoursSecondWindow = "";
  }
  return result;
}

function assertProviderHours(state: TestingWorkspaceState, providerIdentifier: string) {
  const personalKey = identifierKey(state.workspaceBrandingByActor, providerIdentifier);
  const businessKey = identifierKey(directory(state).businesses, providerIdentifier);
  const consultation = businessKey ? directory(state).businesses[businessKey].services.find((service) => service.id === "consultation") : undefined;
  const personal = personalKey ? (state.workspaceBrandingByActor[personalKey].appointmentLocations ?? [])
    .filter((location) => !consultation || consultation.active && consultation.locationIds.includes(location.id)) : [];
  const schedules = [
    ...personal.map((location) => weeklyIntervals(location)),
    ...directory(state).memberships.filter((membership) => matches(membership.providerIdentifier, providerIdentifier) && !matches(membership.ownerIdentifier, providerIdentifier)).map((membership) => weeklyIntervals(membership, true)),
  ];
  if (schedules.some((first, firstIndex) => schedules.some((second, secondIndex) => firstIndex < secondIndex && first.some((interval) => second.some((other) => overlaps(interval, other)))))) {
    throw new ApportionDirectoryError("This person's address working hours overlap another linked or personal address.");
  }
}

function assertSettings(settings: ApportionProviderSettings) {
  const normalized = normalizeApportionProviderSettings(settings);
  if (!settings || typeof settings.justAddToList !== "boolean" || settings.appointmentsPerSlot !== normalized.appointmentsPerSlot || settings.slotDurationMinutes !== normalized.slotDurationMinutes) {
    throw new ApportionDirectoryError("Choose valid provider capacity, queue mode, and slot duration.");
  }
  return normalized;
}

function saveSettings(state: TestingWorkspaceState, provider: string, settings: ApportionProviderSettings, updateBookingMode = false) {
  const values = directory(state);
  const key = identifierKey(values.providerSettings, provider) ?? provider;
  values.providerSettings[key] = assertSettings(settings);
  const brandingKey = identifierKey(state.workspaceBrandingByActor, provider);
  if (brandingKey) {
    state.workspaceBrandingByActor[brandingKey] = { ...state.workspaceBrandingByActor[brandingKey], ...settings };
    if (updateBookingMode) {
      state.workspaceBrandingByActor[brandingKey].showRemainingBookings = !settings.justAddToList;
      state.workspaceBrandingByActor[brandingKey].recurringBookingsEnabled = false;
    }
  }
}

function conflict(): never {
  throw new ApportionDirectoryError("Conflict: this change could strand existing bookings. Address removal or reassignment requires the booking lifecycle integration.");
}

export async function prepareApportionBrandingMutation(state: TestingWorkspaceState, input: WorkspaceBranding | null, actorKey?: string | null, updateProviderSettings = false, verifiedActor?: WorkspaceActor) {
  if (!actorKey?.trim()) throw new ApportionDirectoryError("Signed-in phone access is required.", 403);
  const values = directory(state);
  const key = identifierKey(state.workspaceBrandingByActor, actorKey) ?? actorKey.trim().toLowerCase();
  const existing = state.workspaceBrandingByActor[key];
  const businessKey = identifierKey(values.businesses, key);
  const business = businessKey ? values.businesses[businessKey] : undefined;
  if (!input) {
    if (values.memberships.some((entry) => matches(entry.ownerIdentifier, key) || matches(entry.providerIdentifier, key)) || business?.services.some((service) => service.locationIds.length)) conflict();
    return null;
  }
  if (input.appointmentLocations && (!Array.isArray(input.appointmentLocations) || input.appointmentLocations.length > 2)) throw new ApportionDirectoryError("Configure no more than two business addresses.");
  if (input.promotionalImageDataUrls && (!Array.isArray(input.promotionalImageDataUrls) || input.promotionalImageDataUrls.length > 4 || input.promotionalImageDataUrls.some((image) => typeof image !== "string" || !image.startsWith("data:image/") || image.length > 2_800_000))) throw new ApportionDirectoryError("Upload no more than four valid promotional images up to 2 MB each.");
  const incomingSettings = assertSettings({ appointmentsPerSlot: input.appointmentsPerSlot!, justAddToList: input.justAddToList, slotDurationMinutes: input.slotDurationMinutes! });
  const settings = existing && !updateProviderSettings ? ownSettings(state, key) : incomingSettings;
  const branding = normalizeWorkspaceBranding(input);
  if (!branding?.instituteName.trim() || !branding.appointmentLocations?.length || branding.appointmentLocations.length > 2) throw new ApportionDirectoryError("A business name and one or two addresses are required.");
  Object.assign(branding, settings);
  if (existing && !updateProviderSettings) {
    branding.showRemainingBookings = existing.showRemainingBookings;
    branding.recurringBookingsEnabled = existing.recurringBookingsEnabled;
  }
  const category = await resolveOwnerCategory(state, key, verifiedActor);
  if (!getApportionServiceLimit(category)) throw new ApportionDirectoryError("Pro or Pro Max is required to create or edit a business.", 403);
  const locations = branding.appointmentLocations;
  if (new Set(locations.map((location) => location.id.toLowerCase())).size !== locations.length || locations.some((location) => !location.id.trim() || !location.address.trim() || !location.name.trim())) throw new ApportionDirectoryError("Each address needs a unique ID, name, and address.");
  locations.forEach((location) => weeklyIntervals(location));
  const retainedIds = new Set(locations.map((location) => location.id));
  if (existing?.appointmentLocations?.some((location) => !retainedIds.has(location.id))) conflict();
  assertApportionAddressCapacity({ providerIdentifier: key, ownerIdentifier: key, locationIds: locations.map((location) => location.id), personalLocations: [], memberships: values.memberships });
  for (const membership of values.memberships.filter((entry) => matches(entry.ownerIdentifier, key))) {
    const master = locations.find((location) => location.id === membership.locationId);
    if (!master) conflict();
    const clippedDailyHours = preserveClippedOvernightWindows(clipApportionDailySchedule(membership, master!));
    const previousDailyHours = resolveApportionDailySchedule(membership);
    if (JSON.stringify(previousDailyHours) !== JSON.stringify(clippedDailyHours)) {
      const createdAt = new Date().toISOString();
      values.scheduleNotifications.push({
        id: createEntityId("apportion-schedule-notification"),
        recipientIdentifier: membership.providerIdentifier,
        message: `Your working hours at ${master!.name} were adjusted to stay within the business address schedule.`,
        createdAt,
      });
    }
    const activeDays = clippedDailyHours.filter((entry) => entry.workingHours || entry.workingHoursSecondWindow);
    Object.assign(membership, {
      dailyHours: clippedDailyHours,
      workingDays: activeDays.map((entry) => WEEKDAYS[entry.weekday]).join(", "),
      workingHours: activeDays[0]?.workingHours ?? "",
      workingHoursSecondWindow: activeDays[0]?.workingHoursSecondWindow ?? "",
    });
  }
  if (existing?.appointmentShareCode) branding.appointmentShareCode = existing.appointmentShareCode;
  state.workspaceBrandingByActor[key] = branding;
  assertProviderHours(state, key);
  saveSettings(state, key, settings);
  for (const membership of values.memberships.filter((entry) => matches(entry.ownerIdentifier, key))) assertProviderHours(state, membership.providerIdentifier);
  state.apportionDirectory = migrateApportionDirectory(state.workspaceBrandingByActor, values);
  return { ...branding, ...settings };
}

export async function updateApportionPanel(actor: WorkspaceActor, input: ApportionPanelInput) {
  const identifier = actorIdentifier(actor);
  if (!input || typeof input !== "object" || typeof input.operation !== "string") throw new ApportionDirectoryError("An Apportion operation is required.");
  await reconcileApportionAddressOptOuts();
  if (input.operation !== "set-leaves") await reconcileApportionProviderLeaves();
  await withSerializedTestingMutation(async (state) => {
    const values = directory(state);
    const owner = ("ownerIdentifier" in input ? input.ownerIdentifier?.trim() : "") || identifier;
    const key = identifierKey(values.businesses, owner);
    const business = key ? values.businesses[key] : undefined;
    const isOwner = matches(owner, identifier);
    const isAdmin = Boolean(business?.adminDelegateIdentifier && matches(business.adminDelegateIdentifier, identifier));
    if (input.operation === "set-settings") {
      if (!isOwner) throw new ApportionDirectoryError("Only a provider may edit their global booking settings.", 403);
      saveSettings(state, identifier, input.settings, true);
    } else if (input.operation === "business-branding") {
      if (!isOwner && !isAdmin) throw new ApportionDirectoryError("Business owner or appointed Admin access is required.", 403);
      let branding = input.branding;
      if (isAdmin) {
        if (!branding) throw new ApportionDirectoryError("Only the owner may clear a business.", 403);
        branding = { ...branding, ...ownSettings(state, owner) };
      }
      const prepared = await prepareApportionBrandingMutation(state, branding, key ?? owner, isOwner && input.updateProviderSettings === true, actor);
      mutateWorkspaceBrandingState(state, prepared, key ?? owner);
    } else if (input.operation === "set-leaves") {
      if (!Array.isArray(input.closedDateKeys) || input.closedDateKeys.some((date) => typeof date !== "string"
        || !/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(new Date(`${date}T00:00:00Z`).getTime())
        || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date)) {
        throw new ApportionDirectoryError("Choose valid leave dates.");
      }
      const assigned = Object.values(values.businesses).some((entry) => entry.services.some((service) => service.assignedIdentifier && matches(service.assignedIdentifier, identifier)));
      if (!assigned) throw new ApportionDirectoryError("Only a provider assigned to a service may manage personal leave dates.", 403);
      values.providerClosedDateKeys ??= {};
      const existingKey = identifierKey(values.providerClosedDateKeys, identifier) ?? identifier;
      const previousDates = values.providerClosedDateKeys[existingKey] ?? [];
      const closedDateKeys = Array.from(new Set(input.closedDateKeys)).sort();
      const leaveAt = new Date().toISOString();
      const leaveDateKey = new Date(new Date(leaveAt).getTime() + 330 * 60_000).toISOString().slice(0, 10);
      const addedFutureDates = closedDateKeys.filter((date) => date > leaveDateKey && !previousDates.includes(date));
      values.providerClosedDateKeys[existingKey] = closedDateKeys;
      if (addedFutureDates.length) {
        values.pendingProviderLeaves ??= [];
        values.pendingProviderLeaves.push({ id: createEntityId("apportion-provider-leave"), providerIdentifier: identifier,
          closedDateKeys: addedFutureDates, leaveDateKey, leaveAt });
      }
    } else {
      if (!business) throw new ApportionDirectoryError("Unknown business.");
      if (input.operation === "set-hours" || input.operation === "unlink-address") {
        const membership = values.memberships.find((entry) => matches(entry.ownerIdentifier, owner) && entry.locationId === input.locationId && matches(entry.providerIdentifier, identifier));
        if (!membership) throw new ApportionDirectoryError("Only the assigned provider may manage this address.", 403);
        if (input.operation === "unlink-address") {
          const optedOutAt = new Date().toISOString();
          values.pendingAddressOptOuts ??= [];
          values.pendingAddressOptOuts.push({ id: createEntityId("apportion-opt-out"), ownerIdentifier: business.ownerIdentifier, locationId: input.locationId, providerIdentifier: identifier,
            optedOutAt, optedOutDateKey: new Date(new Date(optedOutAt).getTime() + 330 * 60_000).toISOString().slice(0, 10) });
          values.memberships = values.memberships.filter((entry) => entry !== membership);
          for (const service of business.services) {
            if (!service.assignedIdentifier || !matches(service.assignedIdentifier, identifier)) continue;
            service.locationIds = service.locationIds.filter((locationId) => locationId !== input.locationId);
            if (!service.locationIds.length) service.active = false;
          }
          return;
        }
        const masterKey = identifierKey(state.workspaceBrandingByActor, owner);
        const master = masterKey ? state.workspaceBrandingByActor[masterKey].appointmentLocations?.find((location) => location.id === input.locationId) : undefined;
        if (!master) throw new ApportionDirectoryError("Unknown business address.");
        const hours = input.hours;
        if (!hours || !Array.isArray(hours.closedDateKeys)
          || (hours.dailyHours === undefined && (typeof hours.workingDays !== "string" || typeof hours.workingHours !== "string" || typeof hours.workingHoursSecondWindow !== "string"))) throw new ApportionDirectoryError("Complete staff hours are required.");
        if (hours.closedDateKeys.some((date) => typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date)) throw new ApportionDirectoryError("Choose valid closed dates.");
        assertApportionHoursWithinMaster(hours, master);
        const dailyHours = hours.dailyHours ? resolveApportionDailySchedule({ dailyHours: hours.dailyHours }) : resolveApportionDailySchedule(hours);
        const activeDays = dailyHours.filter((entry) => entry.workingHours || entry.workingHoursSecondWindow);
        Object.assign(membership, {
          ...(hours.dailyHours ? { dailyHours } : {}),
          workingDays: hours.dailyHours ? activeDays.map((entry) => WEEKDAYS[entry.weekday]).join(", ") : hours.workingDays!,
          workingHours: hours.dailyHours ? activeDays[0]?.workingHours ?? "" : hours.workingHours!,
          workingHoursSecondWindow: hours.dailyHours ? activeDays[0]?.workingHoursSecondWindow ?? "" : hours.workingHoursSecondWindow!,
          closedDateKeys: [...new Set(hours.closedDateKeys)],
        });
        assertProviderHours(state, identifier);
      } else if (input.operation === "set-delegate") {
        if (!isOwner) throw new ApportionDirectoryError("Only the owner may appoint or remove an Admin delegate.", 403);
        const delegate = input.delegateIdentifier === null ? null : await resolveRegisteredPhone(state, input.delegateIdentifier);
        if (delegate && matches(delegate, owner)) throw new ApportionDirectoryError("The owner cannot be their own Admin delegate.");
        business.adminDelegateIdentifier = delegate;
      } else if (input.operation === "set-service") {
        if (!isOwner && !isAdmin) throw new ApportionDirectoryError("Business owner or appointed Admin access is required.", 403);
        const category = await resolveOwnerCategory(state, owner, actor);
        if (!getApportionServiceLimit(category)) throw new ApportionDirectoryError("Pro or Pro Max is required to manage services.", 403);
        const incoming = input.service;
        if (!incoming || typeof incoming.id !== "string" || !/^[a-zA-Z0-9_-]{1,80}$/.test(incoming.id) || typeof incoming.name !== "string" || !incoming.name.trim() || typeof incoming.active !== "boolean" || !Array.isArray(incoming.locationIds) || incoming.locationIds.some((location) => typeof location !== "string")) throw new ApportionDirectoryError("A valid service ID, name, status, and addresses are required.");
        const previous = business.services.find((service) => service.id === incoming.id);
        if (incoming.id !== "consultation" && incoming.assignedIdentifier && matches(incoming.assignedIdentifier, owner)) throw new ApportionDirectoryError("The owner is assigned to Consultation only.");
        if (incoming.id === "consultation" && (!incoming.assignedIdentifier || !matches(incoming.assignedIdentifier, owner))) throw new ApportionDirectoryError("The default Consultation ID and owner assignment cannot change.");
        const assignedIdentifier = incoming.id === "consultation" ? business.ownerIdentifier : incoming.assignedIdentifier === null ? null : await resolveRegisteredPhone(state, incoming.assignedIdentifier);
        const service: ApportionService = { id: incoming.id, name: incoming.name.trim(), active: incoming.active, assignedIdentifier, locationIds: [...new Set(incoming.locationIds)] };
        const brandingKey = identifierKey(state.workspaceBrandingByActor, owner);
        const locations = brandingKey ? state.workspaceBrandingByActor[brandingKey].appointmentLocations ?? [] : [];
        if ((service.active && !service.locationIds.length) || service.locationIds.some((locationId) => !locations.some((location) => location.id === locationId))) throw new ApportionDirectoryError("Active services need at least one valid assigned business address.");
        if (previous && ((previous.assignedIdentifier === null) !== (service.assignedIdentifier === null)
          || (previous.assignedIdentifier && service.assignedIdentifier && !matches(previous.assignedIdentifier, service.assignedIdentifier))
          || incoming.id !== "consultation" && previous.locationIds.some((locationId) => !service.locationIds.includes(locationId)))) conflict();
        assertApportionServiceAssignment(business, service, category);
        if (assignedIdentifier && !matches(assignedIdentifier, owner)) {
          const personalKey = identifierKey(state.workspaceBrandingByActor, assignedIdentifier);
          assertApportionAddressCapacity({ providerIdentifier: assignedIdentifier, ownerIdentifier: business.ownerIdentifier, locationIds: service.locationIds, personalLocations: personalKey ? state.workspaceBrandingByActor[personalKey].appointmentLocations ?? [] : [], memberships: values.memberships });
          for (const locationId of service.locationIds) {
            if (values.memberships.some((entry) => matches(entry.ownerIdentifier, owner) && entry.locationId === locationId && matches(entry.providerIdentifier, assignedIdentifier))) continue;
            const location = locations.find((entry) => entry.id === locationId)!;
            values.memberships.push({ ownerIdentifier: business.ownerIdentifier, locationId, providerIdentifier: assignedIdentifier, workingDays: location.workingDays, workingHours: location.workingHours, workingHoursSecondWindow: location.workingHoursSecondWindow, ...(location.dailyHours ? { dailyHours: structuredClone(location.dailyHours) } : {}), closedDateKeys: [] });
          }
          assertProviderHours(state, assignedIdentifier);
          const settingsKey = identifierKey(values.providerSettings, assignedIdentifier);
          if (!settingsKey) values.providerSettings[assignedIdentifier] = ownSettings(state, assignedIdentifier);
        }
        if (previous) business.services[business.services.indexOf(previous)] = service;
        else business.services.push(service);
        if (assignedIdentifier) assertProviderHours(state, assignedIdentifier);
      } else {
        throw new ApportionDirectoryError("Unknown Apportion operation.");
      }
    }
  });
  if (input.operation === "set-leaves") await reconcileApportionProviderLeaves();
  return getApportionPanel(actor);
}