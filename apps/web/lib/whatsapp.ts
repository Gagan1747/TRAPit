import "server-only";

import { formatShortDateTimeIst } from "./date-format";

const DEFAULT_GRAPH_API_VERSION = "v21.0";
const DEFAULT_COUNTRY_CODE = "91";
const DEFAULT_BOOKED_TEMPLATE = "appointment_booked_on_trapit";
const DEFAULT_INVITATION_TEMPLATE = "appointment_invitation_on_trapit";
const DEFAULT_TEMPLATE_LANGUAGE = "en";

const DEFAULT_BOOKED_PARAM_NAMES = [
  "owner_staff_name",
  "date_and_time",
  "requester_name",
  "requester_phone_number",
  "address",
] as const;

const DEFAULT_INVITATION_PARAM_NAMES = [
  "requester_name",
  "owner_staff_name",
  "date_and_time",
  "service_name",
  "location_name",
] as const;

export type WhatsAppSendResult = {
  sent: boolean;
  messageId?: string | null;
  reason?: string;
  error?: string;
};

type CachedTemplateMetadata = {
  fetchedAt: number;
  language: string;
  parameterFormat: "NAMED" | "POSITIONAL";
  bodyParamNames: string[];
};

const templateMetadataCache = new Map<string, CachedTemplateMetadata>();
const TEMPLATE_CACHE_TTL_MS = 10 * 60 * 1000;

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
  const paramFormatEnv = process.env.WHATSAPP_PARAM_FORMAT?.trim().toUpperCase();
  const parameterFormat: "NAMED" | "POSITIONAL" = paramFormatEnv === "POSITIONAL" ? "POSITIONAL" : "NAMED";

  return {
    accessToken,
    apiVersion,
    bookedTemplate,
    businessAccountId,
    configured: Boolean(phoneNumberId && accessToken),
    countryCode,
    invitationTemplate,
    parameterFormat,
    phoneNumberId,
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
  if (cached && Date.now() - cached.fetchedAt < TEMPLATE_CACHE_TTL_MS) {
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
        language?: string;
        parameter_format?: string;
        components?: Array<{ type?: string; text?: string }>;
      }>;
    };

    const match = payload.data?.find((entry) => entry.name === templateName) ?? payload.data?.[0];
    if (!match) {
      return null;
    }

    const bodyComponent = match.components?.find((comp) => comp.type?.toUpperCase() === "BODY");
    const bodyText = bodyComponent?.text ?? "";
    const variableMatches = Array.from(bodyText.matchAll(/\{\{\s*([^}]+?)\s*\}\}/g)).map((item) => item[1].trim());
    const isPositional = match.parameter_format?.toUpperCase() === "POSITIONAL"
      || (variableMatches.length > 0 && variableMatches.every((name) => /^\d+$/.test(name)));

    const metadata: CachedTemplateMetadata = {
      fetchedAt: Date.now(),
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
    const initialLanguage = input.languageCode?.trim() || discovered?.language || config.templateLanguage;
    const initialFormat = discovered?.parameterFormat || config.parameterFormat;
    const resolvedParameters = input.parameters.map((param, index) => ({
      name: discovered?.bodyParamNames[index] || param.name,
      value: param.value,
    }));

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

    // Fallback if template uses positional parameters ({{1}}, {{2}}) instead of named parameters — Error #132000 / #100
    if (!attempt.ok && initialFormat === "NAMED" && (attempt.errorCode === 132000 || attempt.errorCode === 100)) {
      attempt = await postWhatsAppTemplateMessage({
        config,
        languageCode: initialLanguage,
        parameterFormat: "POSITIONAL",
        parameters: resolvedParameters,
        templateName: input.templateName,
        to: normalizedPhone,
      });
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
 * Hello {{Owner/staff name}}, a new appointment has been scheduled for **{{date and time}}** on TRAPit.in.
 * Customer: {{requester name}} ({{requester phone number}})
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
    formatAppointmentDateTime(appointment.startsAt, appointment.justAddToList, appointment.bookedQueuePosition),
    appointment.requesterName?.trim() || "Customer",
    appointment.requesterPhone?.trim() || appointment.requesterIdentifier.trim(),
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
 * Hello {{Requester Name}}, {{Owner/staff name}} has invited you to an appointment scheduled for: **{{date and time}}** on TRAPit.in.
 * Purpose: {{Service name}}
 * Location: {{Location name}}
 * Please sign in to TRAPit.in to accept or decline this invitation before it expires.
 */
export async function sendAppointmentInvitationWhatsAppNotification(invitation: {
  assignedStaffName?: string | null;
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
