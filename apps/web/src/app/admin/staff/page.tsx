"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Badge, Button, Card, Input } from "@queueflow/ui";
import { ApiError } from "@queueflow/api-client";
import type {
  InviteSummary,
  LocationSummary,
  TenantMemberSummary,
  TenantRole,
} from "@queueflow/types";
import { staffApi } from "../../../lib/staff-api-client";
import { useStaffSession } from "../../../lib/use-staff-session";
import { AdminNav } from "../../../components/AdminNav";
import { isBusinessAdmin } from "../../../lib/roles";

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback;
}

type AssignableRole = "TENANT_ADMIN" | "MANAGER" | "STAFF";
const ASSIGNABLE_ROLES: AssignableRole[] = ["TENANT_ADMIN", "MANAGER", "STAFF"];

const ROLE_LABELS: Record<TenantRole, string> = {
  TENANT_OWNER: "Owner",
  TENANT_ADMIN: "Admin",
  MANAGER: "Manager",
  STAFF: "Staff",
};

/** Managers and staff work at exactly one location; admins and the owner cover them all (ADR-015). */
const needsLocation = (role: AssignableRole): boolean => role !== "TENANT_ADMIN";

const selectClass =
  "min-h-[48px] rounded-md border border-border bg-surface px-4 py-3 text-base text-text-primary";

/**
 * The team (Phase 16): who works where, inviting with a location, changing
 * someone's role or location, and removing them. The owner and the
 * signed-in person themselves can't be changed here (the API refuses too).
 */
