import { NextResponse } from "next/server";

import { getCognitoErrorMessage, requestPasswordReset } from "../../../../lib/cognito";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      phoneNumber?: string;
    };
    const phoneNumber = body.phoneNumber?.trim();

    if (!phoneNumber) {
      return NextResponse.json(
        { error: "Phone number is required." },
        { status: 400 },
      );
    }

    const result = await requestPasswordReset(phoneNumber);

    return NextResponse.json({
      deliveryDestination: result.CodeDeliveryDetails?.Destination ?? null,
    });
  } catch (error) {
    return NextResponse.json(
      { error: getCognitoErrorMessage(error) },
      { status: 400 },
    );
  }
}