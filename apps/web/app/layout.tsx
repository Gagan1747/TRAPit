import type { Metadata } from "next";
import "./globals.css";

const siteTitle = "TRAPit.in";
const siteDescription = "Tests, Apportions, and Polls Simplified, Smart, and Precise";

export const metadata: Metadata = {
  title: siteTitle,
  description: siteDescription,
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/trapit-logo.jpeg", type: "image/jpeg" },
      { url: "/icon.svg", type: "image/svg+xml" },
    ],
    shortcut: ["/trapit-logo.jpeg"],
    apple: [
      { url: "/trapit-logo.jpeg", type: "image/jpeg" },
    ],
  },
  openGraph: {
    title: siteTitle,
    description: siteDescription,
    siteName: "TRAPit",
    type: "website",
    images: ["/trapit-logo.jpeg"],
  },
  twitter: {
    title: siteTitle,
    description: siteDescription,
    card: "summary_large_image",
    images: ["/trapit-logo.jpeg"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}