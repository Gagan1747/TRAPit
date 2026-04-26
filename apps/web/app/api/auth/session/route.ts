import { NextResponse } from "next/server";

import { getWebSession } from "../../../../lib/session";

export async function GET() {
  const session = await getWebSession();

  return NextResponse.json({ session });
}