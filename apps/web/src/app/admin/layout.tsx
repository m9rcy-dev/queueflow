import type { Metadata } from "next";

// Phase 12 (accessibility pass): every page under /admin is a client
// component, and /admin itself does a client-side router.replace() on
// mount — that transition was found (via an axe-core scan) to drop the
// root layout's inherited <title>, failing WCAG's document-title check.
// An explicit metadata export at this layer keeps the title anchored
// through that navigation.
export const metadata: Metadata = {
  title: "QueueFlow — Staff",
};

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return children;
}
