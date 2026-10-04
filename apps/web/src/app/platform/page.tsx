"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { Button, Card, Input, OtpCodeInput } from "@queueflow/ui";
import { ApiError } from "@queueflow/api-client";
import type { PlatformTenantSummary } from "@queueflow/types";
import { platformApi, usePlatformToken } from "../../lib/platform-session";
import { BusinessLogo } from "../../components/BusinessLogo";
import { CapabilityBadges, PlatformFrame } from "./PlatformFrame";

/**
 * The platform (root) admin console (Phase 19, ADR-018): QueueFlow's own
 * operators sign in here (emails in PLATFORM_ADMIN_EMAILS) to see every
 * business and which services it has switched on. Read-only.
 */
export default function PlatformPage() {
  const [token, setToken] = usePlatformToken();
  if (token === undefined) return <PlatformFrame>{null}</PlatformFrame>;
  if (!token) return <PlatformLogin onSignedIn={setToken} />;
  return <BusinessList token={token} onSignOut={() => setToken(null)} />;
}

function PlatformLogin({ onSignedIn }: { onSignedIn: (token: string) => void }) {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function requestCode(event: FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await platformApi.requestCode(email);
      setSent(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  async function verify(submitted: string): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const result = await platformApi.verify(email, submitted);
      onSignedIn(result.accessToken);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong.");
      setCode("");
      setBusy(false);
    }
  }

  return (
    <PlatformFrame>
      <Card className="mx-auto flex w-full max-w-md flex-col gap-4">
        <div>
          <h1 className="text-xl font-semibold text-text-primary">Platform sign in</h1>
          <p className="text-sm text-text-secondary">For QueueFlow administrators only.</p>
        </div>
        {!sent ? (
          <form onSubmit={requestCode} className="flex flex-col gap-4">
            <Input
              label="Email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              autoFocus
            />
            {error && <p className="text-sm text-red-600">{error}</p>}
            <Button type="submit" disabled={busy}>
              {busy ? "Sending…" : "Send login code"}
            </Button>
          </form>
        ) : (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-text-secondary">
              If {email} is a QueueFlow admin, a code is on its way. You can also use your
              authenticator app.
            </p>
            <OtpCodeInput
              label="Login code"
              value={code}
              onChange={setCode}
              onComplete={verify}
              disabled={busy}
              error={error ?? undefined}
              autoFocus
            />
            <button
              type="button"
              onClick={() => {
                setSent(false);
                setCode("");
                setError(null);
              }}
              className="self-start text-sm text-text-secondary underline"
            >
              Use a different email
            </button>
          </div>
        )}
      </Card>
    </PlatformFrame>
  );
}

function BusinessList({ token, onSignOut }: { token: string; onSignOut: () => void }) {
  const [tenants, setTenants] = useState<PlatformTenantSummary[] | null>(null);
  const [filter, setFilter] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    platformApi
      .listTenants(token)
      .then(setTenants)
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) onSignOut();
        else setError(err instanceof ApiError ? err.message : "Couldn't load businesses.");
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const shown =
    tenants?.filter((tenant) =>
      `${tenant.name} ${tenant.ownerName} ${tenant.ownerEmail ?? ""}`
        .toLowerCase()
        .includes(filter.trim().toLowerCase()),
    ) ?? [];

  return (
    <PlatformFrame onSignOut={onSignOut}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-text-primary">Businesses</h1>
          {tenants && (
            <p className="text-sm text-text-secondary">
              {tenants.length} in all · {tenants.filter((t) => t.capabilities.appointments).length}{" "}
              with appointments
            </p>
          )}
        </div>
        <div className="flex w-full flex-wrap items-end gap-3 sm:w-auto">
          <Link
            href="/platform/onboard"
            className="inline-flex min-h-[48px] items-center rounded-md bg-primary px-4 font-medium text-white hover:bg-primary-hover"
          >
            + Onboard a business
          </Link>
          <div className="w-full sm:w-64">
            <Input
              label="Search"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Business, owner or email"
            />
          </div>
        </div>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {!tenants && !error && <p className="text-text-secondary">Loading…</p>}
      {tenants && shown.length === 0 && (
        <Card>
          <p className="text-text-secondary">No businesses match.</p>
        </Card>
      )}
      <div className="flex flex-col gap-3">
        {shown.map((tenant) => (
          <Link key={tenant.id} href={`/platform/tenants/${tenant.id}`}>
            <Card className="flex flex-wrap items-center justify-between gap-3 p-4 hover:border-primary/50">
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-md bg-bg">
                  {tenant.logoPath ? (
                    <BusinessLogo logoPath={tenant.logoPath} name={tenant.name} size="sm" />
                  ) : (
                    <span className="text-lg font-bold text-text-secondary">
                      {tenant.name.slice(0, 1).toUpperCase()}
                    </span>
                  )}
                </div>
                <div className="min-w-0">
                  <p className="truncate font-semibold text-text-primary">{tenant.name}</p>
                  <p className="truncate text-sm text-text-secondary">
                    {tenant.ownerName}
                    {tenant.ownerEmail ? ` · ${tenant.ownerEmail}` : ""}
                  </p>
                </div>
              </div>
              <div className="flex flex-col items-end gap-1.5">
                <CapabilityBadges capabilities={tenant.capabilities} />
                <p className="text-xs text-text-secondary">
                  {tenant.locationCount} location{tenant.locationCount === 1 ? "" : "s"} ·{" "}
                  {tenant.memberCount} staff · {tenant.ticketsLast30Days} tickets (30 days)
                </p>
              </div>
            </Card>
          </Link>
        ))}
      </div>
    </PlatformFrame>
  );
}
