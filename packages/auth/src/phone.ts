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
  const normalizedNationalNumber = sanitizeNationalPhoneInput(nationalNumber);

  return `${normalizedCountryCode}${normalizedNationalNumber}`;
}