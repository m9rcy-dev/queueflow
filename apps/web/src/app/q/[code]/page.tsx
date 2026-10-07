"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { Button, Card, Input } from "@queueflow/ui";
import { ApiError } from "@queueflow/api-client";
import type { QueueCodeResolution } from "@queueflow/types";
import { publicApi } from "../../../lib/api-client";
import { BusinessLogo } from "../../../components/BusinessLogo";
import { SavedVisitBanner } from "../../../components/SavedVisitBanner";
import { newRequestId } from "../../../lib/request-id";
import { useCustomerPrefill } from "../../../lib/use-customer-prefill";
import { saveVisit } from "../../../lib/saved-visits";
import { PoweredByQueueFlow } from "../../../components/QueueFlowLogo";

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
  // Phase 19: optional — the ticket link is emailed so it can't be lost.
  const [customerEmail, setCustomerEmail] = useState("");
  // Phase 19: signed in at this business? Fill in their details.
  const prefill = useCustomerPrefill(resolution?.tenant.id);
  useEffect(() => {
    if (!prefill) return;
    setCustomerName((current) => current || prefill.name);
    setCustomerPhone((current) => current || prefill.phone);
    setCustomerEmail((current) => current || prefill.email);
  }, [prefill]);
  // Phase 18: "" = anyone, else a tenantUserId of someone on shift now.
  const [preferredStaffId, setPreferredStaffId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  // Generated once per page load and reused across retries — the browser,
  // not the server, is what makes a retried join idempotent (G-21).
  const [idempotencyKey] = useState(newRequestId);

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
        preferredStaffId: preferredStaffId || null,
        customerEmail: customerEmail.trim() || undefined,
      });
      saveVisit({ kind: "ticket", token: entry.publicToken, scopeId: resolution.queue.id });
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

  // Phase 13 — the same poster also offers booking ahead, when the business takes appointments.
  const bookingLink = resolution.capabilities.includes("BOOK_APPOINTMENT") ? (
    <Link
      href={`/q/${code}/book`}
      className="inline-flex min-h-[48px] items-center justify-center rounded-md border border-border bg-surface px-6 py-3 text-base font-medium text-text-primary hover:bg-bg"
    >
      Book an appointment instead
    </Link>
  ) : null;

  if (resolution.queue.status !== "ACTIVE") {
    return (
      <Centered>
        <BusinessLogo logoPath={resolution.tenant.logoPath} name={resolution.tenant.name} />
        <h1 className="text-2xl font-semibold text-text-primary">{resolution.tenant.name}</h1>
        <p className="text-text-secondary">
          {resolution.queue.status === "PAUSED"
            ? "This queue is temporarily paused. Please try again shortly."
            : "This queue is currently closed."}
        </p>
        {bookingLink}
      </Centered>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col gap-6 bg-bg p-6">
      <div className="pt-8 text-center">
        <BusinessLogo logoPath={resolution.tenant.logoPath} name={resolution.tenant.name} />
        <h1 className="text-2xl font-semibold text-text-primary">{resolution.tenant.name}</h1>
        <p className="text-text-secondary">{resolution.location.name}</p>
      </div>

      <SavedVisitBanner kind="ticket" scopeId={resolution.queue.id} />

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

          {resolution.onShiftStaff.length > 0 && (
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-sm font-medium text-text-primary">
                Who would you like?
              </legend>
              <div className="flex flex-wrap gap-2">
                {[{ tenantUserId: "", name: "Anyone (quickest)" }, ...resolution.onShiftStaff].map(
                  (staff) => (
                    <label
                      key={staff.tenantUserId || "anyone"}
                      className={`cursor-pointer rounded-full border px-4 py-2 text-sm ${
                        preferredStaffId === staff.tenantUserId
                          ? "border-primary bg-primary/10 font-semibold text-primary"
                          : "border-border text-text-primary"
                      }`}
                    >
                      <input
                        type="radio"
                        name="preferredStaff"
                        className="sr-only"
                        value={staff.tenantUserId}
                        checked={preferredStaffId === staff.tenantUserId}
                        onChange={() => setPreferredStaffId(staff.tenantUserId)}
                      />
                      {staff.name}
                    </label>
                  ),
                )}
              </div>
              {preferredStaffId && (
                <p className="text-xs text-text-secondary">
                  You keep your place in line. If someone else is free first, the next customer goes
                  ahead and you&apos;re seen when your choice is free.
                </p>
              )}
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
          <Input
            label="Email (recommended)"
            type="email"
            value={customerEmail}
            onChange={(e) => setCustomerEmail(e.target.value)}
            autoComplete="email"
            placeholder="you@example.com"
          />
          <p className="-mt-2 text-xs text-text-secondary">
            Add it to get a message when it&apos;s nearly your turn, plus your ticket and QR code to
            keep.
          </p>

          {submitError && <p className="text-sm text-red-600">{submitError}</p>}

          <Button type="submit" disabled={submitting || !serviceId}>
            {submitting ? "Joining…" : "Join the Queue"}
          </Button>
        </form>
      </Card>
      {bookingLink}
      <footer className="mt-auto flex justify-center pt-4">
        <PoweredByQueueFlow />
      </footer>
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
