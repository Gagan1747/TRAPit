import { type MobileAuthSession } from "../auth/session";

function normalizeIdentifier(value: string | null | undefined) {
  return value?.trim().toLowerCase().replace(/[\s()-]/g, "") ?? "";
}

export function isSuperAdminSession(session: MobileAuthSession) {
  const configured = process.env.EXPO_PUBLIC_TRAPIT_SUPER_ADMIN_PHONE ?? "+919899538637";
  const comparable = session.phoneNumber ?? session.displayIdentifier ?? session.sub;

  return normalizeIdentifier(comparable) === normalizeIdentifier(configured);
}

export function formatPhoneNumberForDisplay(
  value: string | null | undefined,
  options?: { showFullPhoneNumber?: boolean },
) {
  const trimmedValue = value?.trim() ?? "";

  if (!trimmedValue || options?.showFullPhoneNumber) {
    return trimmedValue;
  }

  const digits = trimmedValue.replace(/\D/g, "");

  if (digits.length < 10) {
    return trimmedValue;
  }

  const maskedDigits = `${"*".repeat(Math.max(0, digits.length - 4))}${digits.slice(-4)}`;

  return trimmedValue.startsWith("+") ? `+${maskedDigits}` : maskedDigits;
}