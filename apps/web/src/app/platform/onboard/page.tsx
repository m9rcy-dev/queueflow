"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, Card, Input } from "@queueflow/ui";
import { ApiError } from "@queueflow/api-client";
import type { PlatformOnboardResponse } from "@queueflow/types";
import { platformApi, usePlatformToken } from "../../../lib/platform-session";
import { PlatformFrame } from "../PlatformFrame";

/**
 * Onboard a business (Phase 19, ADR-018). The platform admin sets only who
 * owns it and which services it gets; the owner is emailed and sets up the
 * rest (locations, services, queues, hours, logo) from their Get started list.
 */
export default function OnboardBusinessPage() {
  const router = useRouter();
  const [token, setToken] = usePlatformToken();
  const [businessName, setBusinessName] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");
  const [appointmentsEnabled, setAppointmentsEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<PlatformOnboardResponse | null>(null);

  useEffect(() => {
    if (token === null) router.replace("/platform");
  }, [token, router]);

  const signOut = () => {
    setToken(null);
    router.replace("/platform");
  };

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      setDone(
        await platformApi.onboard(token, {
          businessName,
          ownerName,
          ownerEmail,
          appointmentsEnabled,
        }),
      );
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        signOut();
        return;
      }
      setError(err instanceof ApiError ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <PlatformFrame onSignOut={signOut}>
      <Link href="/platform" className="text-sm text-text-secondary underline">
        ← All businesses
      </Link>

      {done ? (
        <Card className="flex flex-col gap-3">
          <h1 className="text-xl font-semibold text-text-primary">{done.tenant.name} is set up</h1>
          <p className="text-sm text-text-secondary">
            {done.tenant.ownerName} ({done.tenant.ownerEmail}) has been emailed a welcome with the
            sign-in link.{" "}
            {done.ownerHadAccount
              ? "They already had a QueueFlow account, so they'll choose this business when they sign in."
              : "They sign in with that email and a login code."}{" "}
            Their Get started list takes them through locations, services, a queue and their QR
            poster.
          </p>
          <div className="flex flex-wrap gap-3">
            <Button onClick={() => router.push(`/platform/tenants/${done.tenant.id}`)}>
              View business
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                setDone(null);
                setBusinessName("");
                setOwnerName("");
                setOwnerEmail("");
                setAppointmentsEnabled(false);
              }}
            >
              Onboard another
            </Button>
          </div>
        </Card>
      ) : (
        <Card className="flex flex-col gap-4">
          <div>
            <h1 className="text-xl font-semibold text-text-primary">Onboard a business</h1>
            <p className="text-sm text-text-secondary">
              The owner gets a welcome email and sets up the rest themselves.
            </p>
          </div>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <Input
              label="Business name"
              value={businessName}
              onChange={(e) => setBusinessName(e.target.value)}
              required
              minLength={2}
              autoFocus
            />
            <Input
              label="Owner's name"
              value={ownerName}
              onChange={(e) => setOwnerName(e.target.value)}
              required
            />
            <Input
              label="Owner's email"
              type="email"
              value={ownerEmail}
              onChange={(e) => setOwnerEmail(e.target.value)}
              required
            />
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-sm font-medium text-text-primary">Services</legend>
              <label className="flex items-center gap-2 text-sm text-text-secondary">
                <input type="checkbox" checked disabled />
                Queue (always on)
              </label>
              <label className="flex items-center gap-2 text-sm text-text-primary">
                <input
                  type="checkbox"
                  checked={appointmentsEnabled}
                  onChange={(e) => setAppointmentsEnabled(e.target.checked)}
                />
                Appointments (bookings). The owner can change this later in Settings.
              </label>
            </fieldset>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <Button type="submit" disabled={busy || !token}>
              {busy ? "Setting up…" : "Onboard business"}
            </Button>
          </form>
        </Card>
      )}
    </PlatformFrame>
  );
}
