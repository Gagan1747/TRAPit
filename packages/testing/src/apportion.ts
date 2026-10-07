import { participantIdentifiersMatch, type AppointmentDailyHours, type AppointmentLocation, type WorkspaceBranding } from "./quiz";

export type ApportionDailyHours = AppointmentDailyHours;

export type ApportionWeeklyInterval = {
  endMinute: number;
  startMinute: number;
};

export type ApportionScheduleNotification = {
  id: string;
  recipientIdentifier: string;
  message: string;
  createdAt: string;
  deliveredAt?: string;
};

export type ApportionProviderSettings = {
  appointmentsPerSlot: number;
  justAddToList: boolean;
  slotDurationMinutes: number;
};

export type ApportionService = {
  id: string;
  name: string;
  active: boolean;
  assignedIdentifier: string | null;
  locationIds: string[];
};

export type ApportionBusiness = {
  ownerIdentifier: string;
  adminDelegateIdentifier: string | null;
  services: ApportionService[];
};

export type ApportionAddressMembership = {
  ownerIdentifier: string;
  locationId: string;
  providerIdentifier: string;
  dailyHours?: ApportionDailyHours[];
  workingDays: string;
  workingHours: string;
  workingHoursSecondWindow: string;
  closedDateKeys: string[];
};

export type ApportionDirectory = {
  businesses: Record<string, ApportionBusiness>;
  providerSettings: Record<string, ApportionProviderSettings>;
  memberships: ApportionAddressMembership[];
  providerClosedDateKeys?: Record<string, string[]>;
  scheduleNotifications: ApportionScheduleNotification[];
  pendingProviderLeaves?: Array<{
    id: string;
    providerIdentifier: string;
    closedDateKeys: string[];
    leaveDateKey: string;
    leaveAt: string;
  }>;
  pendingAddressOptOuts?: Array<{
    id?: string;
    ownerIdentifier: string;
    locationId: string;
    providerIdentifier: string;
    optedOutDateKey?: string;
    optedOutAt?: string;
  }>;
};

export function getApportionServiceLimit(category: string) {
  return category === "trapit-pro-max" ? 10
    : category === "trapit-pro" || category === "trapit-pro-limited" ? 4 : 0;
}

export function getApportionBookableServices(business: ApportionBusiness, category: string, locationId?: string) {
  const counts = new Map<string, number>();
  const limit = getApportionServiceLimit(category);
  return business.services.filter((service) => service.active).flatMap((service) => {
    const locationIds = service.locationIds.filter((id) => {
      const count = counts.get(id) ?? 0;
      counts.set(id, count + 1);
      return count < limit && (!locationId || id === locationId);
    });
    return locationIds.length ? [{ ...service, locationIds }] : [];
  });
}

export const APPORTION_NEW_DURATION_MINUTES = [5, 10, 15, 60, 240, 1440] as const;

export function resolveApportionController(business: ApportionBusiness, service: ApportionService) {
  return service.assignedIdentifier || business.adminDelegateIdentifier || business.ownerIdentifier;
}

export function normalizeApportionProviderSettings(
  input?: Partial<ApportionProviderSettings> | null,
): ApportionProviderSettings {
  return {
    appointmentsPerSlot: Number.isInteger(input?.appointmentsPerSlot)
      && (input?.appointmentsPerSlot ?? 0) >= 1 && (input?.appointmentsPerSlot ?? 0) <= 6
      ? input!.appointmentsPerSlot! : 1,
    justAddToList: input?.justAddToList ?? true,
    slotDurationMinutes: [5, 10, 15, 30, 45, 60, 120, 180, 240, 1440].includes(input?.slotDurationMinutes ?? 0)
      ? input!.slotDurationMinutes! : 10,
  };
}

