"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Badge, Button, Card, Input } from "@queueflow/ui";
import { ApiError } from "@queueflow/api-client";
import type { InviteSummary, TenantMemberSummary, TenantRole } from "@queueflow/types";
import { staffApi } from "../../../lib/staff-api-client";
import { useStaffSession } from "../../../lib/use-staff-session";
import { AdminNav } from "../../../components/AdminNav";

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback;
}

type InvitableRole = "TENANT_ADMIN" | "MANAGER" | "STAFF";
const INVITABLE_ROLES: InvitableRole[] = ["TENANT_ADMIN", "MANAGER", "STAFF"];

/** Invite/revoke + the current roster (Phase 11) — role changes and removing an existing member aren't built (not a resolved requirement, see PROJECT_STATUS.md Known Issues). */
export default function StaffPage() {
  const session = useStaffSession();
  const [members, setMembers] = useState<TenantMemberSummary[] | null>(null);
  const [invites, setInvites] = useState<InviteSummary[] | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  async function refresh(): Promise<void> {
    const [m, i] = await Promise.all([staffApi.listStaff(), staffApi.listInvites()]);
    setMembers(m);
    setInvites(i);
  }

  useEffect(() => {
    if (!session) return;
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  if (!session || !members || !invites) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-bg text-text-secondary">
        Loading…
      </main>
    );
  }

  const pendingInvites = invites.filter((i) => !i.acceptedAt && !i.revokedAt);

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 bg-bg p-6">
      <header className="pt-4">
        <h1 className="mb-4 text-xl font-semibold text-text-primary">Staff</h1>
        <AdminNav current="staff" />
      </header>

      <Card className="flex flex-col gap-3">
        <h2 className="text-sm font-medium uppercase tracking-wide text-text-secondary">
          Current staff
        </h2>
        {members.map((member) => (
          <div
            key={member.tenantUserId}
            className="flex items-center justify-between rounded-md border border-border px-4 py-3"
          >
            <div>
              <p className="font-medium text-text-primary">{member.displayName}</p>
              <p className="text-sm text-text-secondary">{member.email}</p>
            </div>
            <Badge tone="info">{member.role}</Badge>
          </div>
        ))}
      </Card>

      <Card className="flex flex-col gap-4">
        <h2 className="text-sm font-medium uppercase tracking-wide text-text-secondary">
          Invite staff
        </h2>
        <InviteForm onInvited={refresh} />
      </Card>

      {pendingInvites.length > 0 && (
        <Card className="flex flex-col gap-3">
          <h2 className="text-sm font-medium uppercase tracking-wide text-text-secondary">
            Pending invites
          </h2>
          {pendingInvites.map((invite) => (
            <div
              key={invite.id}
              className="flex items-center justify-between rounded-md border border-border px-4 py-3"
            >
              <div>
                <p className="font-medium text-text-primary">{invite.email}</p>
                <p className="text-sm text-text-secondary">
                  {invite.role} · expires {new Date(invite.expiresAt).toLocaleDateString()}
                </p>
              </div>
              <Button
                variant="destructive"
                disabled={revokingId === invite.id}
                onClick={async () => {
                  setRevokingId(invite.id);
                  try {
                    await staffApi.revokeInvite(invite.id);
                    await refresh();
                  } finally {
                    setRevokingId(null);
                  }
                }}
              >
                Revoke
              </Button>
            </div>
          ))}
        </Card>
      )}
    </main>
  );
}

function InviteForm({ onInvited }: { onInvited: () => Promise<void> }) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<InvitableRole>("STAFF");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setSuccess(false);
    try {
      await staffApi.createInvite({ email, role });
      setEmail("");
      setSuccess(true);
      await onInvited();
    } catch (err) {
      setError(errorMessage(err, "Something went wrong."));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <Input
        label="Email"
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        required
      />
      <label className="flex flex-col gap-1.5 text-sm font-medium text-text-primary">
        Role
        <select
          value={role}
          onChange={(e) => setRole(e.target.value as InvitableRole)}
          className="min-h-[48px] rounded-md border border-border bg-surface px-4 py-3 text-base text-text-primary"
        >
          {INVITABLE_ROLES.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </label>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {success && <p className="text-sm text-green-700">Invite sent.</p>}
      <Button type="submit" disabled={submitting || !email}>
        {submitting ? "Sending…" : "Send invite"}
      </Button>
    </form>
  );
}
