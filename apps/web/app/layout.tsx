import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "TRAPit",
  description: "Role-aware authentication starter for web and mobile.",
  icons: {
    icon: "/icon.svg",
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