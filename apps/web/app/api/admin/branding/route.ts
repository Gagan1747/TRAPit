import { type WorkspaceBranding } from "@trapit/testing";
import { NextResponse } from "next/server";

import { getWorkspaceBranding, updateWorkspaceBranding } from "../../../../lib/testing-store";
import { getWorkspaceActor } from "../../../../lib/workspace-actor";

export async function GET() {
  const actor = await getWorkspaceActor();

  if (!actor) {
    return NextResponse.json({ error: "Signed-in access is required." }, { status: 403 });
  }

  const branding = await getWorkspaceBranding();
  return NextResponse.json({ branding });
}

export async function POST(request: Request) {
  const actor = await getWorkspaceActor();

  if (!actor) {
    return NextResponse.json({ error: "Signed-in access is required." }, { status: 403 });
  }

  const body = (await request.json()) as { branding?: WorkspaceBranding | null };
  const branding = await updateWorkspaceBranding(body.branding ?? null);
  return NextResponse.json({ branding });
}