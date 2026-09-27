import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "QueueFlow",
  description: "One QR code. Many possibilities.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
