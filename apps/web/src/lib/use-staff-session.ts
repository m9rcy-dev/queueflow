"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { StaffSession } from "@queueflow/api-client";
import { staffApi } from "./staff-api-client";

/**
 * The staff-page auth guard, shared by every /admin/* page. `getMe()` alone
 * won't auto-refresh (the retry-on-401 logic in StaffApiClient deliberately
 * excludes /auth/* paths, to avoid the refresh endpoint retrying itself) —
 * it only succeeds directly when this page was reached by client-side
 * navigation right after login, so the in-memory access token is still
 * live. A fresh page load has no in-memory token, so it falls through to
 * restoreSession(), which explicitly exchanges the stored refresh token.
 * Redirects to /admin/login if neither works.
 */
export function useStaffSession(): StaffSession | null {
  const router = useRouter();
  const [session, setSession] = useState<StaffSession | null>(null);

  useEffect(() => {
    (async () => {
      const existing = await staffApi.getMe().catch(() => null);
      if (existing) {
        setSession(existing);
        return;
      }
      const restored = await staffApi.restoreSession().catch(() => null);
      if (restored) {
        setSession(restored);
        return;
      }
      router.push("/admin/login");
    })();
    // `router` from useRouter() is a stable reference across re-renders in
    // the App Router — safe to run this effect once per mount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return session;
}
