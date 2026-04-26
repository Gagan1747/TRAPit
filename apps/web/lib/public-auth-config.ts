function hasValue(value: string | undefined) {
  return typeof value === "string" && value.trim().length > 0;
}

export function isPublicWebAuthConfigured() {
  return [
    process.env.NEXT_PUBLIC_COGNITO_REGION,
    process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID,
    process.env.NEXT_PUBLIC_COGNITO_WEB_CLIENT_ID,
  ].every(hasValue);
}

export function getPublicWebAuthSetupMessage() {
  return "Authentication is paused until Cognito values are configured. You can keep building the inner product flows in the meantime.";
}