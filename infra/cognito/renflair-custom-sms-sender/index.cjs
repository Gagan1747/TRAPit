const { buildClient, CommitmentPolicy, KmsKeyringNode } = require("@aws-crypto/client-node");
const { GetSecretValueCommand, SecretsManagerClient } = require("@aws-sdk/client-secrets-manager");

const RENFLAIR_ENDPOINT = "https://whatsapp.renflair.in/V1.php";
const DEFAULT_COUNTRY_CODE = "91";

const secretsClient = new SecretsManagerClient({});
const { decrypt } = buildClient(CommitmentPolicy.REQUIRE_ENCRYPT_ALLOW_DECRYPT);

let cachedSecret = null;

function getRequiredEnv(name) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

async function getRenflairSecret() {
  if (cachedSecret) {
    return cachedSecret;
  }

  const secretId = getRequiredEnv("RENFLAIR_SECRET_ID");
  const response = await secretsClient.send(new GetSecretValueCommand({ SecretId: secretId }));
  const secretText = response.SecretString;

  if (!secretText) {
    throw new Error("Renflair secret must be stored as a JSON string.");
  }

  const secret = JSON.parse(secretText);

  if (!secret.apiKey) {
    throw new Error("Renflair secret JSON must contain apiKey.");
  }

  cachedSecret = {
    apiKey: String(secret.apiKey),
    countryCode: String(secret.countryCode || process.env.RENFLAIR_COUNTRY_CODE || DEFAULT_COUNTRY_CODE),
  };

  return cachedSecret;
}

async function decryptCognitoCode(encryptedCode) {
  const keyArn = getRequiredEnv("COGNITO_CUSTOM_SENDER_KMS_KEY_ARN");
  const keyring = new KmsKeyringNode({
    generatorKeyId: keyArn,
    keyIds: [keyArn],
  });
  const { plaintext } = await decrypt(keyring, Buffer.from(encryptedCode, "base64"));

  return plaintext.toString("utf8");
}

function normalizeIndianPhoneNumber(phoneNumber) {
  const digits = String(phoneNumber || "").replace(/\D/g, "");

  if (digits.length === 12 && digits.startsWith("91")) {
    return digits.slice(2);
  }

  if (digits.length === 10) {
    return digits;
  }

  throw new Error("Renflair WhatsApp OTP expects a 10 digit Indian mobile number.");
}

async function sendRenflairOtp({ apiKey, countryCode, otp, phoneNumber }) {
  const url = new URL(RENFLAIR_ENDPOINT);
  url.searchParams.set("API", apiKey);
  url.searchParams.set("PHONE", normalizeIndianPhoneNumber(phoneNumber));
  url.searchParams.set("OTP", otp);
  url.searchParams.set("COUNTRY", countryCode);

  const response = await fetch(url, { method: "GET" });
  const responseText = await response.text();

  if (!response.ok) {
    throw new Error(`Renflair request failed with HTTP ${response.status}.`);
  }

  return responseText;
}

exports.handler = async (event) => {
  const triggerSource = event.triggerSource || "unknown";
  const encryptedCode = event.request && event.request.code;
  const phoneNumber = event.request && event.request.userAttributes && event.request.userAttributes.phone_number;

  if (!encryptedCode) {
    throw new Error("Cognito custom sender event did not include an encrypted code.");
  }

  if (!phoneNumber) {
    throw new Error("Cognito custom sender event did not include phone_number.");
  }

  const [otp, secret] = await Promise.all([decryptCognitoCode(encryptedCode), getRenflairSecret()]);
  await sendRenflairOtp({
    apiKey: secret.apiKey,
    countryCode: secret.countryCode,
    otp,
    phoneNumber,
  });

  console.log(JSON.stringify({
    delivery: "renflair-whatsapp",
    phoneSuffix: phoneNumber.slice(-4),
    status: "sent",
    triggerSource,
  }));

  return event;
};