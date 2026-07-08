import { getSessionDisplayName, getSessionIdentifier } from "@trapit/auth";
import { NextResponse } from "next/server";

import { createApportionAppointment, listApportionSlotCounts } from "../../../../lib/apportion-store";
import { getWebSession } from "../../../../lib/session";
import { getWorkspaceBrandingByAppointmentShareCode } from "../../../../lib/testing-store";

export async function GET(
  request: Request,
  { params }: { params: { shareCode: string } },
) {
  const session = await getWebSession(request);

  if (!session) {
    return NextResponse.json({ error: "Sign in to book an appointment." }, { status: 403 });
  }

  const business = await getWorkspaceBrandingByAppointmentShareCode(params.shareCode);

  if (!business) {
    return NextResponse.json({ error: "Business booking page not found." }, { status: 404 });
  }

  const slotCounts = await listApportionSlotCounts(business.ownerIdentifier);

  return NextResponse.json({
    business: {
      appointmentsPerSlot: business.branding.appointmentsPerSlot ?? 1,
      imageDataUrl: business.branding.imageDataUrl,
      name: business.branding.instituteName,
      workingDays: business.branding.workingDays,
      workingHours: business.branding.workingHours,
    },
    slotCounts,
  });
}

export async function POST(
  request: Request,
  { params }: { params: { shareCode: string } },
) {
  const session = await getWebSession(request);

  if (!session) {
    return NextResponse.json({ error: "Sign in to book an appointment." }, { status: 403 });
  }

  const requesterIdentifier = getSessionIdentifier(session) ?? session.phoneNumber ?? session.email ?? null;

  if (!requesterIdentifier) {
    return NextResponse.json({ error: "Your account needs a phone number before booking appointments." }, { status: 400 });
  }

  const business = await getWorkspaceBrandingByAppointmentShareCode(params.shareCode);

  if (!business) {
    return NextResponse.json({ error: "Business booking page not found." }, { status: 404 });
  }

  const body = (await request.json()) as { notes?: string | null; startsAt?: string };
  let appointment;

  try {
    appointment = await createApportionAppointment({
      appointmentsPerSlot: business.branding.appointmentsPerSlot ?? 1,
      notes: body.notes,
      ownerIdentifier: business.ownerIdentifier,
      requesterIdentifier,
      requesterName: getSessionDisplayName(session) ?? requesterIdentifier,
      requesterPhone: session.phoneNumber ?? requesterIdentifier,
      startsAt: body.startsAt ?? "",
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to book appointment." }, { status: 400 });
  }

  return NextResponse.json({ appointment });
}