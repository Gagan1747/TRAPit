import { NextResponse } from "next/server";

import { getAdminActor } from "../../../../../../lib/admin-api";
import { previewImport } from "../../../../../../lib/testing-store";

export async function POST(request: Request) {
  const actor = await getAdminActor();

  if (!actor) {
    return NextResponse.json({ error: "Admin access is required." }, { status: 403 });
  }

  const body = (await request.json()) as { text?: string };

  if (!body.text?.trim()) {
    return NextResponse.json({ error: "Import text is required." }, { status: 400 });
  }

  const preview = await previewImport(body.text);
  return NextResponse.json(preview);
}