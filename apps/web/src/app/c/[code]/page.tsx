"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useParams, useRouter } from "next/navigation";
import { Button, Card, Input } from "@queueflow/ui";
import { ApiError } from "@queueflow/api-client";
import type { GeneralCodeResolution } from "@queueflow/types";
import { publicApi } from "../../../lib/api-client";
import { customerApi } from "../../../lib/customer-api-client";

type Step =
  | { name: "loading" }
  | { name: "error"; message: string }
  | { name: "choose" }
  | { name: "signup-form" }
  | { name: "login-form" }
  | { name: "otp-code"; email: string };

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback;
}

/**
 * The GENERAL "sign up here" poster's landing page (Phase 9, D-10, G-56) —
 * a customer scans this at the counter (or finds it self-serve) to either
 * create an account or log back into one they already have. Mirrors
 * admin/login/page.tsx's step-machine shape, against the customer-auth
 * endpoints instead of staff auth.
 */
export default function CustomerSignupLandingPage() {
  const params = useParams<{ code: string }>();
  const code = params.code;
  const router = useRouter();

  const [tenant, setTenant] = useState<GeneralCodeResolution["tenant"] | null>(null);
  const [step, setStep] = useState<Step>({ name: "loading" });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    publicApi
      .resolveCode(code)
      .then((data) => {
        if (data.contextType !== "GENERAL") {
          setStep({ name: "error", message: "This code isn't recognized." });
          return;
        }
        setTenant(data.tenant);
        setStep({ name: "choose" });
      })
      .catch((err) => {
        setStep({ name: "error", message: errorMessage(err, "This code isn't recognized.") });
      });
  }, [code]);

  if (step.name === "loading") {
    return <Centered>Loading…</Centered>;
  }
  if (step.name === "error") {
    return (
      <Centered>
        <h1 className="text-xl font-semibold text-text-primary">Something went wrong</h1>
        <p className="text-text-secondary">{step.message}</p>
      </Centered>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 bg-bg p-6">
      <div className="pt-8 text-center">
        <h1 className="text-2xl font-semibold text-text-primary">{tenant?.name}</h1>
        <p className="text-text-secondary">Create an account, or log back in</p>
      </div>

      {step.name === "choose" && (
        <Card className="flex flex-col gap-3">
          <Button onClick={() => setStep({ name: "signup-form" })}>Create an account</Button>
          <Button variant="secondary" onClick={() => setStep({ name: "login-form" })}>
            I already have an account
          </Button>
        </Card>
      )}

      {step.name === "signup-form" && tenant && (
        <SignupForm
          submitting={submitting}
          error={error}
          onBack={() => {
            setError(null);
            setStep({ name: "choose" });
          }}
          onSubmit={async (name, phone, email) => {
            setSubmitting(true);
            setError(null);
            try {
              await customerApi.signUp({ tenantId: tenant.id, name, phone, email });
              setStep({ name: "otp-code", email });
            } catch (err) {
              setError(errorMessage(err, "Something went wrong. Please try again."));
            } finally {
              setSubmitting(false);
            }
          }}
        />
      )}

      {step.name === "login-form" && tenant && (
        <LoginForm
          submitting={submitting}
          error={error}
          onBack={() => {
            setError(null);
            setStep({ name: "choose" });
          }}
          onSubmit={async (email) => {
            setSubmitting(true);
            setError(null);
            try {
              await customerApi.requestLoginCode(tenant.id, email);
              setStep({ name: "otp-code", email });
            } catch (err) {
              setError(errorMessage(err, "Something went wrong. Please try again."));
            } finally {
              setSubmitting(false);
            }
          }}
        />
      )}

      {step.name === "otp-code" && tenant && (
        <CodeStep
          email={step.name === "otp-code" ? step.email : ""}
          submitting={submitting}
          error={error}
          onSubmit={async (otpCode) => {
            setSubmitting(true);
            setError(null);
            try {
              await customerApi.verifyLoginCode(
                tenant.id,
                step.name === "otp-code" ? step.email : "",
                otpCode,
              );
              router.push("/c/portal");
            } catch (err) {
              setError(errorMessage(err, "That code is invalid or has expired."));
              setSubmitting(false);
            }
          }}
        />
      )}
    </main>
  );
}

function SignupForm({
  submitting,
  error,
  onBack,
  onSubmit,
}: {
  submitting: boolean;
  error: string | null;
  onBack: () => void;
  onSubmit: (name: string, phone: string, email: string) => void;
}) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  function handleSubmit(event: FormEvent): void {
    event.preventDefault();
    onSubmit(name, phone, email);
  }
  return (
    <Card className="flex flex-col gap-4">
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Input
          label="Your name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoComplete="name"
          autoFocus
          required
        />
        <Input
          label="Mobile number"
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          autoComplete="tel"
          placeholder="021 123 4567"
          required
        />
        <Input
          label="Email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          required
        />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <Button type="submit" disabled={submitting || !name || !phone || !email}>
          {submitting ? "Creating…" : "Create account"}
        </Button>
      </form>
      <button type="button" onClick={onBack} className="text-sm text-text-secondary underline">
        Back
      </button>
    </Card>
  );
}

function LoginForm({
  submitting,
  error,
  onBack,
  onSubmit,
}: {
  submitting: boolean;
  error: string | null;
  onBack: () => void;
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
      <button type="button" onClick={onBack} className="text-sm text-text-secondary underline">
        Back
      </button>
    </Card>
  );
}

function CodeStep({
  email,
  submitting,
  error,
  onSubmit,
}: {
  email: string;
  submitting: boolean;
  error: string | null;
  onSubmit: (code: string) => void;
}) {
  const [code, setCode] = useState("");
  function handleSubmit(event: FormEvent): void {
    event.preventDefault();
    onSubmit(code);
  }
  return (
    <Card className="flex flex-col gap-4">
      <p className="text-sm text-text-secondary">
        We sent a 6-digit code to <strong>{email}</strong>.
      </p>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Input
          label="Login code"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={6}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
          autoFocus
          required
        />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <Button type="submit" disabled={submitting || code.length !== 6}>
          {submitting ? "Verifying…" : "Verify"}
        </Button>
      </form>
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
