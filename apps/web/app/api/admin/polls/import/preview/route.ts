import { NextResponse } from "next/server";

import { previewPollImport } from "../../../../../../lib/testing-store";
import { getWorkspaceActor } from "../../../../../../lib/workspace-actor";

export async function POST(request: Request) {
  const actor = await getWorkspaceActor();

  if (!actor) {
    return NextResponse.json({ error: "Signed-in access is required." }, { status: 403 });
  }

  const body = (await request.json()) as { text?: string };

  if (!body.text?.trim()) {
    return NextResponse.json({ error: "Import text is required." }, { status: 400 });
  }

  const preview = await previewPollImport(body.text);
  return NextResponse.json(preview);
}