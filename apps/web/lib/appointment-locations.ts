import { resolveApportionDailySchedule, type AppointmentLocation, type WorkspaceBranding } from "@trapit/testing";

const MINUTES_PER_DAY = 24 * 60;
const MINUTES_PER_WEEK = 7 * MINUTES_PER_DAY;
const IST_OFFSET_MINUTES = (5 * 60) + 30;
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const SLOT_DURATION_MINUTES = new Set([5, 10, 15, 30, 45, 60, 120, 180, 240, 1440]);

type WeeklyInterval = {
  end: number;
  start: number;
};

function parseTime(value: string) {
  if (value.trim() === "24:00") return MINUTES_PER_DAY;
  const match = value.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?$/i);

  if (!match) {
    return null;
  }

  let hours = Number.parseInt(match[1], 10);
  const minutes = Number.parseInt(match[2] ?? "0", 10);
  const suffix = match[3]?.toUpperCase();

  if (minutes > 59 || (suffix && (hours < 1 || hours > 12)) || (!suffix && (hours < 0 || hours > 23))) {
    return null;
  }

  if (suffix === "PM" && hours < 12) hours += 12;
  if (suffix === "AM" && hours === 12) hours = 0;
  return (hours * 60) + minutes;
}

function parseRange(value: string) {
  const [startValue, endValue, extraValue] = value.split(/\s*-\s*/);
  const start = parseTime(startValue ?? "");
  const end = parseTime(endValue ?? "");

  if (extraValue !== undefined || start === null || start === MINUTES_PER_DAY || end === null) {
    return null;
  }

  return { duration: start === end || end - start === MINUTES_PER_DAY ? MINUTES_PER_DAY : (end - start + MINUTES_PER_DAY) % MINUTES_PER_DAY, start };
}

function selectedWeekdays(value: string) {
  const normalized = value.toLowerCase();
  return WEEKDAYS.flatMap((day, index) => normalized.includes(day.toLowerCase()) || normalized.includes(day.slice(0, 3).toLowerCase()) ? [index] : []);
}

function weekdayForDateKey(serviceDateKey: string) {
  const match = serviceDateKey.match(/^(\d{4})-(\d{2})-(\d{2})$/);

  if (!match) {
    return null;
  }

  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return Number.isNaN(date.getTime()) ? null : date.getUTCDay();
}

export function resolveAppointmentLocationSchedule(
  branding: WorkspaceBranding,
  locationId: string,
  serviceDateKey: string,
) {
  const location = branding.appointmentLocations?.find((entry) => entry.id === locationId);
  const weekday = weekdayForDateKey(serviceDateKey);

  if (!location || weekday === null || branding.appointmentDateOverrides?.closedDateKeys.includes(serviceDateKey)) {
    return null;
  }

  const dateOverride = branding.appointmentDateHoursOverrides?.find((entry) => entry.dateKey === serviceDateKey);
  if (dateOverride) {
    const hours = dateOverride.locations.find((entry) => entry.locationId === locationId);
    return hours ? { ...location, ...hours, dailyHours: undefined, workingDays: WEEKDAYS[weekday] } : null;
  }

  const weeklyOverride = branding.appointmentWeeklyHoursOverrides?.find((entry) => entry.weekday === weekday);
  if (weeklyOverride) {
    const hours = weeklyOverride.locations.find((entry) => entry.locationId === locationId);
    return hours ? { ...location, ...hours, dailyHours: undefined, workingDays: WEEKDAYS[weekday] } : null;
  }

  if (location.dailyHours) {
    const hours = resolveApportionDailySchedule({ dailyHours: location.dailyHours })[weekday];
    return hours.workingHours || hours.workingHoursSecondWindow
      ? { ...location, ...hours, dailyHours: undefined, workingDays: WEEKDAYS[weekday] }
      : null;
  }

  const isLegacyOpenedDate = branding.appointmentDateOverrides?.openedDateKeys.includes(serviceDateKey) ?? false;
  return isLegacyOpenedDate || selectedWeekdays(location.workingDays).includes(weekday) ? location : null;
}

function splitAcrossWeek(start: number, end: number): WeeklyInterval[] {
  if (end <= MINUTES_PER_WEEK) {
    return [{ end, start }];
  }

  return [
    { end: MINUTES_PER_WEEK, start },
    { end: end - MINUTES_PER_WEEK, start: 0 },
  ];
}

