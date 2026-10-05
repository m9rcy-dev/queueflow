"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { Badge, Button, Card } from "@queueflow/ui";
import { ApiError } from "@queueflow/api-client";
import type { PublicAppointmentSummary } from "@queueflow/types";
import { publicApi } from "../../../lib/api-client";
import { formatDateTimeIn } from "../../../lib/appointment-format";
import { CounterQrCode } from "../../../components/CounterQrCode";
import { AddToCalendar } from "../../../components/AddToCalendar";
import { BusinessLogo } from "../../../components/BusinessLogo";
import { PoweredByQueueFlow } from "../../../components/QueueFlowLogo";

/**
 * An appointment's own page (Phase 13), reached from the booking
 * confirmation or the link in the booked notification. The secret token in
 * the URL is the only credential (G-45), the same as a queue ticket.
 * Cancelling asks for confirmation inline; the server enforces the notice
 * window (§76) whatever this page shows.
 */
export default function AppointmentPage() {
  const params = useParams<{ token: string }>();
  const token = params.token;
  const router = useRouter();

  const [appointment, setAppointment] = useState<PublicAppointmentSummary | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checkingIn, setCheckingIn] = useState(false);
  const [checkInError, setCheckInError] = useState<string | null>(null);

  useEffect(() => {
    publicApi
      .getAppointment(token)
      .then(setAppointment)
      .catch(() => setNotFound(true));
  }, [token]);

  async function handleCancel(): Promise<void> {
    setCancelling(true);
    setError(null);
    try {
      setAppointment(await publicApi.cancelAppointment(token));
      setConfirming(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
    } finally {
      setCancelling(false);
    }
  }

  async function handleCheckIn(): Promise<void> {
    setCheckingIn(true);
    setCheckInError(null);
    try {
      const ticket = await publicApi.checkInAppointment(token);
      router.push(`/queue/t/${ticket.publicToken}`);
    } catch (err) {
      setCheckInError(
        err instanceof ApiError ? err.message : "Something went wrong. Please try again.",
      );
      setCheckingIn(false);
    }
  }

  if (notFound) {
    return (
      <Centered>
        <h1 className="text-xl font-semibold text-text-primary">Appointment not found</h1>
        <p className="text-text-secondary">Check the link you were sent.</p>
      </Centered>
    );
  }

  if (!appointment) {
    return (
      <Centered>
        <p className="text-text-secondary">Loading…</p>
      </Centered>
    );
  }

  const isBooked = appointment.status === "BOOKED";
  const STATUS_LABEL: Record<PublicAppointmentSummary["status"], string> = {
    BOOKED: "Booked",
    CANCELLED: "Cancelled",
    CHECKED_IN: "Checked in",
    NO_SHOW: "Missed",
  };

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col gap-6 bg-bg p-6">
      <div className="pt-8 text-center">
        <BusinessLogo logoPath={appointment.tenant.logoPath} name={appointment.tenant.name} />
        <h1 className="text-2xl font-semibold text-text-primary">{appointment.tenant.name}</h1>
        <p className="text-text-secondary">{appointment.location.name}</p>
      </div>

      <Card className="flex flex-col items-center gap-3 text-center">
        <Badge
          tone={
            appointment.status === "BOOKED" || appointment.status === "CHECKED_IN"
              ? "success"
              : appointment.status === "NO_SHOW"
                ? "warning"
                : "neutral"
          }
        >
          {STATUS_LABEL[appointment.status]}
        </Badge>
        <p className="text-xl font-semibold text-text-primary">
          {formatDateTimeIn(appointment.startsAt, appointment.timezone)}
        </p>
        <p className="text-text-secondary">
          {appointment.service.name} · {appointment.service.durationMinutes} min
        </p>
        {appointment.location.address && (
          <p className="text-sm text-text-secondary">{appointment.location.address}</p>
        )}
      </Card>

      {/* Phase 19 — keep it: in the customer's own calendar, linking back here. */}
      {appointment.status === "BOOKED" && (
        <AddToCalendar
          title={`${appointment.service.name} — ${appointment.tenant.name}`}
          startsAt={appointment.startsAt}
          endsAt={appointment.endsAt}
          location={[
            appointment.tenant.name,
            appointment.location.name,
            appointment.location.address,
          ]
            .filter(Boolean)
            .join(", ")}
          token={token}
        />
      )}

      {/* Phase 14 — check in when you arrive: tap here, or show the code at the counter (D-12). */}
      {appointment.canCheckIn && (
        <Card className="flex flex-col items-center gap-3 text-center">
          <p className="text-text-primary">Here already?</p>
          <Button onClick={handleCheckIn} disabled={checkingIn} className="w-full">
            {checkingIn ? "Checking in…" : "I'm here, check me in"}
          </Button>
          {checkInError && (
            <p role="alert" className="text-sm text-red-600">
              {checkInError}
            </p>
          )}
        </Card>
      )}
      {appointment.checkInCode && (
        <Card className="flex flex-col items-center gap-2 text-center">
          <p className="text-sm text-text-secondary">Or scan this at the counter when you arrive</p>
          <CounterQrCode code={appointment.checkInCode} alt="Your check-in code" />
        </Card>
      )}
      {appointment.queueTicketToken && (
        <Link
          href={`/queue/t/${appointment.queueTicketToken}`}
          className="inline-flex min-h-[48px] items-center justify-center rounded-md bg-primary px-6 py-3 text-base font-medium text-white hover:bg-primary-hover"
        >
          See your place in the queue
        </Link>
      )}
      {appointment.status === "NO_SHOW" && (
        <p className="text-center text-sm text-text-secondary">
          This appointment was marked as missed. If you&apos;re here, please see the counter.
        </p>
      )}

      {isBooked && appointment.canCancel && !confirming && (
        <Button variant="secondary" onClick={() => setConfirming(true)}>
          Cancel appointment
        </Button>
      )}

      {confirming && (
        <Card className="flex flex-col gap-3">
          <p className="text-text-primary">Cancel this appointment?</p>
          {error && (
            <p role="alert" className="text-sm text-red-600">
              {error}
            </p>
          )}
          <div className="flex gap-3">
            <Button variant="destructive" onClick={handleCancel} disabled={cancelling}>
              {cancelling ? "Cancelling…" : "Yes, cancel"}
            </Button>
            <Button variant="secondary" onClick={() => setConfirming(false)}>
              Keep it
            </Button>
          </div>
        </Card>
      )}

      {isBooked && !appointment.canCancel && (
        <p className="text-center text-sm text-text-secondary">
          It&apos;s too close to your appointment to cancel online. Please contact the business.
        </p>
      )}
      {isBooked && appointment.canCancel && (
        <p className="text-center text-sm text-text-secondary">
          You can cancel online until{" "}
          {formatDateTimeIn(appointment.cancelDeadline, appointment.timezone)}.
        </p>
      )}
      {appointment.status === "CANCELLED" &&
        appointment.cancellationReason !== "CUSTOMER_REQUESTED" && (
          <p className="text-center text-sm text-text-secondary">
            The business cancelled this appointment.
          </p>
        )}
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
