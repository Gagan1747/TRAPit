import { type WorkspaceBranding } from "@trapit/testing";
import { NextResponse } from "next/server";

import { validateAppointmentBusinessProfile } from "../../../../lib/appointment-locations";
import { getWorkspaceBranding, updateWorkspaceBranding } from "../../../../lib/testing-store";
import { getWorkspaceActor } from "../../../../lib/workspace-actor";

const MAX_PROMOTIONAL_IMAGES = 4;
const MAX_PROMOTIONAL_IMAGE_DATA_URL_LENGTH = 2_800_000;

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

  const body = (await request.json()) as { branding?: WorkspaceBranding | null };

  try {
    if (body.branding) {
      validateAppointmentBusinessProfile(body.branding);
      validateAppointmentDateOverrides(body.branding);
      validatePromotionalImages(body.branding.promotionalImageDataUrls);
    }

    const branding = await updateWorkspaceBranding(body.branding ?? null, actor.identifier ?? actor.sub);
    return NextResponse.json({ branding });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to save business locations." }, { status: 400 });
  }
}