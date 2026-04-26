import "server-only";

function hasValue(value: string | undefined) {
  return typeof value === "string" && value.trim().length > 0;
}

export function isWebAuthConfigured() {
  return [
    process.env.COGNITO_REGION,
    process.env.COGNITO_USER_POOL_ID,
    process.env.COGNITO_WEB_CLIENT_ID,
  ].every(hasValue);
}

export function getWebAuthSetupMessage() {
  return "Authentication is paused until Cognito values are configured. You can keep building the inner product flows in the meantime.";
}