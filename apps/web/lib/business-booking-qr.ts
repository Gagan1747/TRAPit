import QRCode from "qrcode";

export function createBusinessBookingQrCode(bookingUrl: string) {
  return QRCode.toDataURL(bookingUrl, { errorCorrectionLevel: "H", margin: 4, width: 320 });
}
