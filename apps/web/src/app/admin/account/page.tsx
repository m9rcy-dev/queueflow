"use client";

import { useStaffSession } from "../../../lib/use-staff-session";
import { staffApi } from "../../../lib/staff-api-client";
import { AdminNav } from "../../../components/AdminNav";
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
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 bg-bg p-6">
      <header className="pt-4">
        <h1 className="mb-4 text-xl font-semibold text-text-primary">Your account</h1>
        <AdminNav current="account" role={session.role} />
      </header>
      <AuthenticatorSettings api={staffApi} />
    </main>
  );
}
