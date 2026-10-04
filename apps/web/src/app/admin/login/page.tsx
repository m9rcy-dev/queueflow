"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Input, OtpCodeInput } from "@queueflow/ui";
import { ApiError } from "@queueflow/api-client";
import type { DeviceContextResponse, MembershipSummary } from "@queueflow/types";
import { staffApi } from "../../../lib/staff-api-client";
import { BusinessLogo } from "../../../components/BusinessLogo";
import { QueueFlowLogo } from "../../../components/QueueFlowLogo";

type Step =
  | { name: "loading" }
  | { name: "device-staff-picker"; context: DeviceContextResponse }
  | { name: "pin-entry"; context: DeviceContextResponse; tenantUserId: string; name_: string }
  | { name: "otp-email" }
  | { name: "otp-code"; email: string }
  | { name: "tenant-select"; pendingToken: string; tenants: MembershipSummary[] };

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback;
}

/**
 * Staff sign-in (Phase 1's backend, Phase 5's first-ever web UI for it).
 * Two independent paths converge here: normal OTP login (any device), and
 * D-03a's trusted-device + PIN switch (the shared counter tablet's fast
 * path once someone has trusted it once).
 */
export default function StaffLoginPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>({ name: "loading" });
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    (async () => {
      const restored = await staffApi.restoreSession().catch(() => null);
      if (restored) {
        router.push("/admin/queues");
        return;
      }
      const context = await staffApi.tryRestoreDeviceContext().catch(() => null);
      if (context) {
        setStep({ name: "device-staff-picker", context });
        return;
      }
      setStep({ name: "otp-email" });
    })();
    // `router` from useRouter() is a stable reference across re-renders in
    // the App Router — safe to run this effect once per mount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (step.name === "loading") {
    return <Centered>Loading…</Centered>;
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 bg-bg p-6">
      <div className="flex flex-col items-center gap-2">
        <QueueFlowLogo size="lg" />
        <h1 className="text-center text-base font-medium text-text-secondary">Staff sign in</h1>
      </div>

      {step.name === "device-staff-picker" && (
        <StaffPicker
          context={step.context}
          onPick={(tenantUserId, name_) =>
            setStep({ name: "pin-entry", context: step.context, tenantUserId, name_ })
          }
          onUseEmailInstead={() => setStep({ name: "otp-email" })}
        />
      )}

      {step.name === "pin-entry" && (
        <PinEntry
          staffName={step.name_}
          submitting={submitting}
          error={error}
          onBack={() => {
            setError(null);
            setStep({ name: "device-staff-picker", context: step.context });
          }}
          onSubmit={async (pin) => {
            setSubmitting(true);
            setError(null);
            try {
              await staffApi.staffPinLogin(step.context.deviceTrustToken, step.tenantUserId, pin);
              router.push("/admin/queues");
            } catch (err) {
              setError(errorMessage(err, "Incorrect PIN. Please try again."));
              setSubmitting(false);
            }
          }}
        />
      )}

      {step.name === "otp-email" && (
        <EmailStep
          submitting={submitting}
          error={error}
          onSubmit={async (email) => {
            setSubmitting(true);
            setError(null);
            try {
              await staffApi.requestLoginCode(email);
              setStep({ name: "otp-code", email });
            } catch (err) {
              setError(errorMessage(err, "Something went wrong. Please try again."));
            } finally {
              setSubmitting(false);
            }
          }}
        />
      )}

      {step.name === "otp-code" && (
        <CodeStep
          email={step.email}
          submitting={submitting}
          error={error}
          onEmailInstead={() => staffApi.requestLoginCode(step.email, true)}
          onSubmit={async (code, trustDevice) => {
            setSubmitting(true);
            setError(null);
            try {
              const result = await staffApi.verifyLoginCode(step.email, code);
              if (result.requiresTenantSelection) {
                setStep({
                  name: "tenant-select",
                  pendingToken: result.pendingToken,
                  tenants: result.tenants,
                });
                return;
              }
              if (trustDevice) {
                await staffApi.trustDevice().catch(() => undefined);
              }
              router.push("/admin/queues");
            } catch (err) {
              setError(errorMessage(err, "That code is invalid or has expired."));
              setSubmitting(false);
            }
          }}
        />
      )}

      {step.name === "tenant-select" && (
        <TenantSelect
          tenants={step.tenants}
          submitting={submitting}
          error={error}
          onSelect={async (tenantId) => {
            setSubmitting(true);
            setError(null);
            try {
              await staffApi.selectTenant(step.pendingToken, tenantId);
              router.push("/admin/queues");
            } catch (err) {
              setError(errorMessage(err, "Something went wrong. Please try again."));
              setSubmitting(false);
            }
          }}
        />
      )}
    </main>
  );
}

