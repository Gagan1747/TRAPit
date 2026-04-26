function hasValue(value: string | undefined) {
  return typeof value === "string" && value.trim().length > 0;
}

export function isMobileAuthConfigured() {
  return [
    process.env.EXPO_PUBLIC_COGNITO_REGION,
    process.env.EXPO_PUBLIC_COGNITO_USER_POOL_ID,
    process.env.EXPO_PUBLIC_COGNITO_MOBILE_CLIENT_ID,
  ].every(hasValue);
}

export function getMobileAuthSetupMessage() {
  return "Authentication is paused until Cognito values are configured. Continue building the app flows first.";
}