export default function StaffPage() {
  const session = useStaffSession();
  const [members, setMembers] = useState<TenantMemberSummary[] | null>(null);
  const [invites, setInvites] = useState<InviteSummary[] | null>(null);
  const [locations, setLocations] = useState<LocationSummary[] | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  async function refresh(): Promise<void> {
    const [m, i, l] = await Promise.all([
      staffApi.listStaff(),
      staffApi.listInvites(),
      staffApi.listLocations(),
    ]);
    setMembers(m);
    setInvites(i);
    setLocations(l);
  }

  useEffect(() => {
    if (!session || !isBusinessAdmin(session.role)) return;
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  // Phase 16: managers/staff can reach this URL, but the API refuses them — say so, rather than load forever.
  if (session && !isBusinessAdmin(session.role)) return <AdminOnly title="Staff" />;

  if (!session || !members || !invites || !locations) {
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
        <AdminNav current="staff" role={session.role} />
      </header>

      <Card className="flex flex-col gap-3">
        <h2 className="text-sm font-medium uppercase tracking-wide text-text-secondary">
          Current staff
        </h2>
        {members.map((member) => (
          <MemberRow
            key={member.tenantUserId}
            member={member}
            locations={locations}
            isSelf={member.tenantUserId === session.tenantUserId}
            onChanged={refresh}
          />
        ))}
      </Card>

      <Card className="flex flex-col gap-4">
        <h2 className="text-sm font-medium uppercase tracking-wide text-text-secondary">
          Invite staff
        </h2>
        {locations.length === 0 ? (
          <p className="text-sm text-text-secondary">
            Add a location first: managers and staff each work at one location.
          </p>
        ) : (
          <InviteForm locations={locations} onInvited={refresh} />
        )}
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
                  {ROLE_LABELS[invite.role]}
                  {invite.location ? ` at ${invite.location.name}` : ""} · expires{" "}
                  {new Date(invite.expiresAt).toLocaleDateString()}
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

function MemberRow({
  member,
  locations,
  isSelf,
  onChanged,
}: {
  member: TenantMemberSummary;
  locations: LocationSummary[];
  isSelf: boolean;
  onChanged: () => Promise<void>;
}) {
  const [mode, setMode] = useState<"view" | "edit" | "remove">("view");
  const [role, setRole] = useState<AssignableRole>(
    member.role === "TENANT_OWNER" ? "TENANT_ADMIN" : member.role,
  );
  const [locationId, setLocationId] = useState(member.location?.id ?? locations[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const changeable = member.role !== "TENANT_OWNER" && !isSelf;

  async function run(action: () => Promise<unknown>): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await action();
      setMode("view");
      await onChanged();
    } catch (err) {
      setError(errorMessage(err, "Something went wrong."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-md border border-border px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-medium text-text-primary">
            {member.displayName}
            {isSelf ? " (you)" : ""}
          </p>
          <p className="text-sm text-text-secondary">{member.email}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="info">{ROLE_LABELS[member.role]}</Badge>
          <Badge tone="neutral">
            {member.location
              ? member.location.name
              : member.role === "MANAGER" || member.role === "STAFF"
                ? "No location yet"
                : "All locations"}
          </Badge>
          {changeable && mode === "view" && (
            <>
              <Button variant="secondary" onClick={() => setMode("edit")}>
                Change
              </Button>
              <Button variant="destructive" onClick={() => setMode("remove")}>
                Remove
              </Button>
            </>
          )}
        </div>
      </div>

      {mode === "edit" && (
        <form
          className="flex flex-col gap-3 border-t border-border pt-3"
          onSubmit={(event) => {
            event.preventDefault();
            void run(() =>
              staffApi.updateMember(member.tenantUserId, {
                role,
                locationId: needsLocation(role) ? locationId : null,
              }),
            );
          }}
        >
          <RoleAndLocationFields
            role={role}
            onRole={setRole}
            locationId={locationId}
            onLocation={setLocationId}
            locations={locations}
          />
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex gap-3">
            <Button type="submit" disabled={busy}>
              {busy ? "Saving…" : "Save"}
            </Button>
            <Button type="button" variant="secondary" onClick={() => setMode("view")}>
              Cancel
            </Button>
          </div>
        </form>
      )}

      {mode === "remove" && (
        <div className="flex flex-col gap-3 border-t border-border pt-3">
          <p className="text-sm text-text-primary">
            Remove {member.displayName}? They&apos;ll be signed out straight away. Their past queue
            activity keeps their name. You can invite them again later.
          </p>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex gap-3">
            <Button
              variant="destructive"
              disabled={busy}
              onClick={() => run(() => staffApi.removeMember(member.tenantUserId))}
            >
              {busy ? "Removing…" : "Remove"}
            </Button>
            <Button variant="secondary" onClick={() => setMode("view")}>
              Keep
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function RoleAndLocationFields({
  role,
  onRole,
  locationId,
  onLocation,
  locations,
}: {
  role: AssignableRole;
  onRole: (role: AssignableRole) => void;
  locationId: string;
  onLocation: (id: string) => void;
  locations: LocationSummary[];
}) {
  return (
    <>
      <label className="flex flex-col gap-1.5 text-sm font-medium text-text-primary">
        Role
        <select
          value={role}
          onChange={(e) => onRole(e.target.value as AssignableRole)}
          className={selectClass}
        >
          {ASSIGNABLE_ROLES.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABELS[r]}
            </option>
          ))}
        </select>
      </label>
      {needsLocation(role) ? (
        <label className="flex flex-col gap-1.5 text-sm font-medium text-text-primary">
          Location
          <select
            value={locationId}
            onChange={(e) => onLocation(e.target.value)}
            required
            className={selectClass}
          >
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <p className="text-sm text-text-secondary">Admins can work at every location.</p>
      )}
    </>
  );
}

function InviteForm({
  locations,
  onInvited,
}: {
  locations: LocationSummary[];
  onInvited: () => Promise<void>;
}) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<AssignableRole>("STAFF");
  const [locationId, setLocationId] = useState(locations[0]?.id ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setSuccess(false);
    try {
      await staffApi.createInvite({
        email,
        role,
        locationId: needsLocation(role) ? locationId : null,
      });
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
      <RoleAndLocationFields
        role={role}
        onRole={setRole}
        locationId={locationId}
        onLocation={setLocationId}
        locations={locations}
      />
      {error && <p className="text-sm text-red-600">{error}</p>}
      {success && (
        <p className="text-sm text-green-700">
          Invite sent. They&apos;ll get an email with a link.
        </p>
      )}
      <Button type="submit" disabled={submitting || !email}>
        {submitting ? "Sending…" : "Send invite"}
      </Button>
    </form>
  );
}

function AdminOnly({ title }: { title: string }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-4 bg-bg p-6 pt-10">
      <h1 className="text-xl font-semibold text-text-primary">{title}</h1>
      <p className="text-text-secondary">
        Only the business owner or an admin can manage this. Ask them if something needs changing.
      </p>
    </main>
  );
}
