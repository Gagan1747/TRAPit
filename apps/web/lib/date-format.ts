const shortDateFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

const shortDateTimeFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  month: "short",
  year: "numeric",
});

const shortDateTimeIstFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  month: "short",
  timeZone: "Asia/Kolkata",
  year: "numeric",
});

export function formatShortDate(value: string) {
  return shortDateFormatter.format(new Date(value));
}

export function formatShortDateTime(value: string) {
  return shortDateTimeFormatter.format(new Date(value));
}

export function formatShortDateTimeIst(value: string) {
  return `${shortDateTimeIstFormatter.format(new Date(value))} IST`;
}

const groupTimestampPartsFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  hour: "2-digit",
  hour12: false,
  minute: "2-digit",
  month: "2-digit",
  timeZone: "Asia/Kolkata",
  year: "numeric",
});

export function formatGroupTimestamp(value: string | null | undefined) {
  if (!value) {
    return "—";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "—";
  }

  const parts = Object.fromEntries(
    groupTimestampPartsFormatter.formatToParts(date).map((part) => [part.type, part.value]),
  );

  return `${parts.day ?? "01"}/${parts.month ?? "01"}/${parts.year ?? "2026"}; ${parts.hour ?? "00"}:${parts.minute ?? "00"}`;
}