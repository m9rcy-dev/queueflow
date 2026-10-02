"use client";

import Link from "next/link";

const LINKS = [
  { href: "/admin/queues", label: "Queues" },
  { href: "/admin/locations", label: "Locations" },
  { href: "/admin/staff", label: "Staff" },
  { href: "/admin/settings", label: "Settings" },
] as const;

/**
 * The thin link bar every /admin/* page (besides login) renders at the
 * top — not a Next.js layout, since each page already does its own
 * useStaffSession() auth-check timing (Phase 5) and a shared layout would
 * complicate that. `current` highlights which section the page belongs to.
 */
export function AdminNav({ current }: { current: "queues" | "locations" | "staff" | "settings" }) {
  return (
    <nav className="flex gap-4 border-b border-border pb-3 text-sm">
      {LINKS.map((link) => {
        const isCurrent = link.href === `/admin/${current}`;
        return (
          <Link
            key={link.href}
            href={link.href}
            className={
              isCurrent
                ? "font-medium text-text-primary"
                : "text-text-secondary hover:text-text-primary"
            }
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
