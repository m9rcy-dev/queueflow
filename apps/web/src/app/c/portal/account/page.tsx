"use client";

import { Card } from "@queueflow/ui";
import { customerApi } from "../../../../lib/customer-api-client";
import { useCustomerSession } from "../../../../lib/use-customer-session";
import { CustomerShell } from "../../../../components/CustomerShell";
import { AuthenticatorSettings } from "../../../../components/AuthenticatorSettings";

/** Account (Phase 17): the customer's details and how they get login codes. */
export default function CustomerAccountPage() {
  const [summary] = useCustomerSession();
  if (!summary) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-bg text-text-secondary">
        Loading…
      </main>
    );
  }
  return (
    <CustomerShell summary={summary} title="Account">
      <Card className="flex flex-col gap-1">
        <p className="font-medium text-text-primary">{summary.customer.firstName ?? "Customer"}</p>
        {summary.customer.email && (
          <p className="text-sm text-text-secondary">{summary.customer.email}</p>
        )}
        <p className="text-sm text-text-secondary">{summary.customer.phoneE164}</p>
      </Card>
      <AuthenticatorSettings api={customerApi} />
    </CustomerShell>
  );
}
