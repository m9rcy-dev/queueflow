"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useParams, useRouter } from "next/navigation";
import { Button, Card, Input } from "@queueflow/ui";
import { ApiError } from "@queueflow/api-client";
import type { QueueCodeResolution } from "@queueflow/types";
import { publicApi } from "../../../lib/api-client";

/**
 * The QR-landing page (plan §9/§19) — scan a QUEUE-context code, land here,
 * join with just a name and mobile number. No account, no app install
 * (visual doc §7's customer UX principle). QUEUE-only: a GENERAL code
 * (Phase 9's "sign up here" poster) resolves fine at the API layer but
 * belongs on /c/[code] instead — presented here, it's treated the same as
 * an unrecognized code rather than crashing on the missing `services` field.
 */
export default function CodeLandingPage() {
  const params = useParams<{ code: string }>();
  const code = params.code;
  const router = useRouter();

  const [resolution, setResolution] = useState<QueueCodeResolution | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [serviceId, setServiceId] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  // Generated once per page load and reused across retries — the browser,
  // not the server, is what makes a retried join idempotent (G-21).
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  useEffect(() => {
    publicApi
      .resolveCode(code)
      .then((data) => {
        if (data.contextType !== "QUEUE") {
          setLoadError("This code isn't recognized.");
          return;
        }
        setResolution(data);
        if (data.services.length === 1) {
          setServiceId(data.services[0].id);
        }
      })
      .catch((err) => {
        setLoadError(err instanceof ApiError ? err.message : "This code isn't recognized.");
      });
  }, [code]);

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!resolution) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const entry = await publicApi.joinQueue(resolution.queue.id, {
        serviceId,
        customerName,
        customerPhone,
        idempotencyKey,
      });
      router.push(`/queue/t/${entry.publicToken}`);
    } catch (err) {
      setSubmitError(
        err instanceof ApiError ? err.message : "Something went wrong. Please try again.",
      );
      setSubmitting(false);
    }
  }

  if (loadError) {
    return (
      <Centered>
        <h1 className="text-xl font-semibold text-text-primary">Something went wrong</h1>
        <p className="text-text-secondary">{loadError}</p>
      </Centered>
    );
  }

  if (!resolution) {
    return (
      <Centered>
        <p className="text-text-secondary">Loading…</p>
      </Centered>
    );
  }

  if (resolution.queue.status !== "ACTIVE") {
    return (
      <Centered>
        <h1 className="text-2xl font-semibold text-text-primary">{resolution.tenant.name}</h1>
        <p className="text-text-secondary">
          {resolution.queue.status === "PAUSED"
            ? "This queue is temporarily paused. Please try again shortly."
            : "This queue is currently closed."}
        </p>
      </Centered>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col gap-6 bg-bg p-6">
      <div className="pt-8 text-center">
        <h1 className="text-2xl font-semibold text-text-primary">{resolution.tenant.name}</h1>
        <p className="text-text-secondary">{resolution.location.name}</p>
      </div>

      <Card className="flex flex-col gap-5">
        <h2 className="text-lg font-medium text-text-primary">Join the Queue</h2>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {resolution.services.length > 1 && (
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-sm font-medium text-text-primary">
                Select a service
              </legend>
              {resolution.services.map((service) => (
                <label
                  key={service.id}
                  className="flex items-center justify-between rounded-md border border-border px-4 py-3"
                >
                  <span className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="service"
                      value={service.id}
                      checked={serviceId === service.id}
                      onChange={() => setServiceId(service.id)}
                      required
                    />
                    {service.name}
                  </span>
                  <span className="text-sm text-text-secondary">
                    ~{service.durationMinutes} min
                  </span>
                </label>
              ))}
            </fieldset>
          )}

          <Input
            label="Your name"
            value={customerName}
            onChange={(e) => setCustomerName(e.target.value)}
            required
            autoComplete="name"
          />
          <Input
            label="Mobile number"
            type="tel"
            value={customerPhone}
            onChange={(e) => setCustomerPhone(e.target.value)}
            required
            autoComplete="tel"
            placeholder="021 123 4567"
          />

          {submitError && <p className="text-sm text-red-600">{submitError}</p>}

          <Button type="submit" disabled={submitting || !serviceId}>
            {submitting ? "Joining…" : "Join the Queue"}
          </Button>
        </form>
      </Card>
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
