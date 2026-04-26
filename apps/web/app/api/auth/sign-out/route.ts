import { NextResponse } from "next/server";

import { destroyWebSession } from "../../../../lib/session";

export async function POST() {
  await destroyWebSession();
  return NextResponse.json({ signedOut: true });
}