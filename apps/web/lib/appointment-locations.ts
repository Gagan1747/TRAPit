import { type AppointmentLocation } from "@trapit/testing";

const MINUTES_PER_DAY = 24 * 60;
const MINUTES_PER_WEEK = 7 * MINUTES_PER_DAY;
const IST_OFFSET_MINUTES = (5 * 60) + 30;
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

type WeeklyInterval = {
  end: number;
  start: number;
};

function parseTime(value: string) {
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

  if (extraValue !== undefined || start === null || end === null) {
    return null;
  }

  return { duration: start === end ? MINUTES_PER_DAY : (end - start + MINUTES_PER_DAY) % MINUTES_PER_DAY, start };
}

function selectedWeekdays(value: string) {
  const normalized = value.toLowerCase();
  return WEEKDAYS.flatMap((day, index) => normalized.includes(day.toLowerCase()) || normalized.includes(day.slice(0, 3).toLowerCase()) ? [index] : []);
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

  if (locations.length < 2) {
    buildIntervals(locations[0]);
    return;
  }

  const firstIntervals = buildIntervals(locations[0]);
  const secondIntervals = buildIntervals(locations[1]);
  const overlaps = firstIntervals.some((first) => secondIntervals.some((second) => first.start < second.end && second.start < first.end));

  if (overlaps) {
    throw new Error(`${locations[0].name} and ${locations[1].name} working hours cannot overlap.`);
  }
}