export function migrateApportionDirectory(
  brandingByActor: Record<string, WorkspaceBranding>,
  existing?: Partial<ApportionDirectory> | null,
): ApportionDirectory {
  const businesses = structuredClone(existing?.businesses ?? {});
  const providerSettings = structuredClone(existing?.providerSettings ?? {});
  for (const [ownerIdentifier, branding] of Object.entries(brandingByActor)) {
    if (!branding.instituteName?.trim() || !branding.appointmentLocations?.length) continue;
    businesses[ownerIdentifier] ??= {
      ownerIdentifier,
      adminDelegateIdentifier: null,
      services: [{
        id: "consultation",
        name: "Consultation",
        active: true,
        assignedIdentifier: ownerIdentifier,
        locationIds: branding.appointmentLocations.map((location) => location.id),
      }],
    };
    providerSettings[ownerIdentifier] ??= normalizeApportionProviderSettings({
      appointmentsPerSlot: branding.appointmentsPerSlot ?? undefined,
      justAddToList: branding.justAddToList,
      slotDurationMinutes: branding.slotDurationMinutes ?? undefined,
    });
  }
  return { businesses, providerSettings, memberships: structuredClone(existing?.memberships ?? []),
    ...(existing?.providerClosedDateKeys ? { providerClosedDateKeys: structuredClone(existing.providerClosedDateKeys) } : {}),
    scheduleNotifications: structuredClone(existing?.scheduleNotifications ?? []),
    ...(existing?.pendingProviderLeaves ? { pendingProviderLeaves: structuredClone(existing.pendingProviderLeaves) } : {}),
    ...(existing?.pendingAddressOptOuts ? { pendingAddressOptOuts: structuredClone(existing.pendingAddressOptOuts) } : {}) };
}

const MINUTES_PER_DAY = 1440;
const MINUTES_PER_WEEK = MINUTES_PER_DAY * 7;
const WEEKDAY_ALIASES: Record<string, number> = {
  sun: 0, sunday: 0, mon: 1, monday: 1, tue: 2, tues: 2, tuesday: 2,
  wed: 3, wednesday: 3, thu: 4, thur: 4, thurs: 4, thursday: 4,
  fri: 5, friday: 5, sat: 6, saturday: 6,
};

export type ApportionScheduleInput = {
  dailyHours?: ApportionDailyHours[];
  workingDays?: string;
  workingHours?: string;
  workingHoursSecondWindow?: string;
};

function parseClockTime(value: string) {
  const match = value.trim().match(/^(\d{1,2}):(\d{2})(?:\s*([AP]M))?$/i);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (minute > 59) return null;
  if (match[3]) {
    if (hour < 1 || hour > 12) return null;
    return (hour % 12 + (match[3].toUpperCase() === "PM" ? 12 : 0)) * 60 + minute;
  }
  if (hour > 24 || (hour === 24 && minute !== 0)) return null;
  return hour * 60 + minute;
}

function parseTimeWindow(value: string) {
  const parts = value.split(/\s*-\s*/);
  if (parts.length !== 2) return null;
  const start = parseClockTime(parts[0]);
  const end = parseClockTime(parts[1]);
  if (start === null || end === null || start >= MINUTES_PER_DAY) return null;
  return { start, end: end <= start ? end + MINUTES_PER_DAY : end };
}

function mergeIntervals(intervals: ApportionWeeklyInterval[]) {
  const sorted = intervals
    .filter((interval) => interval.endMinute > interval.startMinute)
    .sort((left, right) => left.startMinute - right.startMinute || left.endMinute - right.endMinute);
  const merged: ApportionWeeklyInterval[] = [];
  for (const interval of sorted) {
    const previous = merged[merged.length - 1];
    if (previous && interval.startMinute <= previous.endMinute) {
      previous.endMinute = Math.max(previous.endMinute, interval.endMinute);
    } else {
      merged.push({ ...interval });
    }
  }
  return merged;
}

