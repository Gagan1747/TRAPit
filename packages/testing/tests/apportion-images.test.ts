import { describe, expect, it, vi } from "vitest";
import { normalizeWorkspaceBranding } from "../src/quiz";
import { getBookingImageResponse, getBookingImageUrls } from "../../../apps/web/lib/apportion-images";

vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({
  NextResponse: {
    json: (body: unknown, init?: ResponseInit) => new Response(JSON.stringify(body), {
      ...init, headers: { "Content-Type": "application/json" },
    }),
  },
}));

function branding(image = "data:image/png;base64,aGVsbG8=") {
  return normalizeWorkspaceBranding({ instituteName: "Clinic", promotionalImageDataUrls: [image] })!;
}

function request(url: string, headers?: HeadersInit) {
  return new Request(`https://trapit.in${url}`, { headers });
}

describe("versioned booking images", () => {
  it("serves cacheable binary images and supports conditional requests", async () => {
    const profile = branding();
    const url = getBookingImageUrls(profile, "BOOKING").promotionalImageDataUrls[0];
    const response = getBookingImageResponse(request(url), profile);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("hello");
    expect(response.headers.get("cache-control")).toBe("private, max-age=31536000, immutable");
    expect(response.headers.get("vary")).toBe("Cookie");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    const etag = response.headers.get("etag")!;
    const unchanged = getBookingImageResponse(request(url, { "If-None-Match": etag }), profile);
    expect(unchanged.status).toBe(304);
    expect(await unchanged.text()).toBe("");
  });

  it("changes the URL on image replacement and refuses stale versions", async () => {
    const oldProfile = branding();
    const newProfile = branding("data:image/png;base64,bmV3");
    const oldUrl = getBookingImageUrls(oldProfile, "BOOKING").promotionalImageDataUrls[0];
    const newUrl = getBookingImageUrls(newProfile, "BOOKING").promotionalImageDataUrls[0];
    expect(oldUrl).not.toBe(newUrl);
    expect(getBookingImageResponse(request(oldUrl), newProfile).status).toBe(404);
    expect(getBookingImageResponse(request(newUrl), newProfile).status).toBe(200);
  });

  it("preserves absent images and encodes the booking scope", () => {
    const images = getBookingImageUrls(branding(), "CODE WITH SPACE");
    expect(images.imageDataUrl).toBeNull();
    expect(images.profileImageDataUrl).toBeNull();
    expect(images.promotionalImageDataUrls[0]).toContain("/CODE%20WITH%20SPACE?");
  });

  it("rejects invalid selectors, indices, versions and saved image encodings", () => {
    const profile = branding();
    expect(getBookingImageResponse(request("/api/apportion/CODE?image=unknown"), profile).status).toBe(400);
    expect(getBookingImageResponse(request("/api/apportion/CODE?image=promotion&index=4"), profile).status).toBe(400);
    expect(getBookingImageResponse(request("/api/apportion/CODE?image=promotion"), profile).status).toBe(404);
    for (const value of ["data:text/html;base64,aGVsbG8=", "data:image/png;base64,invalid!", "data:image/svg+xml,%XX"]) {
      const invalid = branding(value);
      const url = getBookingImageUrls(invalid, "CODE").promotionalImageDataUrls[0];
      expect(getBookingImageResponse(request(url), invalid).status).toBe(422);
    }
  });

  it("preserves encoded SVG images with sandboxed responses", async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"></svg>';
    const profile = branding(`data:image/svg+xml,${encodeURIComponent(svg)}`);
    const url = getBookingImageUrls(profile, "CODE").promotionalImageDataUrls[0];
    const response = getBookingImageResponse(request(url), profile);
    expect(response.headers.get("content-type")).toBe("image/svg+xml");
    expect(response.headers.get("content-security-policy")).toContain("sandbox");
    expect(await response.text()).toBe(svg);
  });
});
