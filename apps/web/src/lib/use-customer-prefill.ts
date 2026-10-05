"use client";

import { useEffect, useState } from "react";
import { customerApi } from "./customer-api-client";

export interface CustomerPrefill {
  name: string;
  phone: string;
  email: string;
}

/**
 * Phase 19: a signed-in customer of *this* business (same tenant as the
 * poster) gets their details filled in on the join and booking forms. Anyone
 * else — not signed in, or signed in at another business — gets null and a
 * blank form; no network call is made without a stored session.
 */
export function useCustomerPrefill(tenantId: string | undefined): CustomerPrefill | null {
  const [prefill, setPrefill] = useState<CustomerPrefill | null>(null);
  useEffect(() => {
    if (!tenantId) return;
    let cancelled = false;
    customerApi
      .restoreSession()
      .catch(() => null)
      .then((summary) => {
        if (cancelled || !summary || summary.tenant.id !== tenantId) return;
        setPrefill({
          name: summary.customer.firstName ?? "",
          phone: summary.customer.phoneE164,
          email: summary.customer.email ?? "",
        });
      });
    return () => {
      cancelled = true;
    };
  }, [tenantId]);
  return prefill;
}
