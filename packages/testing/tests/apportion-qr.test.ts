import { readFile } from "node:fs/promises";
import path from "node:path";
import jsQR from "jsqr";
import { PNG } from "pngjs";
import { createBusinessBookingQrCode } from "../../../apps/web/lib/business-booking-qr";
import { describe, expect, it } from "vitest";

describe("Apportion booking QR", () => {
  it("decodes the unchanged booking URL without a centre logo or cutout", async () => {
    const bookingUrl = "https://trapit.in/apportion/TRAPIT-APPT-TEST";
    const source = await readFile(path.resolve(import.meta.dirname, "../../../apps/web/components/admin-question-workspace.tsx"), "utf8");
    expect(source).not.toContain('brandImage.src = "/trapit-qr-mark.svg"');
    expect(source).not.toContain("context.fillRect((320 - backingSize)");
    expect(source).toContain("createBusinessBookingQrCode(getApportionAccessUrl(shareCode))");

    const dataUrl = await createBusinessBookingQrCode(bookingUrl);
    const image = PNG.sync.read(Buffer.from(dataUrl.split(",")[1], "base64"));
    expect(image.width).toBe(320);
    expect(image.height).toBe(320);
    const decoded = jsQR(new Uint8ClampedArray(image.data), image.width, image.height);
    expect(decoded?.data).toBe(bookingUrl);
  });
});