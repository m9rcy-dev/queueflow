import type { Metadata } from "next";

// Phase 12 (accessibility pass): see admin/layout.tsx — same fix, same
// axe-core finding (missing <title> after hydration) on this segment.
export const metadata: Metadata = {
  title: "QueueFlow — Display",
};

export default function DisplayLayout({ children }: { children: React.ReactNode }) {
  return children;
}
