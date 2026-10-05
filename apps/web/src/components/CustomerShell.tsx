"use client";

import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { CustomerPortalSummary } from "@queueflow/types";
import { customerApi } from "../lib/customer-api-client";
import { Shell } from "./Shell";
import { AccountIcon, CalendarIcon, HomeIcon, LogoutIcon, QrIcon, TicketIcon } from "./icons";

/**
 * The customer area's shell (Phase 17) — the same layout as the business
 * area: Queues, Appointments, QR Codes, with Account and log-out under the
 * customer's name at the bottom.
 */
export function CustomerShell({
  summary,
  title,
  children,
}: {
  summary: CustomerPortalSummary;
  title: string;
  children: ReactNode;
}) {
  const router = useRouter();
  const name = summary.customer.firstName ?? "Customer";
  return (
    <Shell
      brand={summary.tenant.name}
      brandLogoPath={summary.tenant.logoPath}
      // Phase 19: Home first (code, live ticket, join/book), and a bottom tab
      // bar on phones — customers use this on their phone, where a menu
      // hidden behind ☰ is easy to miss.
      navItems={[
        { href: "/c/portal", label: "Home", Icon: HomeIcon },
        { href: "/c/portal/visits", label: "Visits", Icon: TicketIcon },
        { href: "/c/portal/appointments", label: "Bookings", Icon: CalendarIcon },
        { href: "/c/portal/codes", label: "QR Codes", Icon: QrIcon },
        { href: "/c/portal/account", label: "Account", Icon: AccountIcon },
      ]}
      mobileTabBar
      profileName={name}
      profileDetail={summary.customer.email ?? summary.customer.phoneE164}
      profileMenu={[
        { label: "Account", Icon: AccountIcon, href: "/c/portal/account" },
        {
          label: "Log out",
          Icon: LogoutIcon,
          onSelect: async () => {
            await customerApi.logout();
            router.push("/");
          },
        },
      ]}
      title={title}
    >
      {children}
    </Shell>
  );
}
