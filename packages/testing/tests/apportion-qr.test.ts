import { readFile } from "node:fs/promises";
import path from "node:path";
import jsQR from "jsqr";
import { PNG } from "pngjs";
import QRCode from "qrcode";
import { describe, expect, it } from "vitest";

const logoPath = path.resolve(import.meta.dirname, "../../../apps/web/public/trapit-qr-mark.svg");

function fillRect(image: PNG, left: number, top: number, width: number, height: number, color: [number, number, number, number]) {
  for (let y = top; y < top + height; y += 1) {
    for (let x = left; x < left + width; x += 1) {
      const offset = (y * image.width + x) * 4;
      image.data.set(color, offset);
    }
  }
}

describe("Apportion booking QR", () => {
  it("decodes the H-level booking URL with the centered TRAPit logo footprint applied", async () => {
    const bookingUrl = "https://trapit.in/apportion/TRAPIT-APPT-TEST";
    const logo = await readFile(logoPath, "utf8");
    expect(logo).toContain('aria-label="TRAPit"');

    const image = PNG.sync.read(await QRCode.toBuffer(bookingUrl, {
      errorCorrectionLevel: "H",
      margin: 4,
      width: 320,
    }));
    fillRect(image, 128, 128, 64, 64, [255, 255, 255, 255]);
    fillRect(image, 144, 149, 33, 6, [23, 59, 79, 255]);
    fillRect(image, 156, 155, 8, 16, [23, 59, 79, 255]);
    fillRect(image, 168, 163, 8, 8, [78, 214, 178, 255]);

    const decoded = jsQR(new Uint8ClampedArray(image.data), image.width, image.height);
    expect(decoded?.data).toBe(bookingUrl);
  });
});