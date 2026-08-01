import type { Metadata } from "next";
import "./globals.css";

const siteTitle = "TRAPit.in";
const siteDescription = "Tests, Apportions, and Polls Simplified, Smart, and Precise";

export const metadata: Metadata = {
  title: siteTitle,
  description: siteDescription,
  icons: {
    icon: "/icon.svg",
  },
  openGraph: {
    title: siteTitle,
    description: siteDescription,
    siteName: "TRAPit",
    type: "website",
  },
  twitter: {
    title: siteTitle,
    description: siteDescription,
    card: "summary_large_image",
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