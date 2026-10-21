export function slugifyApportionBusinessName(businessName?: string | null) {
  if (!businessName) return "";
  return businessName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function formatApportionShareSegment(shareCode: string, businessName?: string | null) {
  const code = shareCode.trim();
  if (!code) return "";
  const slug = slugifyApportionBusinessName(businessName);
  if (!slug) return code;
  if (code.toLowerCase().startsWith(`${slug}-`)) return code;
  return `${slug}-${code}`;
}

export function buildApportionBookingPath(
  shareCode: string,
  searchParams?: Record<string, string | string[] | undefined>,
  businessName?: string | null,
) {
  const segment = formatApportionShareSegment(shareCode, businessName);
  const bookingUrl = new URL(`/apportion/${encodeURIComponent(segment)}`, "https://trapit.local");
  for (const key of ["serviceId", "locationId", "addressId", "ownerIdentifier"]) {
    const value = searchParams?.[key];
    if (typeof value === "string" && value.trim()) {
      bookingUrl.searchParams.set(key, value.trim());
    }
  }
  return `${bookingUrl.pathname}${bookingUrl.search}`;
}