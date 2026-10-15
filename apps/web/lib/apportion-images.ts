import "server-only";

import { createHash } from "node:crypto";
import type { WorkspaceBranding } from "@trapit/testing";
import { NextResponse } from "next/server";

export function getBrandingImages(branding: WorkspaceBranding) {
  return {
    imageDataUrl: branding.imageDataUrl ?? null,
    profileImageDataUrl: branding.profileImageDataUrl ?? null,
    promotionalImageDataUrls: branding.promotionalImageDataUrls ?? [],
  };
}

function imageVersion(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function getBookingImageUrls(branding: WorkspaceBranding, shareCode: string) {
  const images = getBrandingImages(branding);
  const imageUrl = (value: string, kind: string, index?: number) => {
    const query = new URLSearchParams({ image: kind, v: imageVersion(value) });
    if (index !== undefined) query.set("index", String(index));
    return `/api/apportion/${encodeURIComponent(shareCode)}?${query}`;
  };

  return {
    imageDataUrl: images.imageDataUrl ? imageUrl(images.imageDataUrl, "logo") : null,
    profileImageDataUrl: images.profileImageDataUrl ? imageUrl(images.profileImageDataUrl, "profile") : null,
    promotionalImageDataUrls: images.promotionalImageDataUrls.map((value, index) =>
      imageUrl(value, "promotion", index),
    ),
  };
}

export function getBookingImageResponse(request: Request, branding: WorkspaceBranding) {
  const query = new URL(request.url).searchParams;
  const kind = query.get("image");
  const index = query.get("index") ?? "0";
  if (!["logo", "profile", "promotion"].includes(kind ?? "")
    || (kind === "promotion" && !/^[0-3]$/.test(index))) {
    return NextResponse.json({ error: "A valid booking image is required." }, { status: 400 });
  }

  const images = getBrandingImages(branding);
  const value = kind === "logo" ? images.imageDataUrl
    : kind === "profile" ? images.profileImageDataUrl
    : images.promotionalImageDataUrls[Number(index)];
  if (!value || query.get("v") !== imageVersion(value)) {
    return NextResponse.json({ error: "Booking image not found. Reload the booking page." }, { status: 404 });
  }

  const match = /^data:(image\/(?:png|jpe?g|gif|webp|avif|bmp|x-icon|svg\+xml))(?:;charset=[a-z0-9-]+)?(;base64)?,([\s\S]*)$/i.exec(value);
  if (!match || (match[2] && !/^(?:[a-z0-9+/]{4})*(?:[a-z0-9+/]{2}==|[a-z0-9+/]{3}=)?$/i.test(match[3]))) {
    return NextResponse.json({ error: "The saved booking image has an invalid format." }, { status: 422 });
  }

  let body: Uint8Array<ArrayBuffer>;
  try {
    body = new Uint8Array(match[2]
      ? Buffer.from(match[3], "base64")
      : Buffer.from(decodeURIComponent(match[3]), "utf8"));
  } catch (error) {
    if (!(error instanceof URIError)) throw error;
    return NextResponse.json({ error: "The saved booking image has invalid encoding." }, { status: 422 });
  }

  const etag = `"${imageVersion(value)}"`;
  const headers = {
    "Cache-Control": "private, max-age=31536000, immutable",
    "Content-Type": match[1].toLowerCase(),
    "Content-Security-Policy": "sandbox; default-src 'none'; style-src 'unsafe-inline'",
    "X-Content-Type-Options": "nosniff",
    ETag: etag,
    Vary: "Cookie",
  };
  if (request.headers.get("if-none-match") === etag) {
    return new Response(null, { status: 304, headers });
  }
  return new Response(body, { headers });
}
