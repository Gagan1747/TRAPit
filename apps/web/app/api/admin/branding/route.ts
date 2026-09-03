import { type WorkspaceBranding } from "@trapit/testing";
import { NextResponse } from "next/server";

import { validateAppointmentLocations } from "../../../../lib/appointment-locations";
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
      validateAppointmentLocations(body.branding.appointmentLocations);
      validatePromotionalImages(body.branding.promotionalImageDataUrls);
    }

    const branding = await updateWorkspaceBranding(body.branding ?? null, actor.identifier ?? actor.sub);
    return NextResponse.json({ branding });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to save business locations." }, { status: 400 });
  }
}