function buildIntervals(location: AppointmentLocation) {
  if (location.dailyHours) {
    if (location.dailyHours.length !== 7
      || location.dailyHours.some((entry) => !entry || !Number.isInteger(entry.weekday) || entry.weekday < 0 || entry.weekday > 6
        || typeof entry.workingHours !== "string" || typeof entry.workingHoursSecondWindow !== "string")
      || new Set(location.dailyHours.map((entry) => entry.weekday)).size !== 7) {
      throw new Error(`${location.name} needs valid daily working hours for all seven days.`);
    }
    const intervals = resolveApportionDailySchedule({ dailyHours: location.dailyHours }).flatMap((entry) => {
      const ranges = [entry.workingHours, entry.workingHoursSecondWindow].filter((value) => value.trim()).map((value) => parseRange(value));
      if (ranges.some((range) => !range)) throw new Error(`${location.name} has an invalid working-hours range.`);
      return ranges.flatMap((range) => splitAcrossWeek(
        entry.weekday * MINUTES_PER_DAY + range!.start,
        entry.weekday * MINUTES_PER_DAY + range!.start + range!.duration,
      ));
    });
    if (!intervals.length) throw new Error(`${location.name} needs at least one working hour.`);
    if (intervals.some((first, firstIndex) => intervals.some((second, secondIndex) =>
      firstIndex < secondIndex && first.start < second.end && second.start < first.end,
    ))) throw new Error(`${location.name} working-hour windows cannot overlap.`);
    return intervals;
  }
  const days = selectedWeekdays(location.workingDays);

  if (!days.length) {
    throw new Error(`${location.name} needs at least one working day.`);
  }

  const rangeValues = [location.workingHours, location.workingHoursSecondWindow].filter((value) => value.trim());
  const ranges = rangeValues.map((value) => parseRange(value));

  if (!rangeValues.length || ranges.some((range) => !range)) {
    throw new Error(`${location.name} has an invalid working-hours range.`);
  }

  const intervals = days.flatMap((day) => ranges.flatMap((range) => {
    const start = (day * MINUTES_PER_DAY) + range!.start;
    return splitAcrossWeek(start, start + range!.duration);
  }));

  const overlaps = intervals.some((first, firstIndex) => intervals.some((second, secondIndex) => (
    firstIndex < secondIndex && first.start < second.end && second.start < first.end
  )));

  if (overlaps) {
    throw new Error(`${location.name} working-hour windows cannot overlap.`);
  }

  return intervals;
}

function createSlotIso(serviceDateKey: string, absoluteMinutes: number) {
  const [year, month, day] = serviceDateKey.split("-").map((part) => Number.parseInt(part, 10));

  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return null;
  }

  return new Date(Date.UTC(
    year,
    month - 1,
    day + Math.floor(absoluteMinutes / MINUTES_PER_DAY),
    Math.floor((absoluteMinutes % MINUTES_PER_DAY) / 60),
    absoluteMinutes % 60,
  ) - (IST_OFFSET_MINUTES * 60 * 1000)).toISOString();
}

export function getApportionLifecycleBoundaries(input: {
  location: AppointmentLocation | null;
  serviceDateKey: string;
  slotDurationMinutes: number;
  startsAt: string;
}) {
  const slotEndsAt = new Date(new Date(input.startsAt).getTime() + input.slotDurationMinutes * 60_000).toISOString();
  const windows = [input.location?.workingHours, input.location?.workingHoursSecondWindow]
    .filter((value): value is string => Boolean(value))
    .map(parseRange)
    .filter((range): range is NonNullable<ReturnType<typeof parseRange>> => Boolean(range));
  const windowEnds = windows.map((range) => new Date(createSlotIso(input.serviceDateKey, range.start + range.duration)!).getTime());
  const serviceDayStart = new Date(`${input.serviceDateKey}T00:00:00+05:30`).getTime();
  const end = Math.max(serviceDayStart, new Date(slotEndsAt).getTime(), ...windowEnds);
  const nextMidnight = (Math.floor((end + IST_OFFSET_MINUTES * 60_000) / 86_400_000) + 1) * 86_400_000 - IST_OFFSET_MINUTES * 60_000;
  return { slotEndsAt, queueExpiresAt: new Date(nextMidnight).toISOString() };
}

