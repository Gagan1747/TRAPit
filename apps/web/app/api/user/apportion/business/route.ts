import { NextResponse } from "next/server";

import {
  ApportionDirectoryError,
  getApportionPanel,
  updateApportionPanel,
  type ApportionPanelInput,
} from "../../../../../lib/apportion-directory";
import { getWorkspaceActor } from "../../../../../lib/workspace-actor";

function errorResponse(error: unknown) {
  return NextResponse.json(
    { error: error instanceof Error ? error.message : "Unable to update the Apportion business." },
    { status: error instanceof ApportionDirectoryError ? error.status : 400 },
  );
}

export async function GET(request: Request) {
  const actor = await getWorkspaceActor(request);
  if (!actor) return NextResponse.json({ error: "Signed-in access is required." }, { status: 403 });
  try {
    return NextResponse.json(await getApportionPanel(actor));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request) {
  const actor = await getWorkspaceActor(request);
  if (!actor) return NextResponse.json({ error: "Signed-in access is required." }, { status: 403 });
  try {
    const body = await request.json() as ApportionPanelInput;
    if (!body || typeof body !== "object" || Array.isArray(body) || typeof body.operation !== "string"
      || ("ownerIdentifier" in body && body.ownerIdentifier !== undefined && (typeof body.ownerIdentifier !== "string" || !body.ownerIdentifier.trim()))
      || (body.operation === "business-branding" && body.updateProviderSettings !== undefined && typeof body.updateProviderSettings !== "boolean")) {
      throw new ApportionDirectoryError("A valid Apportion operation is required.");
    }
    return NextResponse.json(await updateApportionPanel(actor, body));
  } catch (error) {
    return errorResponse(error);
  }
}

export const POST = PATCH;