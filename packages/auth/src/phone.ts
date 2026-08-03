function getDigitsOnly(value: string) {
  return value.replace(/\D/g, "");
}

export function sanitizeCountryCodeInput(value: string) {
  const digits = getDigitsOnly(value).slice(0, 4);

  return digits ? `+${digits}` : "+";
}

export function sanitizeNationalPhoneInput(value: string) {
  return getDigitsOnly(value);
}

export function combinePhoneNumber(countryCode: string, nationalNumber: string) {
  const normalizedCountryCode = sanitizeCountryCodeInput(countryCode);
  const countryDigits = getDigitsOnly(normalizedCountryCode);
  const nationalDigits = sanitizeNationalPhoneInput(nationalNumber);
  const normalizedNationalNumber = nationalDigits.startsWith(countryDigits)
    ? nationalDigits.slice(countryDigits.length)
    : nationalDigits;

  return `${normalizedCountryCode}${normalizedNationalNumber}`;
}