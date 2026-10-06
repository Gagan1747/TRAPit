export function buildApportionBookingPath(
  shareCode: string,
  searchParams?: Record<string, string | string[] | undefined>,
) {
  const bookingUrl = new URL(`/apportion/${encodeURIComponent(shareCode)}`, "https://trapit.local");
  for (const key of ["serviceId", "locationId", "addressId", "ownerIdentifier"]) {
    const value = searchParams?.[key];
    if (typeof value === "string" && value.trim()) {
      bookingUrl.searchParams.set(key, value.trim());
    }
  }
  return `${bookingUrl.pathname}${bookingUrl.search}`;
}