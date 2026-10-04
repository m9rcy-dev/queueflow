"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { CustomerPortalSummary } from "@queueflow/types";
import { customerApi } from "./customer-api-client";

/**
 * The customer area's sign-in guard (Phase 17) — the customer counterpart of
 * useStaffSession: exchanges the stored refresh token for a session and the
 * portal summary, or sends them to the home page (a customer signs in from
 * their business's sign-up poster, which knows which business they mean).
 */
export function useCustomerSession(): [
  CustomerPortalSummary | null,
  (update: (prev: CustomerPortalSummary) => CustomerPortalSummary) => void,
] {
  const router = useRouter();
  const [summary, setSummary] = useState<CustomerPortalSummary | null>(null);

  useEffect(() => {
    customerApi
      .restoreSession()
      .catch(() => null)
      .then((restored) => {
        if (restored) setSummary(restored);
        else router.push("/");
      });
    // `router` is stable in the App Router — run once per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return [summary, (update) => setSummary((prev) => (prev ? update(prev) : prev))];
}
