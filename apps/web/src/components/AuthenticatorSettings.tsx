"use client";

import { useEffect, useState } from "react";
import { Button, Card, OtpCodeInput } from "@queueflow/ui";
import { ApiError } from "@queueflow/api-client";
import type { AuthenticatorSetup, AuthenticatorStatus } from "@queueflow/types";
import { TicketQrCode } from "./TicketQrCode";

/** What both the staff and customer API clients offer for this (Phase 15). */
export interface AuthenticatorApi {
  getAuthenticatorStatus(): Promise<AuthenticatorStatus>;
  beginAuthenticatorSetup(): Promise<AuthenticatorSetup>;
  confirmAuthenticator(code: string): Promise<AuthenticatorStatus>;
  disableAuthenticator(): Promise<AuthenticatorStatus>;
}

/** "ABCD EFGH IJKL …" — the setup key in groups of four, easier to type by hand. */
function groupKey(secret: string): string {
  return secret.replace(/(.{4})/g, "$1 ").trim();
}

/**
 * The login-code preference (Phase 15, ADR-014): emailed codes, or codes
 * from an authenticator app. Setting it up shows a QR to scan, then asks
 * for the first code the app shows. The emailed code stays available on
 * the login screen either way, so this is never a way to get locked out.
 * Shared by the staff account page and the customer portal.
 */
export function AuthenticatorSettings({ api }: { api: AuthenticatorApi }) {
  const [status, setStatus] = useState<AuthenticatorStatus | null>(null);
  const [setup, setSetup] = useState<AuthenticatorSetup | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingDisable, setConfirmingDisable] = useState(false);

  useEffect(() => {
    api
      .getAuthenticatorStatus()
      .then(setStatus)
      .catch(() => setStatus({ enabled: false }));
  }, [api]);

  async function run(action: () => Promise<void>): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
      setCode("");
    } finally {
      setBusy(false);
    }
  }

  if (!status) return null;

  return (
    <Card className="flex w-full flex-col gap-4 text-left">
      <h2 className="text-sm font-medium uppercase tracking-wide text-text-secondary">
        Login codes
      </h2>

      {!setup && (
        <>
          <p className="text-text-primary">
            {status.enabled
              ? "Your login codes come from your authenticator app."
              : "Your login codes are emailed to you."}
          </p>
          <p className="text-sm text-text-secondary">
            {status.enabled
              ? "If you lose your phone, choose “Email me a code instead” on the login screen."
              : "You can use an authenticator app (Google Authenticator, Microsoft Authenticator and others) instead, so you don't have to wait for an email."}
          </p>
          <div className="flex flex-wrap gap-3">
            <Button
              variant={status.enabled ? "secondary" : "primary"}
              disabled={busy}
              onClick={() => run(async () => setSetup(await api.beginAuthenticatorSetup()))}
            >
              {status.enabled ? "Set up on a new phone" : "Use an authenticator app"}
            </Button>
            {status.enabled && !confirmingDisable && (
              <Button variant="secondary" onClick={() => setConfirmingDisable(true)}>
                Switch back to emailed codes
              </Button>
            )}
          </div>
          {confirmingDisable && (
            <div className="flex flex-col gap-3 rounded-md border border-border p-4">
              <p className="text-sm text-text-primary">
                Stop using the authenticator app? Codes will be emailed again. You can remove the
                QueueFlow entry from the app afterwards.
              </p>
              <div className="flex gap-3">
                <Button
                  variant="destructive"
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      setStatus(await api.disableAuthenticator());
                      setConfirmingDisable(false);
                    })
                  }
                >
                  Switch to emailed codes
                </Button>
                <Button variant="secondary" onClick={() => setConfirmingDisable(false)}>
                  Keep the app
                </Button>
              </div>
            </div>
          )}
        </>
      )}

      {setup && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col items-center gap-2 text-center">
            <p className="text-sm text-text-primary">
              1. In your authenticator app, add an account and scan this code.
            </p>
            <TicketQrCode url={setup.otpauthUri} />
            <p className="text-xs text-text-secondary">Can&apos;t scan it? Enter this key:</p>
            <p className="break-all font-mono text-sm text-text-primary">
              {groupKey(setup.secret)}
            </p>
          </div>
          <p className="text-sm text-text-primary">2. Enter the 6-digit code the app now shows.</p>
          <OtpCodeInput
            label="Code from the app"
            value={code}
            onChange={setCode}
            onComplete={(completed) =>
              run(async () => {
                setStatus(await api.confirmAuthenticator(completed));
                setSetup(null);
                setCode("");
              })
            }
            disabled={busy}
            error={error ?? undefined}
            autoFocus
          />
          <Button
            variant="secondary"
            onClick={() => {
              setSetup(null);
              setCode("");
              setError(null);
            }}
          >
            Cancel
          </Button>
        </div>
      )}

      {error && !setup && <p className="text-sm text-red-600">{error}</p>}
    </Card>
  );
}
