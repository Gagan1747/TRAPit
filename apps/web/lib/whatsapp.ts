import "server-only";

import { formatShortDateTimeIst } from "./date-format";

const DEFAULT_GRAPH_API_VERSION = "v21.0";
const DEFAULT_COUNTRY_CODE = "91";
const DEFAULT_BOOKED_TEMPLATE = "appointment_booked_on_trapit";
const DEFAULT_INVITATION_TEMPLATE = "appointment_invitation_on_trapit";
const DEFAULT_INSTANT_TEST_TEMPLATE = "instant_test_scheduled_on_trapit";
const DEFAULT_RAPID_TEST_TEMPLATE = "rapid_test_scheduled";
const DEFAULT_SCHEDULED_TEST_TEMPLATE = "test_scheduled_on_trapit";
const DEFAULT_TEMPLATE_LANGUAGE = "en";

const DEFAULT_BOOKED_PARAM_NAMES = [
  "owner_staff_name",
  "requester_name",
  "requester_phone_number",
  "date_and_time",
  "service_name",
  "address",
] as const;

const DEFAULT_INVITATION_PARAM_NAMES = [
  "requester_name",
  "owner_staff_name",
  "owner_staff_number",
  "date_and_time",
  "service_name",
  "address",
] as const;

const DEFAULT_INSTANT_TEST_PARAM_NAMES = [
  "participant_name",
  "test_creator_name",
  "test_creator_number",
  "test_name",
  "test_group",
] as const;

const DEFAULT_RAPID_TEST_PARAM_NAMES = [
  "participant_name",
  "test_creator_name",
  "test_creator_number",
  "test_name",
  "test_group",
] as const;

const DEFAULT_SCHEDULED_TEST_PARAM_NAMES = [
  "participant_name",
  "test_creator_name",
  "test_creator_number",
  "date_and_time",
  "test_name",
  "test_group",
] as const;

export type WhatsAppSendResult = {
  sent: boolean;
  messageId?: string | null;
  reason?: string;
  error?: string;
};

type CachedTemplateMetadata = {
  fetchedAt: number;
  status?: string;
  language: string;
  parameterFormat: "NAMED" | "POSITIONAL";
  bodyParamNames: string[];
};

const templateMetadataCache = new Map<string, CachedTemplateMetadata>();
const TEMPLATE_CACHE_TTL_MS = 10 * 60 * 1000;
const PENDING_TEMPLATE_CACHE_TTL_MS = 30 * 1000;

function getWhatsAppConfig() {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID?.trim() || "";
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN?.trim() || "";
  const businessAccountId = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID?.trim() || "";
  const apiVersion = process.env.WHATSAPP_API_VERSION?.trim() || DEFAULT_GRAPH_API_VERSION;
  const countryCode = (
    process.env.WHATSAPP_DEFAULT_COUNTRY_CODE?.trim()
    || process.env.RENFLAIR_COUNTRY_CODE?.trim()
    || DEFAULT_COUNTRY_CODE
  ).replace(/^\+/, "");
  const templateLanguage = process.env.WHATSAPP_TEMPLATE_LANGUAGE?.trim() || DEFAULT_TEMPLATE_LANGUAGE;
  const bookedTemplate = process.env.WHATSAPP_TEMPLATE_BOOKED?.trim() || DEFAULT_BOOKED_TEMPLATE;
  const invitationTemplate = process.env.WHATSAPP_TEMPLATE_INVITATION?.trim() || DEFAULT_INVITATION_TEMPLATE;
  const instantTestTemplate = process.env.WHATSAPP_TEMPLATE_INSTANT_TEST?.trim() || DEFAULT_INSTANT_TEST_TEMPLATE;
  const rapidTestTemplate = process.env.WHATSAPP_TEMPLATE_RAPID_TEST?.trim() || DEFAULT_RAPID_TEST_TEMPLATE;
  const scheduledTestTemplate = process.env.WHATSAPP_TEMPLATE_SCHEDULED_TEST?.trim() || DEFAULT_SCHEDULED_TEST_TEMPLATE;
  const paramFormatEnv = process.env.WHATSAPP_PARAM_FORMAT?.trim().toUpperCase();
  const parameterFormat: "NAMED" | "POSITIONAL" = paramFormatEnv === "POSITIONAL" ? "POSITIONAL" : "NAMED";

  return {
    accessToken,
    apiVersion,
    bookedTemplate,
    businessAccountId,
    configured: Boolean(phoneNumberId && accessToken),
    countryCode,
    instantTestTemplate,
    invitationTemplate,
    parameterFormat,
    phoneNumberId,
    rapidTestTemplate,
    scheduledTestTemplate,
    templateLanguage,
  };
}

