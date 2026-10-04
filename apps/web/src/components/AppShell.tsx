"use client";

import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { StaffSession } from "@queueflow/api-client";
import type { TenantRole } from "@queueflow/types";
import { staffApi } from "../lib/staff-api-client";
import { isBusinessAdmin } from "../lib/roles";
import { Shell, type ShellNavItem } from "./Shell";
import {
  AccountIcon,
  CalendarIcon,
  KeyIcon,
  LocationIcon,
  LogoutIcon,
  QrIcon,
  QueueIcon,
  SettingsIcon,
  StaffIcon,
} from "./icons";

const ROLE_LABELS: Record<TenantRole, string> = {
  TENANT_OWNER: "Owner",
  TENANT_ADMIN: "Admin",
  MANAGER: "Manager",
  STAFF: "Staff",
};

/**
 * The business menu, by role (Phase 17, ADR-016) — it only offers what the
 * API would allow; the API is the real enforcement.
 * - Owner/Admin: everything.
 * - Manager: runs their own location — the same items, scoped to it, with
 *   "Location" going straight to their location.
 * - Staff: operate only.
 */
export function navItemsFor(session: StaffSession): ShellNavItem[] {
  const items: ShellNavItem[] = [
    { href: "/admin/queues", label: "Queues", Icon: QueueIcon, matchPrefix: true },
  ];
  if (session.appointmentEnabled) {
    items.push({ href: "/admin/appointments", label: "Appointments", Icon: CalendarIcon });
  }
  if (isBusinessAdmin(session.role)) {
    items.push(
      { href: "/admin/codes", label: "QR Codes", Icon: QrIcon },
      { href: "/admin/locations", label: "Locations", Icon: LocationIcon, matchPrefix: true },
      { href: "/admin/staff", label: "Staff", Icon: StaffIcon },
      { href: "/admin/settings", label: "Settings", Icon: SettingsIcon },
    );
  } else if (session.role === "MANAGER") {
    items.push({ href: "/admin/codes", label: "QR Codes", Icon: QrIcon });
    if (session.locationId) {
      items.push({
        href: `/admin/locations/${session.locationId}`,
        label: "Location",
        Icon: LocationIcon,
      });
    }
    items.push({ href: "/admin/staff", label: "Staff", Icon: StaffIcon });
  }
  return items;
}

/** The business area's shell: menu by role, the signed-in person at the bottom with Account / PIN / log out. */
export function AppShell({
  session,
  title,
  actions,
  children,
}: {
  session: StaffSession;
  title: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const router = useRouter();
  const detail = [ROLE_LABELS[session.role], session.locationName].filter(Boolean).join(" · ");
  return (
    <Shell
      brand={session.tenantName}
      navItems={navItemsFor(session)}
      profileName={session.displayName}
      profileDetail={detail}
      profileMenu={[
        { label: "Account", Icon: AccountIcon, href: "/admin/account" },
        { label: "Set up PIN", Icon: KeyIcon, href: "/admin/pin-setup" },
        {
          label: "Log out",
          Icon: LogoutIcon,
          onSelect: async () => {
            await staffApi.logout();
            router.push("/admin/login");
          },
        },
      ]}
      title={title}
      actions={actions}
    >
      {children}
    </Shell>
  );
}