export function validateAppointmentLocationSlot(input: {
  location: AppointmentLocation;
  serviceDateKey: string;
  slotDurationMinutes: number;
  startsAt: string;
}) {
  const requestedDate = new Date(`${input.serviceDateKey}T00:00:00.000Z`);
  const requestedStart = new Date(input.startsAt);

  if (Number.isNaN(requestedDate.getTime()) || Number.isNaN(requestedStart.getTime())) {
    throw new Error("Choose a valid appointment date and time.");
  }

  const workingDays = selectedWeekdays(input.location.workingDays);
  if (!workingDays.includes(requestedDate.getUTCDay())) {
    throw new Error("Choose a working day for this location.");
  }

  const ranges = [input.location.workingHours, input.location.workingHoursSecondWindow]
    .filter((value) => value.trim())
    .map((value) => parseRange(value));

  if (!ranges.length || ranges.some((range) => !range)) {
    throw new Error("This location has invalid working hours.");
  }

  const slotDurationMinutes = Math.max(1, input.slotDurationMinutes);
  const allowedStarts = new Set(ranges.flatMap((range) => {
    const totalSlots = Math.max(0, Math.floor((range!.duration - slotDurationMinutes) / slotDurationMinutes) + 1);
    return Array.from({ length: totalSlots }, (_, index) => createSlotIso(
      input.serviceDateKey,
      range!.start + (index * slotDurationMinutes),
    )).filter((value): value is string => Boolean(value));
  }));

  if (!allowedStarts.has(requestedStart.toISOString())) {
    throw new Error("Choose one of the available appointment slots for this location.");
  }
}

export function validateAppointmentLocations(locations: AppointmentLocation[] | undefined) {
  if (!locations?.length || locations.length > 2) {
    throw new Error("Configure one or two business locations.");
  }

  const normalizedIds = locations.map((location) => location.id.trim().toLowerCase());
  if (normalizedIds.some((id) => !id) || new Set(normalizedIds).size !== normalizedIds.length) {
    throw new Error("Each business location needs a unique ID.");
  }

  locations.forEach((location, index) => {
    if (!location.name.trim() || !location.address.trim() || !location.workingDays.trim() || !location.workingHours.trim()) {
      throw new Error(index === 0
        ? "Complete the primary address, working days, and working hours."
        : "Complete the additional address, working days, and working hours.");
    }
  });

  locations.forEach(buildIntervals);
}

export function validateAppointmentHoursOverrides(branding: WorkspaceBranding) {
  const locationIds = new Set((branding.appointmentLocations ?? []).map((location) => location.id));
  const overrideGroups = [
    ...(branding.appointmentWeeklyHoursOverrides ?? []).map((entry) => ({ key: `weekday-${entry.weekday}`, locations: entry.locations })),
    ...(branding.appointmentDateHoursOverrides ?? []).map((entry) => ({ key: entry.dateKey, locations: entry.locations })),
  ];

  for (const group of overrideGroups) {
    if (!group.locations.length) {
      throw new Error("Choose at least one location for custom leave-day hours.");
    }

    const seenLocationIds = new Set<string>();
    const locationIntervals = group.locations.map((hours) => {
      if (!locationIds.has(hours.locationId) || seenLocationIds.has(hours.locationId)) {
        throw new Error("Leave-day hours must reference each configured location only once.");
      }
      seenLocationIds.add(hours.locationId);

      const ranges = [hours.workingHours, hours.workingHoursSecondWindow]
        .filter((value) => value.trim())
        .map((value) => parseRange(value));

      if (!hours.workingHours.trim() || ranges.some((range) => !range)) {
        throw new Error("Complete each selected location's leave-day hours.");
      }

      const intervals = ranges.map((range) => ({
        end: range!.start + range!.duration,
        start: range!.start,
      }));
      if (intervals.some((first, firstIndex) => intervals.some((second, secondIndex) =>
        firstIndex < secondIndex && first.start < second.end && second.start < first.end,
      ))) {
        throw new Error("Leave-day hour windows for one location cannot overlap.");
      }

      return intervals;
    });

  }
}

export function validateAppointmentBusinessProfile(branding: WorkspaceBranding) {
  if (!branding.instituteName.trim()) {
    throw new Error("Enter a business name.");
  }

  validateAppointmentLocations(branding.appointmentLocations);
  validateAppointmentHoursOverrides(branding);

  if (!branding.slotDurationMinutes || !SLOT_DURATION_MINUTES.has(branding.slotDurationMinutes)) {
    throw new Error("Choose a slot duration.");
  }
}

export function isAppointmentBusinessProfileComplete(branding: WorkspaceBranding) {
  try {
    validateAppointmentBusinessProfile(branding);
    return true;
  } catch {
    return false;
  }
}