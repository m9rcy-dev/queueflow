"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Badge, Button, Card } from "@queueflow/ui";
import { ApiError } from "@queueflow/api-client";
import type { PublicAppointmentSummary } from "@queueflow/types";
import { publicApi } from "../../../lib/api-client";
import { formatDateTimeIn } from "../../../lib/appointment-format";

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

  const [appointment, setAppointment] = useState<PublicAppointmentSummary | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col gap-6 bg-bg p-6">
      <div className="pt-8 text-center">
        <h1 className="text-2xl font-semibold text-text-primary">{appointment.tenant.name}</h1>
        <p className="text-text-secondary">{appointment.location.name}</p>
      </div>

      <Card className="flex flex-col items-center gap-3 text-center">
        <Badge tone={isBooked ? "success" : "neutral"}>{isBooked ? "Booked" : "Cancelled"}</Badge>
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
      {!isBooked && appointment.cancellationReason !== "CUSTOMER_REQUESTED" && (
        <p className="text-center text-sm text-text-secondary">
          The business cancelled this appointment.
        </p>
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
