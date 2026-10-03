import type { Metadata, Viewport } from "next";
import "./globals.css";
import { RegisterServiceWorker } from "../components/RegisterServiceWorker";

// Phase 12, G-41/G-08: the nonce-based strict CSP in middleware.ts only gets
// applied to a page's scripts/styles when that page is dynamically rendered
// — Next.js has no request to read a nonce from at build time, so a
// statically-prerendered page ships with no nonce at all and every script
// on it gets blocked. Forcing the whole app dynamic is what makes the CSP
// actually work rather than just look right in the header.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "QueueFlow",
  description: "One QR code. Many possibilities.",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "QueueFlow",
  },
  icons: {
    icon: ["/icon-192.png", "/icon-512.png"],
    apple: "/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#5267E8",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <RegisterServiceWorker />
        {children}
      </body>
    </html>
  );
}