function StaffPicker({
  context,
  onPick,
  onUseEmailInstead,
}: {
  context: DeviceContextResponse;
  onPick: (tenantUserId: string, name: string) => void;
  onUseEmailInstead: () => void;
}) {
  return (
    <Card className="flex flex-col gap-4">
      <div className="flex flex-col items-center gap-2 text-center">
        {/* Phase 19 — a counter tablet knows its business: show its logo beside QueueFlow's. */}
        <BusinessLogo logoPath={context.tenant.logoPath} name={context.tenant.name} />
        <h2 className="text-lg font-medium text-text-primary">{context.tenant.name}</h2>
        <p className="text-sm text-text-secondary">Who are you?</p>
      </div>
      <div className="flex flex-col gap-2">
        {context.staff.map((member) =>
          member.hasPin ? (
            <Button
              key={member.tenantUserId}
              variant="secondary"
              onClick={() => onPick(member.tenantUserId, member.displayName)}
            >
              {member.displayName}
            </Button>
          ) : (
            <div
              key={member.tenantUserId}
              className="flex min-h-[48px] items-center justify-between rounded-md border border-border px-4 py-3 text-text-secondary"
            >
              <span>{member.displayName}</span>
              <span className="text-sm">No PIN set up</span>
            </div>
          ),
        )}
      </div>
      <button
        type="button"
        onClick={onUseEmailInstead}
        className="text-sm text-text-secondary underline"
      >
        Someone else, or another business? Sign in with email
      </button>
    </Card>
  );
}

function PinEntry({
  staffName,
  submitting,
  error,
  onBack,
  onSubmit,
}: {
  staffName: string;
  submitting: boolean;
  error: string | null;
  onBack: () => void;
  onSubmit: (pin: string) => void;
}) {
  const [pin, setPin] = useState("");
  function handleSubmit(event: FormEvent): void {
    event.preventDefault();
    onSubmit(pin);
  }
  return (
    <Card className="flex flex-col gap-4">
      <h2 className="text-lg font-medium text-text-primary">Hi, {staffName}</h2>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Input
          label="PIN"
          type="password"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={6}
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
          autoFocus
          required
        />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <Button type="submit" disabled={submitting || pin.length < 4}>
          {submitting ? "Checking…" : "Sign in"}
        </Button>
      </form>
      <button type="button" onClick={onBack} className="text-sm text-text-secondary underline">
        Not you?
      </button>
    </Card>
  );
}

function EmailStep({
  submitting,
  error,
  onSubmit,
}: {
  submitting: boolean;
  error: string | null;
  onSubmit: (email: string) => void;
}) {
  const [email, setEmail] = useState("");
  function handleSubmit(event: FormEvent): void {
    event.preventDefault();
    onSubmit(email);
  }
  return (
    <Card className="flex flex-col gap-4">
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Input
          label="Email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          autoFocus
          required
        />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <Button type="submit" disabled={submitting || !email}>
          {submitting ? "Sending…" : "Send login code"}
        </Button>
      </form>
    </Card>
  );
}

/**
 * One code box for both kinds of code (Phase 15): an authenticator-app
 * account gets no email unless it asks, so the wording covers both without
 * revealing which this account uses (G-05). Submits itself once 6 digits
 * are in (OtpCodeInput).
 */
function CodeStep({
  email,
  submitting,
  error,
  onSubmit,
  onEmailInstead,
}: {
  email: string;
  submitting: boolean;
  error: string | null;
  onSubmit: (code: string, trustDevice: boolean) => void;
  onEmailInstead: () => Promise<void>;
}) {
  const [code, setCode] = useState("");
  const [trustDevice, setTrustDevice] = useState(false);
  const [emailSent, setEmailSent] = useState(false);

  // A wrong code clears the box, ready for the next paste.
  useEffect(() => {
    if (error) setCode("");
  }, [error]);

  function handleSubmit(event: FormEvent): void {
    event.preventDefault();
    if (code.length === 6) onSubmit(code, trustDevice);
  }

  return (
    <Card className="flex flex-col gap-4">
      <p className="text-sm text-text-secondary">
        Enter the 6-digit code from your authenticator app, or the one we emailed to{" "}
        <strong>{email}</strong>.
      </p>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <OtpCodeInput
          label="Login code"
          value={code}
          onChange={setCode}
          onComplete={(completed) => onSubmit(completed, trustDevice)}
          disabled={submitting}
          error={error ?? undefined}
          autoFocus
        />
        <label className="flex items-center gap-2 text-sm text-text-secondary">
          <input
            type="checkbox"
            checked={trustDevice}
            onChange={(e) => setTrustDevice(e.target.checked)}
          />
          Remember this device for quick staff PIN switching
        </label>
        <Button type="submit" disabled={submitting || code.length !== 6}>
          {submitting ? "Verifying…" : "Verify"}
        </Button>
      </form>
      <button
        type="button"
        className="text-sm text-text-secondary underline"
        disabled={emailSent}
        onClick={async () => {
          await onEmailInstead().catch(() => undefined);
          setEmailSent(true);
        }}
      >
        {emailSent ? `Code sent to ${email}` : "Email me a code instead"}
      </button>
    </Card>
  );
}

function TenantSelect({
  tenants,
  submitting,
  error,
  onSelect,
}: {
  tenants: MembershipSummary[];
  submitting: boolean;
  error: string | null;
  onSelect: (tenantId: string) => void;
}) {
  return (
    <Card className="flex flex-col gap-3">
      <h2 className="text-lg font-medium text-text-primary">Choose a business</h2>
      {tenants.map((tenant) => (
        <Button
          key={tenant.tenantId}
          variant="secondary"
          disabled={submitting}
          onClick={() => onSelect(tenant.tenantId)}
        >
          {tenant.tenantName}
        </Button>
      ))}
      {error && <p className="text-sm text-red-600">{error}</p>}
    </Card>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-bg p-8 text-center text-text-secondary">
      {children}
    </main>
  );
}
