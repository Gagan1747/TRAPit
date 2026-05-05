import { NextResponse } from "next/server";

import { getWorkspaceActor } from "../../../../../../lib/workspace-actor";
import { previewImport } from "../../../../../../lib/testing-store";

export async function POST(request: Request) {
  const actor = await getWorkspaceActor();

  if (!actor) {
    return NextResponse.json({ error: "Signed-in access is required." }, { status: 403 });
  }

  const body = (await request.json()) as { text?: string };

  if (!body.text?.trim()) {
    return NextResponse.json({ error: "Import text is required." }, { status: 400 });
  }

  const preview = await previewImport(body.text);
  return NextResponse.json(preview);
}