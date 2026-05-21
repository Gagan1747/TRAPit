export type PhoneCountry = {
  code: string;
  dialCode: string;
  name: string;
};

export const DEFAULT_PHONE_COUNTRY_CODE = "IN";

export const PHONE_COUNTRIES: PhoneCountry[] = [
  { code: "IN", dialCode: "+91", name: "India" },
  { code: "US", dialCode: "+1", name: "United States" },
  { code: "CA", dialCode: "+1", name: "Canada" },
  { code: "GB", dialCode: "+44", name: "United Kingdom" },
  { code: "AE", dialCode: "+971", name: "United Arab Emirates" },
  { code: "AU", dialCode: "+61", name: "Australia" },
  { code: "SG", dialCode: "+65", name: "Singapore" },
  { code: "ZA", dialCode: "+27", name: "South Africa" },
];

export function getPhoneCountryByCode(code: string) {
  return PHONE_COUNTRIES.find((country) => country.code === code) ?? PHONE_COUNTRIES[0];
}

export function formatPhoneCountryLabel(country: PhoneCountry) {
  return `${country.name} (${country.dialCode})`;
}