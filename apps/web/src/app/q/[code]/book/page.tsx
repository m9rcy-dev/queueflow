"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useParams, useRouter } from "next/navigation";
import { Button, Card, Input } from "@queueflow/ui";
import { ApiError } from "@queueflow/api-client";
import type { AppointmentSlot, QueueCodeResolution } from "@queueflow/types";
import { publicApi } from "../../../../lib/api-client";
import { addDaysTo, formatLocalDate } from "../../../../lib/appointment-format";
import { BusinessLogo } from "../../../../components/BusinessLogo";
import { SavedVisitBanner } from "../../../../components/SavedVisitBanner";
import { newRequestId } from "../../../../lib/request-id";
import { useCustomerPrefill } from "../../../../lib/use-customer-prefill";
import { saveVisit } from "../../../../lib/saved-visits";
import { PoweredByQueueFlow } from "../../../../components/QueueFlowLogo";

const DAYS_SHOWN = 14;

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback;
}

/** The browser's own today. The server applies the location's timezone, lead time, and booking window to whatever date is picked. */
function browserToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/**
 * Booking ahead from a QUEUE poster (Phase 13, plan §35): pick a service,
 * a day, and one of the server-computed times, then name + mobile, the same
 * as a walk-in join. No account needed. The confirmation lands on the
 * appointment's own manage page.
 */
