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

export function formatShortDate(value: string) {
  return shortDateFormatter.format(new Date(value));
}

export function formatShortDateTime(value: string) {
  return shortDateTimeFormatter.format(new Date(value));
}