import "server-only";

import {
  AdminAddUserToGroupCommand,
  CognitoIdentityProviderClient,
  ListUsersCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import { buildSessionFromClaims, type AuthSession, type TokenClaims } from "@trapit/auth";
import { CognitoJwtVerifier } from "aws-jwt-verify";

type CognitoConfig = {
  adminGroup: string;
  mobileClientId: string | null;
  region: string;
  userGroup: string;
  userPoolId: string;
  webClientId: string;
};

type CognitoRequestError = Error & {
  code?: string;
  status?: number;
};

type SignUpResponse = {
  CodeDeliveryDetails?: {
    Destination?: string;
  };
  UserConfirmed?: boolean;
};

type ConfirmSignUpResponse = {
  status: "confirmed";
};

type ResendConfirmationCodeResponse = {
  CodeDeliveryDetails?: {
    Destination?: string;
  };
};

type ForgotPasswordResponse = {
  CodeDeliveryDetails?: {
    Destination?: string;
  };
};

type ConfirmForgotPasswordResponse = Record<string, never>;

type SignInResponse = {
  AuthenticationResult?: {
    AccessToken?: string;
    ExpiresIn?: number;
    IdToken?: string;
    RefreshToken?: string;
  };
  ChallengeName?: string;
};

export type CognitoTokens = {
  accessToken: string;
  expiresIn: number;
  idToken: string;
  refreshToken?: string;
};

export type RegisteredDirectoryUser = {
  identifier: string;
  label: string;
  sub: string | null;
};

function normalizePhoneNumber(phoneNumber: string): string {
  const normalized = phoneNumber.trim().replace(/[\s()-]/g, "");

  if (!/^\+[1-9]\d{7,14}$/.test(normalized)) {
    throw new Error("Phone number must use E.164 format, for example +14155550123.");
  }

  return normalized;
}

let cachedConfig: CognitoConfig | null = null;

function getRequiredEnv(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function getConfig(): CognitoConfig {
  if (cachedConfig) {
    return cachedConfig;
  }

  cachedConfig = {
    adminGroup: process.env.COGNITO_ADMIN_GROUP ?? "admins",
    mobileClientId: process.env.COGNITO_MOBILE_CLIENT_ID ?? null,
    region: getRequiredEnv("COGNITO_REGION"),
    userGroup: process.env.COGNITO_USER_GROUP ?? "users",
    userPoolId: getRequiredEnv("COGNITO_USER_POOL_ID"),
    webClientId: getRequiredEnv("COGNITO_WEB_CLIENT_ID"),
  };

  return cachedConfig;
}

function getEndpoint(): string {
  const config = getConfig();

  return `https://cognito-idp.${config.region}.amazonaws.com/`;
}

async function cognitoJsonRequest<T>(target: string, body: Record<string, unknown>): Promise<T> {
  const response = await fetch(getEndpoint(), {
    body: JSON.stringify(body),
    cache: "no-store",
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
    const error = new Error(
      typeof payload?.message === "string"
        ? payload.message
        : "Cognito request failed.",
    ) as CognitoRequestError;

    error.code =
      typeof payload?.__type === "string"
        ? payload.__type.split("#").pop()
        : undefined;
    error.status = response.status;
    throw error;
  }

  return (payload ?? {}) as T;
}

function getAdminClient(): CognitoIdentityProviderClient {
  const config = getConfig();

  return new CognitoIdentityProviderClient({
    region: config.region,
  });
}

function getAttributeValue(
  attributes: Array<{ Name?: string; Value?: string }> | undefined,
  attributeName: string,
) {
  return attributes?.find((attribute) => attribute.Name === attributeName)?.Value?.trim() ?? "";
}

function getVerifier() {
  const config = getConfig();

  return CognitoJwtVerifier.create({
    clientId: config.webClientId,
    tokenUse: "id",
    userPoolId: config.userPoolId,
  });
}

function getAccessTokenVerifier() {
  const config = getConfig();

  return CognitoJwtVerifier.create({
    clientId: config.webClientId,
    tokenUse: "access",
    userPoolId: config.userPoolId,
  });
}

async function verifyWithClientIds(
  token: string,
  createVerifier: (clientId: string) => ReturnType<typeof CognitoJwtVerifier.create>,
) {
  const config = getConfig();
  const clientIds = [config.webClientId, config.mobileClientId].filter(Boolean) as string[];
  let lastError: unknown = null;

  for (const clientId of clientIds) {
    try {
      return (await createVerifier(clientId).verify(token)) as TokenClaims;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Unable to verify the Cognito token.");
}

export async function signUpWithCognito(
  phoneNumber: string,
  password: string,
  fullName: string,
) {
  const config = getConfig();
  const normalizedPhoneNumber = normalizePhoneNumber(phoneNumber);
  const normalizedFullName = fullName.trim();

  if (!normalizedFullName) {
    throw new Error("Full name is required.");
  }

  return cognitoJsonRequest<SignUpResponse>(
    "AWSCognitoIdentityProviderService.SignUp",
    {
      ClientId: config.webClientId,
      Password: password,
      UserAttributes: [
        {
          Name: "phone_number",
          Value: normalizedPhoneNumber,
        },
        {
          Name: "name",
          Value: normalizedFullName,
        },
      ],
      Username: normalizedPhoneNumber,
    },
  );
}

export async function confirmCognitoSignUp(phoneNumber: string, code: string) {
  const config = getConfig();
  const normalizedPhoneNumber = normalizePhoneNumber(phoneNumber);

  return cognitoJsonRequest<ConfirmSignUpResponse>(
    "AWSCognitoIdentityProviderService.ConfirmSignUp",
    {
      ClientId: config.webClientId,
      ConfirmationCode: code,
      Username: normalizedPhoneNumber,
    },
  );
}

export async function resendCognitoConfirmationCode(phoneNumber: string) {
  const config = getConfig();
  const normalizedPhoneNumber = normalizePhoneNumber(phoneNumber);

  return cognitoJsonRequest<ResendConfirmationCodeResponse>(
    "AWSCognitoIdentityProviderService.ResendConfirmationCode",
    {
      ClientId: config.webClientId,
      Username: normalizedPhoneNumber,
    },
  );
}

export async function signInWithCognito(phoneNumber: string, password: string) {
  const config = getConfig();
  const normalizedPhoneNumber = normalizePhoneNumber(phoneNumber);
  const result = await cognitoJsonRequest<SignInResponse>(
    "AWSCognitoIdentityProviderService.InitiateAuth",
    {
      AuthFlow: "USER_PASSWORD_AUTH",
      AuthParameters: {
        PASSWORD: password,
        USERNAME: normalizedPhoneNumber,
      },
      ClientId: config.webClientId,
    },
  );

  if (result.ChallengeName) {
    throw new Error(`Unsupported Cognito auth challenge: ${result.ChallengeName}`);
  }

  if (!result.AuthenticationResult?.IdToken || !result.AuthenticationResult.AccessToken) {
    throw new Error("Cognito did not return a usable session.");
  }

  return {
    accessToken: result.AuthenticationResult.AccessToken,
    expiresIn: result.AuthenticationResult.ExpiresIn ?? 3600,
    idToken: result.AuthenticationResult.IdToken,
    refreshToken: result.AuthenticationResult.RefreshToken,
  } satisfies CognitoTokens;
}

export async function requestPasswordReset(phoneNumber: string) {
  const config = getConfig();
  const normalizedPhoneNumber = normalizePhoneNumber(phoneNumber);

  return cognitoJsonRequest<ForgotPasswordResponse>(
    "AWSCognitoIdentityProviderService.ForgotPassword",
    {
      ClientId: config.webClientId,
      Username: normalizedPhoneNumber,
    },
  );
}

export async function confirmPasswordReset(
  phoneNumber: string,
  code: string,
  password: string,
) {
  const config = getConfig();
  const normalizedPhoneNumber = normalizePhoneNumber(phoneNumber);

  return cognitoJsonRequest<ConfirmForgotPasswordResponse>(
    "AWSCognitoIdentityProviderService.ConfirmForgotPassword",
    {
      ClientId: config.webClientId,
      ConfirmationCode: code,
      Password: password,
      Username: normalizedPhoneNumber,
    },
  );
}

export async function verifyWebIdToken(idToken: string): Promise<AuthSession> {
  return verifyWebTokens({ idToken });
}

export async function verifyWebTokens(tokens: {
  accessToken?: string;
  idToken: string;
}): Promise<AuthSession> {
  const config = getConfig();
  const idClaims = await verifyWithClientIds(tokens.idToken, (clientId) =>
    CognitoJwtVerifier.create({
      clientId,
      tokenUse: "id",
      userPoolId: config.userPoolId,
    }),
  );
  const accessClaims = tokens.accessToken
    ? await verifyWithClientIds(tokens.accessToken, (clientId) =>
        CognitoJwtVerifier.create({
          clientId,
          tokenUse: "access",
          userPoolId: config.userPoolId,
        }),
      )
    : null;
  const mergedClaims = {
    ...idClaims,
    ...accessClaims,
    email: idClaims.email ?? accessClaims?.email,
    exp: idClaims.exp ?? accessClaims?.exp,
    phone_number: idClaims.phone_number ?? accessClaims?.phone_number,
    sub: idClaims.sub ?? accessClaims?.sub,
  } satisfies TokenClaims;
  const session = buildSessionFromClaims(mergedClaims, {
    adminGroup: config.adminGroup,
    defaultRole: "user",
    userGroup: config.userGroup,
  });

  if (!session) {
    throw new Error("Signed in user does not carry a supported Cognito role claim.");
  }

  return session;
}

export async function addUserToDefaultGroup(phoneNumber: string) {
  const config = getConfig();
  const normalizedPhoneNumber = normalizePhoneNumber(phoneNumber);

  await getAdminClient().send(
    new AdminAddUserToGroupCommand({
      GroupName: config.userGroup,
      Username: normalizedPhoneNumber,
      UserPoolId: config.userPoolId,
    }),
  );
}

export async function listRegisteredDirectoryUsers(): Promise<RegisteredDirectoryUser[]> {
  const config = getConfig();
  const users: RegisteredDirectoryUser[] = [];
  let paginationToken: string | undefined;

  do {
    const response = await getAdminClient().send(
      new ListUsersCommand({
        Limit: 60,
        PaginationToken: paginationToken,
        UserPoolId: config.userPoolId,
      }),
    );

    for (const user of response.Users ?? []) {
      const identifier =
        getAttributeValue(user.Attributes, "phone_number") || user.Username?.trim() || "";

      if (!identifier) {
        continue;
      }

      const label =
        getAttributeValue(user.Attributes, "name") ||
        getAttributeValue(user.Attributes, "preferred_username") ||
        getAttributeValue(user.Attributes, "given_name") ||
        identifier;

      users.push({ identifier, label, sub: getAttributeValue(user.Attributes, "sub") || null });
    }

    paginationToken = response.PaginationToken;
  } while (paginationToken);

  return users;
}

export function getCognitoErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    const cognitoError = error as CognitoRequestError;

    switch (cognitoError.code ?? "") {
      case "CodeMismatchException":
        return "The confirmation code is invalid.";
      case "ExpiredCodeException":
        return "The confirmation code has expired.";
      case "InvalidPasswordException":
        return "Password does not meet the Cognito policy.";
      case "NotAuthorizedException":
        return "Phone number or password is incorrect.";
      case "PasswordResetRequiredException":
        return "Password reset required for this user. Use Reset password to receive an SMS code.";
      case "UserNotConfirmedException":
        return "Confirm the account before signing in.";
      case "UsernameExistsException":
        return "An account with this phone number already exists.";
      case "LimitExceededException":
        return "Too many attempts. Wait a moment before requesting another code.";
      default:
        return error.message;
    }
  }

  return "Unexpected authentication error.";
}