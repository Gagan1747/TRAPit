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