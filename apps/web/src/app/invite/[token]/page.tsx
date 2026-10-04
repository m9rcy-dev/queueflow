"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useParams, useRouter } from "next/navigation";
import { Button, Card, Input, OtpCodeInput } from "@queueflow/ui";
import { ApiError } from "@queueflow/api-client";
import type { InviteDetails, TenantRole } from "@queueflow/types";
import { staffApi } from "../../../lib/staff-api-client";

const ROLE_LABELS: Record<TenantRole, string> = {
  TENANT_OWNER: "Owner",
  TENANT_ADMIN: "Admin",
  MANAGER: "Manager",
  STAFF: "Staff",
};

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback;
}

/**
 * Accepting a staff invite (Phase 16) — reached from the link in the
 * invite email. Shows who's inviting and as what, asks the person's name,
 * emails a code to the invited address (proving they own it), and signs
 * them straight in once the code is entered (it submits by itself).
 */
export default function AcceptInvitePage() {
  const params = useParams<{ token: string }>();
  const token = params.token;
  const router = useRouter();

  const [details, setDetails] = useState<InviteDetails | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    staffApi
      .getInviteDetails(token)
      .then(setDetails)
      .catch((err) =>
        setLoadError(errorMessage(err, "This invitation is invalid or has expired.")),
      );
  }, [token]);

  async function handleSendCode(event: FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await staffApi.requestInviteCode(token);
      setCodeSent(true);
    } catch (err) {
      setError(errorMessage(err, "Something went wrong. Please try again."));
    } finally {
      setBusy(false);
    }
  }

  async function handleAccept(completed: string): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await staffApi.acceptInvite(token, completed, name.trim());
      router.push("/admin/queues");
    } catch (err) {
      setError(errorMessage(err, "That code is invalid or has expired."));
      setCode("");
      setBusy(false);
    }
  }

  if (loadError) {
    return (
      <Centered>
        <h1 className="text-xl font-semibold text-text-primary">Invitation not available</h1>
        <p className="text-text-secondary">{loadError}</p>
        <p className="text-sm text-text-secondary">
          Ask whoever invited you to send a new invitation.
        </p>
      </Centered>
    );
  }

  if (!details) {
    return (
      <Centered>
        <p className="text-text-secondary">Loading…</p>
      </Centered>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 bg-bg p-6">
      <div className="text-center">
        <h1 className="text-2xl font-semibold text-text-primary">Join {details.tenantName}</h1>
        <p className="text-text-secondary">
          You&apos;ve been invited as <strong>{ROLE_LABELS[details.role]}</strong>
          {details.locationName ? (
            <>
              {" "}
              at <strong>{details.locationName}</strong>
            </>
          ) : null}
          .
        </p>
      </div>

      {!codeSent ? (
        <Card className="flex flex-col gap-4">
          <form onSubmit={handleSendCode} className="flex flex-col gap-4">
            <Input
              label="Your name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              autoComplete="name"
              autoFocus
            />
            <p className="text-sm text-text-secondary">
              We&apos;ll email a 6-digit code to <strong>{details.email}</strong> to confirm
              it&apos;s you.
            </p>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <Button type="submit" disabled={busy || !name.trim()}>
              {busy ? "Sending…" : "Send me a code"}
            </Button>
          </form>
        </Card>
      ) : (
        <Card className="flex flex-col gap-4">
          <p className="text-sm text-text-secondary">
            Enter the code we emailed to <strong>{details.email}</strong>.
          </p>
          <OtpCodeInput
            label="Code"
            value={code}
            onChange={setCode}
            onComplete={handleAccept}
            disabled={busy}
            error={error ?? undefined}
            autoFocus
          />
          <Button onClick={() => handleAccept(code)} disabled={busy || code.length !== 6}>
            {busy ? "Joining…" : "Join"}
          </Button>
          <button
            type="button"
            className="text-sm text-text-secondary underline"
            onClick={() => {
              setCodeSent(false);
              setCode("");
              setError(null);
            }}
          >
            Didn&apos;t get it? Send another code
          </button>
        </Card>
      )}
    </main>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-bg p-8 text-center">
      {children}
    </main>
  );
}