export function isWhatsAppConfigured(): boolean {
  return getWhatsAppConfig().configured;
}

/**
 * Normalizes a phone number into Meta WhatsApp Cloud API format (digits only with country code, e.g. "919876543210").
 */
export function normalizeWhatsAppPhone(
  phone: string | null | undefined,
  defaultCountryCode?: string,
): string | null {
  if (!phone || typeof phone !== "string") {
    return null;
  }

  const trimmed = phone.trim();
  if (!trimmed) {
    return null;
  }

  const hasPlus = trimmed.startsWith("+");
  let digits = trimmed.replace(/\D/g, "");
  if (!digits) {
    return null;
  }

  if (digits.startsWith("00")) {
    digits = digits.slice(2);
  } else if (!hasPlus && digits.length === 11 && digits.startsWith("0")) {
    digits = digits.slice(1);
  }

  const countryCode = (defaultCountryCode || getWhatsAppConfig().countryCode || DEFAULT_COUNTRY_CODE).replace(/\D/g, "");
  if (digits.length === 10 && countryCode) {
    digits = `${countryCode}${digits}`;
  }

  if (digits.length < 8 || digits.length > 15) {
    return null;
  }

  return digits;
}

/**
 * Meta WhatsApp Cloud API rejects template parameters containing newlines, tabs, or >4 consecutive spaces (#132018).
 */