function addWeeklyInterval(intervals: ApportionWeeklyInterval[], weekday: number, window: string) {
  const parsed = parseTimeWindow(window);
  if (!parsed) return;
  const startMinute = weekday * MINUTES_PER_DAY + parsed.start;
  const endMinute = startMinute + parsed.end - parsed.start;
  if (endMinute <= MINUTES_PER_WEEK) {
    intervals.push({ startMinute, endMinute });
  } else {
    intervals.push({ startMinute, endMinute: MINUTES_PER_WEEK });
    intervals.push({ startMinute: 0, endMinute: endMinute - MINUTES_PER_WEEK });
  }
}

export function resolveApportionDailySchedule(schedule: ApportionScheduleInput): ApportionDailyHours[] {
  const dailyHours = new Map<number, ApportionDailyHours>();
  if (schedule.dailyHours) {
    for (const entry of schedule.dailyHours) {
      if (Number.isInteger(entry.weekday) && entry.weekday >= 0 && entry.weekday <= 6 && !dailyHours.has(entry.weekday)) {
        dailyHours.set(entry.weekday, {
          weekday: entry.weekday,
          workingHours: entry.workingHours?.trim() ?? "",
          workingHoursSecondWindow: entry.workingHoursSecondWindow?.trim() ?? "",
        });
      }
    }
  } else {
    const workingWeekdays = new Set((schedule.workingDays ?? "")
      .split(/[,;|]/)
      .map((day) => WEEKDAY_ALIASES[day.trim().toLowerCase()])
      .filter((weekday): weekday is number => weekday !== undefined));
    for (const weekday of workingWeekdays) {
      dailyHours.set(weekday, {
        weekday,
        workingHours: schedule.workingHours?.trim() ?? "",
        workingHoursSecondWindow: schedule.workingHoursSecondWindow?.trim() ?? "",
      });
    }
  }
  return Array.from({ length: 7 }, (_, weekday) => dailyHours.get(weekday) ?? {
    weekday,
    workingHours: "",
    workingHoursSecondWindow: "",
  });
}

export function getApportionWeeklyIntervals(schedule: ApportionScheduleInput): ApportionWeeklyInterval[] {
  const intervals: ApportionWeeklyInterval[] = [];
  for (const dailyHours of resolveApportionDailySchedule(schedule)) {
    addWeeklyInterval(intervals, dailyHours.weekday, dailyHours.workingHours);
    addWeeklyInterval(intervals, dailyHours.weekday, dailyHours.workingHoursSecondWindow);
  }
  return mergeIntervals(intervals);
}

export function intersectApportionWeeklyIntervals(
  providerIntervals: ApportionWeeklyInterval[],
  masterIntervals: ApportionWeeklyInterval[],
): ApportionWeeklyInterval[] {
  const intersections: ApportionWeeklyInterval[] = [];
  for (const provider of providerIntervals) {
    for (const master of masterIntervals) {
      const startMinute = Math.max(provider.startMinute, master.startMinute);
      const endMinute = Math.min(provider.endMinute, master.endMinute);
      if (endMinute > startMinute) intersections.push({ startMinute, endMinute });
    }
  }
  return mergeIntervals(intersections);
}

function formatClockTime(minuteOfDay: number) {
  const normalizedMinute = minuteOfDay === MINUTES_PER_DAY ? 0 : minuteOfDay;
  const hour = Math.floor(normalizedMinute / 60);
  const minute = normalizedMinute % 60;
  const suffix = hour < 12 ? "AM" : "PM";
  const displayHour = hour % 12 || 12;
  return `${displayHour}:${String(minute).padStart(2, "0")} ${suffix}`;
}

