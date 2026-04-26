import { type UserRole } from "@trapit/auth";

type SignUpResponse = {
  deliveryDestination?: string | null;
  error?: string;
  requiresConfirmation?: boolean;
  warning?: string;
};

type ConfirmSignUpResponse = {
  confirmed?: boolean;
  error?: string;
};

type SignInResponse = {
  AuthenticationResult?: {
    AccessToken?: string;
    ExpiresIn?: number;
    IdToken?: string;
    RefreshToken?: string;
  };
  ChallengeName?: string;
  __type?: string;
  message?: string;
};

export type MobileTokens = {
  accessToken: string;
  expiresIn: number;
  idToken: string;
  refreshToken?: string;
};

function normalizePhoneNumber(phoneNumber: string) {
  const normalized = phoneNumber.trim().replace(/[\s()-]/g, "");

  if (!/^\+[1-9]\d{7,14}$/.test(normalized)) {
    throw new Error("Phone number must use E.164 format, for example +14155550123.");
  }

  return normalized;
}

function getRequiredEnv(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function getEndpoint() {
  const region = getRequiredEnv("EXPO_PUBLIC_COGNITO_REGION");

  return `https://cognito-idp.${region}.amazonaws.com/`;
}

function getMobileClientId() {
  return getRequiredEnv("EXPO_PUBLIC_COGNITO_MOBILE_CLIENT_ID");
}

function getApiBaseUrl() {
  return process.env.EXPO_PUBLIC_API_BASE_URL ?? "http://localhost:3000";
}

async function cognitoJsonRequest<T>(target: string, body: Record<string, unknown>) {
  const response = await fetch(getEndpoint(), {
    body: JSON.stringify(body),
    headers: {
      "Content-Type": "application/x-amz-json-1.1",
      "X-Amz-Target": target,
    },
    method: "POST",
  });
  const payload = (await response.json().catch(() => null)) as
    | Record<string, unknown>
    | null;

  if (!response.ok) {
    throw new Error(
      typeof payload?.message === "string"
        ? payload.message
        : "Authentication request failed.",
    );
  }

  return (payload ?? {}) as T;
}

export async function mobileSignIn(phoneNumber: string, password: string) {
  const normalizedPhoneNumber = normalizePhoneNumber(phoneNumber);

  const result = await cognitoJsonRequest<SignInResponse>(
    "AWSCognitoIdentityProviderService.InitiateAuth",
    {
      AuthFlow: "USER_PASSWORD_AUTH",
      AuthParameters: {
        PASSWORD: password,
        USERNAME: normalizedPhoneNumber,
      },
      ClientId: getMobileClientId(),
    },
  );

  if (result.ChallengeName) {
    throw new Error(`Unsupported Cognito auth challenge: ${result.ChallengeName}`);
  }

  if (!result.AuthenticationResult?.IdToken || !result.AuthenticationResult.AccessToken) {
    throw new Error("Cognito did not return a usable mobile session.");
  }

  return {
    accessToken: result.AuthenticationResult.AccessToken,
    expiresIn: result.AuthenticationResult.ExpiresIn ?? 3600,
    idToken: result.AuthenticationResult.IdToken,
    refreshToken: result.AuthenticationResult.RefreshToken,
  } satisfies MobileTokens;
}

export async function mobileSignUp(phoneNumber: string, password: string) {
  const response = await fetch(`${getApiBaseUrl()}/api/auth/sign-up`, {
    body: JSON.stringify({ phoneNumber: normalizePhoneNumber(phoneNumber), password }),
    headers: {
      "Content-Type": "application/json",
    },
    method: "POST",
  });
  const payload = (await response.json()) as SignUpResponse;

  if (!response.ok) {
    throw new Error(payload.error ?? "Sign-up failed.");
  }

  return payload;
}

export async function mobileConfirmSignUp(phoneNumber: string, code: string) {
  const response = await fetch(`${getApiBaseUrl()}/api/auth/confirm-sign-up`, {
    body: JSON.stringify({ code, phoneNumber: normalizePhoneNumber(phoneNumber) }),
    headers: {
      "Content-Type": "application/json",
    },
    method: "POST",
  });
  const payload = (await response.json()) as ConfirmSignUpResponse;

  if (!response.ok) {
    throw new Error(payload.error ?? "Confirmation failed.");
  }

  return payload;
}

export function getExpectedRoleError(expectedRole: UserRole, actualRole: UserRole) {
  return `This account is signed in as ${actualRole}, not ${expectedRole}.`;
}