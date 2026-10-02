import type { Metadata, Viewport } from "next";
import "./globals.css";
import { RegisterServiceWorker } from "../components/RegisterServiceWorker";

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
