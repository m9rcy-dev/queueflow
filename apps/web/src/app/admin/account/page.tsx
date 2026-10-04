"use client";

import { useStaffSession } from "../../../lib/use-staff-session";
import { staffApi } from "../../../lib/staff-api-client";
import { AppShell } from "../../../components/AppShell";
import { AuthenticatorSettings } from "../../../components/AuthenticatorSettings";

/** The signed-in staff member's own preferences (Phase 15) — per person, so it applies across every business they work for. */
export default function AccountPage() {
  const session = useStaffSession();

  if (!session) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-bg text-text-secondary">
        Loading…
      </main>
    );
  }

  return (
    <AppShell session={session} title={"Your account"}>
      <AuthenticatorSettings api={staffApi} />
    </AppShell>
  );
}