export function clipApportionDailySchedule(
  providerSchedule: ApportionScheduleInput,
  masterSchedule: ApportionScheduleInput,
): ApportionDailyHours[] {
  const intervals = intersectApportionWeeklyIntervals(
    getApportionWeeklyIntervals(providerSchedule),
    getApportionWeeklyIntervals(masterSchedule),
  );
  const windowsByWeekday = Array.from({ length: 7 }, () => [] as Array<{ start: number; end: number }>);
  for (const interval of intervals) {
    const firstWeekday = Math.floor(interval.startMinute / MINUTES_PER_DAY);
    const endWeekday = Math.floor((interval.endMinute - 1) / MINUTES_PER_DAY);
    for (let weekday = firstWeekday; weekday <= endWeekday; weekday += 1) {
      const dayStart = weekday * MINUTES_PER_DAY;
      windowsByWeekday[weekday].push({
        start: interval.startMinute <= dayStart ? 0 : interval.startMinute - dayStart,
        end: interval.endMinute >= dayStart + MINUTES_PER_DAY ? MINUTES_PER_DAY : interval.endMinute - dayStart,
      });
    }
  }
  return windowsByWeekday.map((windows, weekday) => {
    const dailyWindows = mergeIntervals(windows.map((window) => ({ startMinute: window.start, endMinute: window.end })))
      .slice(0, 2);
    return {
      weekday,
      workingHours: dailyWindows[0]
        ? `${formatClockTime(dailyWindows[0].startMinute)} - ${formatClockTime(dailyWindows[0].endMinute)}`
        : "",
      workingHoursSecondWindow: dailyWindows[1]
        ? `${formatClockTime(dailyWindows[1].startMinute)} - ${formatClockTime(dailyWindows[1].endMinute)}`
        : "",
    };
  });
}

export function autofillApportionDailyHours(
  dailyHours: ApportionDailyHours[],
  sourceWeekday?: number,
  activeWeekdays: number[] = [],
  customizedWeekdays: number[] = [],
): ApportionDailyHours[] {
  const resolved = resolveApportionDailySchedule({ dailyHours });
  const requestedSource = resolved.find((entry) => entry.weekday === sourceWeekday && activeWeekdays.includes(entry.weekday));
  const source = requestedSource ?? resolved.find((entry) => activeWeekdays.includes(entry.weekday)
    && (entry.workingHours || entry.workingHoursSecondWindow));
  if (!source) return resolved;
  const customized = new Set(customizedWeekdays);
  return resolved.map((entry) => {
    if (entry.weekday === source.weekday || !activeWeekdays.includes(entry.weekday) || customized.has(entry.weekday)) return entry;
    return { ...source, weekday: entry.weekday };
  });
}

export function assertApportionServiceAssignment(
  business: ApportionBusiness,
  service: ApportionService,
  category: string,
) {
  if (!service.id.trim() || !service.name.trim()) throw new Error("A service ID and name are required.");
  const otherServices = business.services.filter((entry) => entry.id !== service.id);
  const previous = business.services.find((entry) => entry.id === service.id);
  if (service.active && service.locationIds.some((locationId) =>
    (!previous?.active || !previous.locationIds.includes(locationId))
    && otherServices.filter((entry) => entry.active && entry.locationIds.includes(locationId)).length >= getApportionServiceLimit(category))) {
    throw new Error("Upgrade to add more services.");
  }
  if (service.assignedIdentifier && otherServices.some((entry) => entry.assignedIdentifier
    && participantIdentifiersMatch(entry.assignedIdentifier, service.assignedIdentifier!))) {
    throw new Error("A person can be assigned to only one service per business.");
  }
}

export function assertApportionAddressCapacity(input: {
  providerIdentifier: string;
  ownerIdentifier: string;
  locationIds: string[];
  personalLocations: AppointmentLocation[];
  memberships: ApportionAddressMembership[];
}) {
  const links = new Set(input.memberships
    .filter((membership) => participantIdentifiersMatch(membership.providerIdentifier, input.providerIdentifier))
    .map((membership) => `${membership.ownerIdentifier}::${membership.locationId}`));
  for (const location of input.personalLocations) links.add(`${input.providerIdentifier}::${location.id}`);
  for (const locationId of input.locationIds) links.add(`${input.ownerIdentifier}::${locationId}`);
  if (links.size > 2) throw new Error("Staff address unavailable");
}