export function sanitizeWhatsAppTemplateParam(value: string | null | undefined, fallback = "—"): string {
  const cleaned = (value ?? "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
  return cleaned || fallback;
}

function parseConfiguredParamNames(envValue: string | undefined, defaults: readonly string[]): string[] {
  if (!envValue?.trim()) {
    return [...defaults];
  }
  const parsed = envValue
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  return parsed.length === defaults.length ? parsed : [...defaults];
}

async function resolveTemplateMetadataFromWaba(
  templateName: string,
  config: ReturnType<typeof getWhatsAppConfig>,
): Promise<CachedTemplateMetadata | null> {
  if (!config.businessAccountId || !config.accessToken) {
    return null;
  }

  const cached = templateMetadataCache.get(templateName);
  const ttl = cached?.status === "APPROVED" && cached.bodyParamNames.length >= 5
    ? TEMPLATE_CACHE_TTL_MS
    : PENDING_TEMPLATE_CACHE_TTL_MS;
  if (cached && Date.now() - cached.fetchedAt < ttl) {
    return cached;
  }

  try {
    const url = `https://graph.facebook.com/${encodeURIComponent(config.apiVersion)}/${encodeURIComponent(config.businessAccountId)}/message_templates?name=${encodeURIComponent(templateName)}&fields=name,language,parameter_format,components,status`;
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${config.accessToken}`,
        Accept: "application/json",
      },
      method: "GET",
    });

    if (!response.ok) {
      return null;
    }

    const payload = (await response.json()) as {
      data?: Array<{
        name?: string;
        status?: string;
        language?: string;
        parameter_format?: string;
        components?: Array<{
          type?: string;
          text?: string;
          example?: {
            body_text_named_params?: Array<{ param_name?: string }>;
          };
        }>;
      }>;
    };

    const match = payload.data?.find((entry) => entry.name === templateName) ?? payload.data?.[0];
    if (!match) {
      return null;
    }

    const bodyComponent = match.components?.find((comp) => comp.type?.toUpperCase() === "BODY");
    const explicitNamedParams = (bodyComponent?.example?.body_text_named_params ?? [])
      .map((entry) => entry.param_name?.trim() || "")
      .filter(Boolean);
    const bodyText = bodyComponent?.text ?? "";
    const regexMatches = Array.from(bodyText.matchAll(/\{\{\s*([a-z0-9_]+)\s*\}\}/g)).map((item) => item[1].trim());
    const variableMatches = explicitNamedParams.length > 0 ? explicitNamedParams : regexMatches;
    const isPositional = match.parameter_format?.toUpperCase() === "POSITIONAL"
      || (variableMatches.length > 0 && variableMatches.every((name) => /^\d+$/.test(name)));

    const metadata: CachedTemplateMetadata = {
      fetchedAt: Date.now(),
      status: match.status?.toUpperCase(),
      language: match.language || config.templateLanguage,
      parameterFormat: isPositional ? "POSITIONAL" : "NAMED",
      bodyParamNames: variableMatches,
    };
    templateMetadataCache.set(templateName, metadata);
    return metadata;
  } catch {
    return null;
  }
}

type TemplateParameterInput = {
  name: string;
  value: string;
};

async function postWhatsAppTemplateMessage(options: {
  to: string;
  templateName: string;
  languageCode: string;
  parameters: TemplateParameterInput[];
  parameterFormat: "NAMED" | "POSITIONAL";
  config: ReturnType<typeof getWhatsAppConfig>;
}): Promise<{ ok: boolean; status: number; messageId?: string | null; errorCode?: number; errorMessage?: string }> {
  const { config, languageCode, parameterFormat, parameters, templateName, to } = options;
  const endpoint = `https://graph.facebook.com/${encodeURIComponent(config.apiVersion)}/${encodeURIComponent(config.phoneNumberId)}/messages`;

  const bodyParameters = parameters.map((param) =>
    parameterFormat === "NAMED"
      ? {
          type: "text",
          parameter_name: param.name,
          text: sanitizeWhatsAppTemplateParam(param.value),
        }
      : {
          type: "text",
          text: sanitizeWhatsAppTemplateParam(param.value),
        },
  );

  const requestBody = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "template",
    template: {
      name: templateName,
      language: {
        code: languageCode,
      },
      components: bodyParameters.length
        ? [
            {
              type: "body",
              parameters: bodyParameters,
            },
          ]
        : [],
    },
  };

  const response = await fetch(endpoint, {
    body: JSON.stringify(requestBody),
    headers: {
      Authorization: `Bearer ${config.accessToken}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    method: "POST",
  });

  const payload = (await response.json().catch(() => ({}))) as {
    messages?: Array<{ id?: string }>;
    error?: { code?: number; message?: string; error_data?: { details?: string } };
  };

  if (response.ok) {
    return {
      ok: true,
      status: response.status,
      messageId: payload.messages?.[0]?.id ?? null,
    };
  }

  const details = payload.error?.error_data?.details;
  const errorMessage = details
    ? `${payload.error?.message || "WhatsApp API error"} (${details})`
    : payload.error?.message || `WhatsApp API failed with HTTP ${response.status}`;

  return {
    ok: false,
    status: response.status,
    errorCode: payload.error?.code,
    errorMessage,
  };
}

export async function sendWhatsAppTemplateMessage(input: {
  recipientPhone: string | null | undefined;
  templateName: string;
  parameters: TemplateParameterInput[];
  languageCode?: string;
}): Promise<WhatsAppSendResult> {
  const config = getWhatsAppConfig();
  if (!config.configured) {
    return { sent: false, reason: "unconfigured" };
  }

  const normalizedPhone = normalizeWhatsAppPhone(input.recipientPhone, config.countryCode);
  if (!normalizedPhone) {
    return { sent: false, reason: "invalid-phone" };
  }

  try {
    const discovered = await resolveTemplateMetadataFromWaba(input.templateName, config);
    if (discovered?.status && discovered.status !== "APPROVED") {
      console.warn(
        `WhatsApp template "${input.templateName}" currently has status "${discovered.status}" in Meta (must be APPROVED before Meta can deliver it).`,
      );
    }
    const initialLanguage = input.languageCode?.trim() || discovered?.language || config.templateLanguage;
    const initialFormat = discovered?.parameterFormat || config.parameterFormat;
    const resolvedParameters = discovered
      ? discovered.bodyParamNames.map((discoveredName, index) => {
          const byExactName = input.parameters.find((param) => param.name === discoveredName);
          return {
            name: discoveredName,
            value: byExactName?.value ?? input.parameters[index]?.value ?? "—",
          };
        })
      : input.parameters;

    let attempt = await postWhatsAppTemplateMessage({
      config,
      languageCode: initialLanguage,
      parameterFormat: initialFormat,
      parameters: resolvedParameters,
      templateName: input.templateName,
      to: normalizedPhone,
    });

    // Fallback if language code in Meta is "en_US" instead of "en" (or vice versa) — Error #132001
    if (!attempt.ok && attempt.errorCode === 132001) {
      const fallbackLanguage = initialLanguage === "en" ? "en_US" : initialLanguage === "en_US" ? "en" : null;
      if (fallbackLanguage) {
        attempt = await postWhatsAppTemplateMessage({
          config,
          languageCode: fallbackLanguage,
          parameterFormat: initialFormat,
          parameters: resolvedParameters,
          templateName: input.templateName,
          to: normalizedPhone,
        });
      }
    }

    // Only fallback to POSITIONAL when WABA metadata wasn't available to confirm NAMED format
    if (!attempt.ok && !discovered && initialFormat === "NAMED" && (attempt.errorCode === 132000 || attempt.errorCode === 100)) {
      const positionalAttempt = await postWhatsAppTemplateMessage({
        config,
        languageCode: initialLanguage,
        parameterFormat: "POSITIONAL",
        parameters: resolvedParameters,
        templateName: input.templateName,
        to: normalizedPhone,
      });
      if (positionalAttempt.ok) {
        attempt = positionalAttempt;
      }
    }

    if (attempt.ok) {
      return {
        sent: true,
        messageId: attempt.messageId,
      };
    }

    console.warn(`Unable to send WhatsApp template "${input.templateName}" to ${normalizedPhone}: ${attempt.errorMessage}`);
    return {
      sent: false,
      reason: "api-error",
      error: attempt.errorMessage,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown WhatsApp network error";
    console.warn(`Unable to send WhatsApp template "${input.templateName}":`, error);
    return {
      sent: false,
      reason: "network-error",
      error: message,
    };
  }
}

function formatLocationDisplay(locationName: string | null | undefined, locationAddress: string | null | undefined): string {
  const name = locationName?.trim() || "";
  const address = locationAddress?.trim() || "";
  if (name && address && name.toLowerCase() !== address.toLowerCase()) {
    return `${name}, ${address}`;
  }
  return address || name || "Business location";
}

function formatAppointmentDateTime(startsAt: string, justAddToList?: boolean, bookedQueuePosition?: number): string {
  const formatted = formatShortDateTimeIst(startsAt);
  if (justAddToList && bookedQueuePosition && bookedQueuePosition > 0) {
    return `${formatted} (Queue #${bookedQueuePosition})`;
  }
  return formatted;
}

/**
 * Sends Template 1 (`appointment_booked_on_trapit`) to the Assigned Staff (if assigned) or the Business Owner.
 *
 * Template body:
 * *Appointment Booked on TRAPit.in*
 * Hello {{owner_staff_name}}, a new appointment has been scheduled by {{requester_name}} ({{requester_phone_number}}),
 * Scheduled for: {{date_and_time}}
 * Purpose: {{service_name}}
 * Location: {{address}}
 * Sign in to TRAPit.in to manage this appointment.
 */
export async function sendAppointmentBookedWhatsAppNotification(appointment: {
  assignedStaffIdentifier?: string | null;
  assignedStaffName?: string | null;
  assignedStaffPhone?: string | null;
  bookedQueuePosition?: number;
  justAddToList?: boolean;
  locationAddress: string;
  locationName: string;
  ownerIdentifier: string;
  ownerName: string | null;
  requesterIdentifier: string;
  requesterName: string;
  requesterPhone: string | null;
  serviceName?: string | null;
  startsAt: string;
}): Promise<WhatsAppSendResult> {
  const config = getWhatsAppConfig();
  if (!config.configured) {
    return { sent: false, reason: "unconfigured" };
  }

  const hasAssignedStaff = Boolean(appointment.assignedStaffIdentifier?.trim());
  const recipientPhone = hasAssignedStaff
    ? appointment.assignedStaffPhone?.trim() || appointment.assignedStaffIdentifier?.trim()
    : appointment.ownerIdentifier.trim();

  const recipientDisplayName = hasAssignedStaff
    ? appointment.assignedStaffName?.trim() || appointment.ownerName?.trim() || "Team Member"
    : appointment.ownerName?.trim() || appointment.assignedStaffName?.trim() || "Business Owner";

  const paramNames = parseConfiguredParamNames(
    process.env.WHATSAPP_BOOKED_PARAM_NAMES,
    DEFAULT_BOOKED_PARAM_NAMES,
  );

  const values = [
    recipientDisplayName,
    appointment.requesterName?.trim() || "Customer",
    appointment.requesterPhone?.trim() || appointment.requesterIdentifier.trim(),
    formatAppointmentDateTime(appointment.startsAt, appointment.justAddToList, appointment.bookedQueuePosition),
    appointment.serviceName?.trim() || "Consultation",
    formatLocationDisplay(appointment.locationName, appointment.locationAddress),
  ];

  return sendWhatsAppTemplateMessage({
    recipientPhone,
    templateName: config.bookedTemplate,
    parameters: paramNames.map((name, index) => ({
      name,
      value: values[index] ?? "—",
    })),
  });
}

/**
 * Sends Template 2 (`appointment_invitation_on_trapit`) to the invited business user.
 *
 * Template body:
 * *Appointment Invitation on TRAPit.in*
 * Hello {{requester_name}}, {{owner_staff_name}} ({{owner_staff_number}}) has invited you for an appointment,
 * Scheduled for: {{date_and_time}}.
 * Purpose: {{service_name}}
 * Location: {{address}}
 * Please sign in to TRAPit.in to accept or decline this invitation and to see the real time status of this appointment before it expires.
 */
export async function sendAppointmentInvitationWhatsAppNotification(invitation: {
  assignedStaffIdentifier?: string | null;
  assignedStaffName?: string | null;
  assignedStaffPhone?: string | null;
  locationAddress: string;
  locationName: string;
  occurrences: Array<{ serviceDateKey: string; startsAt: string }>;
  ownerIdentifier: string;
  ownerName: string | null;
  requesterIdentifier: string;
  requesterName: string;
  requesterPhone?: string | null;
  serviceName: string;
}): Promise<WhatsAppSendResult> {
  const config = getWhatsAppConfig();
  if (!config.configured) {
    return { sent: false, reason: "unconfigured" };
  }

  const recipientPhone = invitation.requesterPhone?.trim() || invitation.requesterIdentifier.trim();
  const inviterDisplayName = invitation.ownerName?.trim()
    || invitation.assignedStaffName?.trim()
    || "Business Owner";
  const inviterPhoneNumber = invitation.assignedStaffPhone?.trim()
    || invitation.assignedStaffIdentifier?.trim()
    || invitation.ownerIdentifier?.trim()
    || "—";

  const firstOccurrence = invitation.occurrences[0];
  const baseSchedule = firstOccurrence
    ? formatShortDateTimeIst(firstOccurrence.startsAt)
    : "Scheduled slot";
  const scheduleDisplay = invitation.occurrences.length > 1
    ? `${baseSchedule} (+${invitation.occurrences.length - 1} more slot${invitation.occurrences.length - 1 === 1 ? "" : "s"})`
    : baseSchedule;

  const paramNames = parseConfiguredParamNames(
    process.env.WHATSAPP_INVITATION_PARAM_NAMES,
    DEFAULT_INVITATION_PARAM_NAMES,
  );

  const values = [
    invitation.requesterName?.trim() || "Customer",
    inviterDisplayName,
    inviterPhoneNumber,
    scheduleDisplay,
    invitation.serviceName?.trim() || "Consultation",
    formatLocationDisplay(invitation.locationName, invitation.locationAddress),
  ];

  return sendWhatsAppTemplateMessage({
    recipientPhone,
    templateName: config.invitationTemplate,
    parameters: paramNames.map((name, index) => ({
      name,
      value: values[index] ?? "—",
    })),
  });
}

/**
 * Sends `instant_test_scheduled_on_trapit` when an Instant Test is scheduled.
 */
export async function sendInstantTestScheduledWhatsAppNotification(input: {
  participantName: string;
  participantPhone: string;
  testCreatorName: string;
  testCreatorNumber: string;
  testGroup: string;
  testName: string;
}): Promise<WhatsAppSendResult> {
  const config = getWhatsAppConfig();
  if (!config.configured) {
    return { sent: false, reason: "unconfigured" };
  }

  const paramNames = parseConfiguredParamNames(
    process.env.WHATSAPP_INSTANT_TEST_PARAM_NAMES,
    DEFAULT_INSTANT_TEST_PARAM_NAMES,
  );

  const values = [
    input.participantName?.trim() || "Participant",
    input.testCreatorName?.trim() || "Test Creator",
    input.testCreatorNumber?.trim() || "—",
    input.testName?.trim() || "Instant Test",
    input.testGroup?.trim() || "Group",
  ];

  return sendWhatsAppTemplateMessage({
    recipientPhone: input.participantPhone,
    templateName: config.instantTestTemplate,
    parameters: paramNames.map((name, index) => ({
      name,
      value: values[index] ?? "—",
    })),
  });
}

/**
 * Sends `rapid_test_scheduled` when a Rapid Test is scheduled.
 */
export async function sendRapidTestScheduledWhatsAppNotification(input: {
  participantName: string;
  participantPhone: string;
  testCreatorName: string;
  testCreatorNumber: string;
  testGroup: string;
  testName: string;
}): Promise<WhatsAppSendResult> {
  const config = getWhatsAppConfig();
  if (!config.configured) {
    return { sent: false, reason: "unconfigured" };
  }

  const paramNames = parseConfiguredParamNames(
    process.env.WHATSAPP_RAPID_TEST_PARAM_NAMES,
    DEFAULT_RAPID_TEST_PARAM_NAMES,
  );

  const values = [
    input.participantName?.trim() || "Participant",
    input.testCreatorName?.trim() || "Test Creator",
    input.testCreatorNumber?.trim() || "—",
    input.testName?.trim() || "Rapid Test",
    input.testGroup?.trim() || "Group",
  ];

  return sendWhatsAppTemplateMessage({
    recipientPhone: input.participantPhone,
    templateName: config.rapidTestTemplate,
    parameters: paramNames.map((name, index) => ({
      name,
      value: values[index] ?? "—",
    })),
  });
}

/**
 * Sends `test_scheduled_on_trapit` for a Standard Test (20 minutes before scheduled start time).
 */
export async function sendStandardTestScheduledWhatsAppNotification(input: {
  participantName: string;
  participantPhone: string;
  startsAt: string;
  testCreatorName: string;
  testCreatorNumber: string;
  testGroup: string;
  testName: string;
}): Promise<WhatsAppSendResult> {
  const config = getWhatsAppConfig();
  if (!config.configured) {
    return { sent: false, reason: "unconfigured" };
  }

  const paramNames = parseConfiguredParamNames(
    process.env.WHATSAPP_SCHEDULED_TEST_PARAM_NAMES,
    DEFAULT_SCHEDULED_TEST_PARAM_NAMES,
  );

  const values = [
    input.participantName?.trim() || "Participant",
    input.testCreatorName?.trim() || "Test Creator",
    input.testCreatorNumber?.trim() || "—",
    formatShortDateTimeIst(input.startsAt),
    input.testName?.trim() || "Scheduled Test",
    input.testGroup?.trim() || "Group",
  ];

  return sendWhatsAppTemplateMessage({
    recipientPhone: input.participantPhone,
    templateName: config.scheduledTestTemplate,
    parameters: paramNames.map((name, index) => ({
      name,
      value: values[index] ?? "—",
    })),
  });
}