export default function BookAppointmentPage() {
  const params = useParams<{ code: string }>();
  const code = params.code;
  const router = useRouter();

  const [resolution, setResolution] = useState<QueueCodeResolution | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [serviceId, setServiceId] = useState("");
  const [days] = useState(() =>
    Array.from({ length: DAYS_SHOWN }, (_, i) => addDaysTo(browserToday(), i)),
  );
  const [date, setDate] = useState(days[0]);
  const [slots, setSlots] = useState<AppointmentSlot[] | null>(null);
  const [startsAt, setStartsAt] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  // Phase 19: the confirmation (with an add-to-calendar link) and reminders go here.
  const [customerEmail, setCustomerEmail] = useState("");
  // Phase 19: signed in at this business? Fill in their details.
  const prefill = useCustomerPrefill(resolution?.tenant.id);
  useEffect(() => {
    if (!prefill) return;
    setCustomerName((current) => current || prefill.name);
    setCustomerPhone((current) => current || prefill.phone);
    setCustomerEmail((current) => current || prefill.email);
  }, [prefill]);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  // Same G-21 rule as joining: the browser makes a retried booking idempotent.
  const [idempotencyKey] = useState(newRequestId);

  useEffect(() => {
    publicApi
      .resolveCode(code)
      .then((data) => {
        if (data.contextType !== "QUEUE" || !data.capabilities.includes("BOOK_APPOINTMENT")) {
          setLoadError("Appointments can't be booked here.");
          return;
        }
        setResolution(data);
        if (data.appointmentServices.length === 1) setServiceId(data.appointmentServices[0].id);
      })
      .catch((err) => setLoadError(errorMessage(err, "This code isn't recognized.")));
  }, [code]);

  useEffect(() => {
    if (!resolution || !serviceId) return;
    setSlots(null);
    setStartsAt("");
    publicApi
      .getAppointmentAvailability(resolution.location.id, serviceId, date)
      .then((availability) => setSlots(availability.slots))
      .catch((err) => {
        setSlots([]);
        setSubmitError(errorMessage(err, "Couldn't load available times."));
      });
  }, [resolution, serviceId, date]);

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!resolution) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const booking = await publicApi.bookAppointment(resolution.location.id, {
        serviceId,
        startsAt,
        customerName,
        customerPhone,
        idempotencyKey,
        customerEmail: customerEmail.trim(),
      });
      saveVisit({
        kind: "appointment",
        token: booking.publicToken,
        scopeId: resolution.location.id,
      });
      router.push(`/appointment/${booking.publicToken}`);
    } catch (err) {
      setSubmitError(errorMessage(err, "Something went wrong. Please try again."));
      setSubmitting(false);
      // A taken slot means the list is stale — refresh it.
      if (err instanceof ApiError && err.code === "SLOT_UNAVAILABLE") {
        const availability = await publicApi
          .getAppointmentAvailability(resolution.location.id, serviceId, date)
          .catch(() => null);
        if (availability) setSlots(availability.slots);
        setStartsAt("");
      }
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

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col gap-6 bg-bg p-6">
      <div className="pt-8 text-center">
        <BusinessLogo logoPath={resolution.tenant.logoPath} name={resolution.tenant.name} />
        <h1 className="text-2xl font-semibold text-text-primary">{resolution.tenant.name}</h1>
        <p className="text-text-secondary">{resolution.location.name}</p>
      </div>

      <SavedVisitBanner kind="appointment" scopeId={resolution.location.id} />

      <Card className="flex flex-col gap-5">
        <h2 className="text-lg font-medium text-text-primary">Book an appointment</h2>

        <form onSubmit={handleSubmit} className="flex flex-col gap-5">
          {resolution.appointmentServices.length > 1 && (
            <fieldset className="flex min-w-0 flex-col gap-2">
              <legend className="mb-1 text-sm font-medium text-text-primary">
                Select a service
              </legend>
              {resolution.appointmentServices.map((service) => (
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
                  <span className="text-sm text-text-secondary">{service.durationMinutes} min</span>
                </label>
              ))}
            </fieldset>
          )}

          {serviceId && (
            <fieldset className="flex min-w-0 flex-col gap-2">
              <legend className="mb-1 text-sm font-medium text-text-primary">Day</legend>
              <div className="flex gap-2 overflow-x-auto pb-1">
                {days.map((day) => (
                  <button
                    key={day}
                    type="button"
                    onClick={() => setDate(day)}
                    aria-pressed={day === date}
                    className={[
                      "min-h-[48px] shrink-0 rounded-md border px-3 text-sm",
                      day === date
                        ? "border-primary bg-primary text-white"
                        : "border-border bg-surface text-text-primary",
                    ].join(" ")}
                  >
                    {formatLocalDate(day)}
                  </button>
                ))}
              </div>
            </fieldset>
          )}

          {serviceId && (
            <fieldset className="flex min-w-0 flex-col gap-2">
              <legend className="mb-1 text-sm font-medium text-text-primary">Time</legend>
              {slots === null && <p className="text-sm text-text-secondary">Loading times…</p>}
              {slots?.length === 0 && (
                <p className="text-sm text-text-secondary">
                  No times available on this day. Try another day.
                </p>
              )}
              {slots && slots.length > 0 && (
                <div className="grid grid-cols-3 gap-2">
                  {slots.map((slot) => (
                    <button
                      key={slot.startsAt}
                      type="button"
                      onClick={() => setStartsAt(slot.startsAt)}
                      aria-pressed={slot.startsAt === startsAt}
                      className={[
                        "min-h-[48px] rounded-md border text-sm",
                        slot.startsAt === startsAt
                          ? "border-primary bg-primary text-white"
                          : "border-border bg-surface text-text-primary",
                      ].join(" ")}
                    >
                      {slot.localTime}
                    </button>
                  ))}
                </div>
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
            label="Email"
            type="email"
            value={customerEmail}
            onChange={(e) => setCustomerEmail(e.target.value)}
            required
            autoComplete="email"
            placeholder="you@example.com"
          />
          <p className="-mt-3 text-xs text-text-secondary">
            Your confirmation goes here, with a link to add it to your calendar and to check in or
            cancel.
          </p>

          {submitError && (
            <p role="alert" className="text-sm text-red-600">
              {submitError}
            </p>
          )}

          <Button type="submit" disabled={submitting || !startsAt}>
            {submitting ? "Booking…" : "Book"}
          </Button>
        </form>
      </Card>
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
