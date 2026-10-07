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
const SIGN_IN_CODE_KEY = "queueflow.customerSignInCode";

/** Phase 20: remember which business's sign-up/sign-in page this customer used (its GENERAL code). */
export function rememberCustomerSignInCode(code: string): void {
  try {
    localStorage.setItem(SIGN_IN_CODE_KEY, code);
  } catch {
    // storage blocked — they'll land on the home page instead
  }
}

/** Where a signed-out customer should go: their business's sign-in page, if this browser knows it. */
export function signInPath(): string {
  try {
    const code = localStorage.getItem(SIGN_IN_CODE_KEY);
    return code ? `/c/${encodeURIComponent(code)}` : "/";
  } catch {
    return "/";
  }
}

export function useCustomerSession(): [
  CustomerPortalSummary | null,
  (update: (prev: CustomerPortalSummary) => CustomerPortalSummary) => void,
] {
  const router = useRouter();
  const [summary, setSummary] = useState<CustomerPortalSummary | null>(null);

  useEffect(() => {
    // Ignore a result that arrives after this effect was cleaned up (React
    // runs effects twice in development).
    let cancelled = false;
    customerApi
      .restoreSession()
      .catch(() => null)
      .then((restored) => {
        if (cancelled) return;
        if (restored) setSummary(restored);
        // Signed out: back to their business's sign-in page, not a dead end.
        else router.replace(signInPath());
      });
    return () => {
      cancelled = true;
    };
    // `router` is stable in the App Router — run once per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return [summary, (update) => setSummary((prev) => (prev ? update(prev) : prev))];
}
