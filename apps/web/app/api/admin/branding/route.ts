import { type WorkspaceBranding } from "@trapit/testing";
import { NextResponse } from "next/server";

import { ApportionDirectoryError, prepareApportionBrandingMutation } from "../../../../lib/apportion-directory";
import { validateAppointmentBusinessProfile } from "../../../../lib/appointment-locations";
import { getWorkspaceBranding, mutateWorkspaceBrandingState, withSerializedTestingMutation } from "../../../../lib/testing-store";
import { getWorkspaceActor } from "../../../../lib/workspace-actor";

const MAX_PROMOTIONAL_IMAGES = 4;
const MAX_PROMOTIONAL_IMAGE_DATA_URL_LENGTH = 2_800_000;

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function assertBrandingPayload(value: unknown): asserts value is WorkspaceBranding | null {
  if (value === null) return;
  if (!isObject(value) || typeof value.instituteName !== "string"
    || !Array.isArray(value.appointmentLocations)
    || value.appointmentLocations.some((location) => !isObject(location)
      || ["id", "name", "address", "workingDays", "workingHours", "workingHoursSecondWindow"].some((key) => typeof location[key] !== "string"))) {
    throw new Error("A valid business name and location payload are required.");
  }
  const stringFields = ["address", "breakHours", "workingDays", "workingHours", "workingHoursSecondWindow", "appointmentNotesPrompt"];
  const nullableStrings = ["appointmentShareCode", "imageDataUrl", "profileImageDataUrl"];
  const numbers = ["appointmentsPerSlot", "slotDurationMinutes", "advanceBookingWeeks", "recurringBookingLimit"];
  const booleans = ["justAddToList", "showRemainingBookings", "recurringBookingsEnabled"];
  if (stringFields.some((key) => value[key] !== undefined && typeof value[key] !== "string")
    || nullableStrings.some((key) => value[key] !== undefined && value[key] !== null && typeof value[key] !== "string")
    || numbers.some((key) => value[key] !== undefined && value[key] !== null && (typeof value[key] !== "number" || !Number.isFinite(value[key])))
    || booleans.some((key) => value[key] !== undefined && typeof value[key] !== "boolean")
    || (value.promotionalImageDataUrls !== undefined && (!Array.isArray(value.promotionalImageDataUrls) || value.promotionalImageDataUrls.some((image) => typeof image !== "string")))) {
    throw new Error("Business fields have invalid types.");
  }
  if (value.appointmentDateOverrides !== undefined && (!isObject(value.appointmentDateOverrides)
    || ["closedDateKeys", "openedDateKeys"].some((key) => !Array.isArray(value.appointmentDateOverrides && (value.appointmentDateOverrides as Record<string, unknown>)[key])
      || ((value.appointmentDateOverrides as Record<string, unknown>)[key] as unknown[]).some((date) => typeof date !== "string")))) {
    throw new Error("Valid appointment date lists are required.");
  }
  for (const key of ["appointmentDateHoursOverrides", "appointmentWeeklyHoursOverrides"]) {
    const overrides = value[key];
    if (overrides === undefined) continue;
    if (!Array.isArray(overrides) || overrides.some((entry) => !isObject(entry)
      || (key === "appointmentDateHoursOverrides" ? typeof entry.dateKey !== "string" : !Number.isInteger(entry.weekday) || Number(entry.weekday) < 0 || Number(entry.weekday) > 6)
      || !Array.isArray(entry.locations) || entry.locations.some((location) => !isObject(location)
        || ["locationId", "workingHours", "workingHoursSecondWindow"].some((field) => typeof location[field] !== "string")))) {
      throw new Error("Valid appointment hours overrides are required.");
    }
  }
}

function validatePromotionalImages(values: string[] | undefined) {
  const images = values ?? [];

  if (images.length > MAX_PROMOTIONAL_IMAGES) {
    throw new Error("Upload no more than 4 promotional images.");
  }

  if (images.some((value) => !value.startsWith("data:image/") || value.length > MAX_PROMOTIONAL_IMAGE_DATA_URL_LENGTH)) {
    throw new Error("Each promotional image must be a valid image up to 2 MB.");
  }
}

function validateAppointmentDateOverrides(branding: WorkspaceBranding) {
  const values = [
    ...(branding.appointmentDateOverrides?.closedDateKeys ?? []),
    ...(branding.appointmentDateOverrides?.openedDateKeys ?? []),
    ...(branding.appointmentDateHoursOverrides ?? []).map((entry) => entry.dateKey),
  ];
  const today = new Date();
  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const maxDate = new Date(today.getFullYear(), today.getMonth() + 6, today.getDate());
  const maxDateKey = `${maxDate.getFullYear()}-${String(maxDate.getMonth() + 1).padStart(2, "0")}-${String(maxDate.getDate()).padStart(2, "0")}`;

  for (const value of values) {
    const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    const date = match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : null;
    const isValid = Boolean(match && date
      && date.getFullYear() === Number(match[1])
      && date.getMonth() === Number(match[2]) - 1
      && date.getDate() === Number(match[3]));

    if (!isValid || value < todayKey || value > maxDateKey) {
      throw new Error("Appointment calendar dates must be valid dates within the next 6 months.");
    }
  }
}

export async function GET() {
  const actor = await getWorkspaceActor();

  if (!actor) {
    return NextResponse.json({ error: "Signed-in access is required." }, { status: 403 });
  }

  const branding = await getWorkspaceBranding(actor.identifier ?? actor.sub);
  return NextResponse.json({ branding });
}

export async function POST(request: Request) {
  const actor = await getWorkspaceActor();

  if (!actor) {
    return NextResponse.json({ error: "Signed-in access is required." }, { status: 403 });
  }

  try {
    const body: unknown = await request.json();
    if (!isObject(body) || !("branding" in body) || (body.updateProviderSettings !== undefined && typeof body.updateProviderSettings !== "boolean")) {
      throw new Error("A branding payload and valid settings update flag are required.");
    }
    assertBrandingPayload(body.branding);
    if (body.branding) {
      validateAppointmentBusinessProfile(body.branding);
      validateAppointmentDateOverrides(body.branding);
      validatePromotionalImages(body.branding.promotionalImageDataUrls);
    }

    const input = body.branding;
    const branding = await withSerializedTestingMutation(async (state) => {
      const prepared = await prepareApportionBrandingMutation(state, input, actor.identifier ?? actor.sub, body.updateProviderSettings === true, actor);
      return mutateWorkspaceBrandingState(state, prepared, actor.identifier ?? actor.sub);
    });
    return NextResponse.json({ branding });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to save business locations." }, { status: error instanceof ApportionDirectoryError ? error.status : 400 });
  }
}