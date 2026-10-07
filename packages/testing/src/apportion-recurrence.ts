export type ApportionRecurrence = {
  mode: "weekly" | "monthly";
  endDateKey?: string;
  durationCount?: number;
  weekdayKeys?: string[];
  monthDays?: number[];
};

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function validDate(value: string) {
  const date = new Date(`${value}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new Error("Choose valid recurrence dates.");
  }
  return date;
}

export function planApportionDateKeys(startDateKey: string, recurrence: ApportionRecurrence | null, isWorkingDate: (dateKey: string) => boolean, absoluteHorizonDateKey?: string) {
  const start = validDate(startDateKey);
  const duration = recurrence?.durationCount;
  const isDuration = duration !== undefined;
  if (isDuration && (!Number.isInteger(duration) || duration! < 1 || duration! > 6)) throw new Error("Choose a duration from 1 to 6 weeks or months.");
  const end = recurrence && !isDuration ? validDate(recurrence.endDateKey ?? "") : new Date(start);
  if (recurrence && isDuration) {
    if (recurrence.mode === "weekly") end.setUTCDate(end.getUTCDate() + duration! * 7);
    else {
      end.setUTCDate(1);
      end.setUTCMonth(end.getUTCMonth() + duration!);
      end.setUTCDate(Math.min(start.getUTCDate(), new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() + 1, 0)).getUTCDate()));
    }
  }
  const horizon = new Date(start);
  horizon.setUTCMonth(horizon.getUTCMonth() + 6);
  if (end < start || end > horizon) throw new Error("Choose a recurrence end within six months of the first date.");
  if (absoluteHorizonDateKey && (start > validDate(absoluteHorizonDateKey) || end > validDate(absoluteHorizonDateKey))) throw new Error("The selected duration crosses the six-month booking horizon.");
  if (recurrence && recurrence.mode !== "weekly" && recurrence.mode !== "monthly") throw new Error("Choose weekly or monthly recurrence.");
  const weekdays = recurrence?.weekdayKeys ?? [];
  const monthDays = recurrence?.monthDays ?? [];
  if (recurrence?.mode === "weekly" && (!weekdays.length || weekdays.some((day) => !WEEKDAYS.includes(day)))) throw new Error("Choose valid recurring weekdays.");
  if (recurrence?.mode === "monthly" && (!monthDays.length || monthDays.some((day) => !Number.isInteger(day) || day < 1 || day > 31))) throw new Error("Choose valid monthly dates.");
  const result: string[] = [];
  for (const cursor = new Date(start); (isDuration ? cursor < end : cursor <= end) && (isDuration || result.length < 6); cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    const dateKey = cursor.toISOString().slice(0, 10);
    const lastDay = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 0)).getUTCDate();
    const matches = !recurrence || (recurrence.mode === "weekly"
      ? weekdays.includes(WEEKDAYS[cursor.getUTCDay()])
      : monthDays.some((day) => Math.min(day, lastDay) === cursor.getUTCDate()));
    if (matches && isWorkingDate(dateKey)) result.push(dateKey);
  }
  if (!result.length) throw new Error("No working dates match this appointment selection.");
  return result;
}