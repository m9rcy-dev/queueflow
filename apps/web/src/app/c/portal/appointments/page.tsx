"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card } from "@queueflow/ui";
import type { CustomerUpcomingAppointment } from "@queueflow/types";
import { customerApi } from "../../../../lib/customer-api-client";
import { useCustomerSession } from "../../../../lib/use-customer-session";
import { CustomerShell } from "../../../../components/CustomerShell";
import { formatDateTimeIn } from "../../../../lib/appointment-format";

/** Appointments (Phase 17): upcoming bookings, each opening its own page (check in, cancel). */
export default function CustomerAppointmentsPage() {
  const [summary] = useCustomerSession();
  const [appointments, setAppointments] = useState<CustomerUpcomingAppointment[] | null>(null);

  useEffect(() => {
    if (!summary) return;
    customerApi
      .getUpcomingAppointments()
      .catch(() => [])
      .then(setAppointments);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [summary !== null]);

  if (!summary || !appointments) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-bg text-text-secondary">
        Loading…
      </main>
    );
  }

  return (
    <CustomerShell summary={summary} title="Appointments">
      {appointments.length === 0 ? (
        <Card>
          <p className="text-text-secondary">
            No upcoming appointments. To book, scan the QR poster at {summary.tenant.name} and
            choose &ldquo;Book an appointment&rdquo;.
          </p>
        </Card>
      ) : (
        <Card className="flex flex-col gap-3">
          {appointments.map((appointment) => (
            <Link
              key={appointment.publicToken}
              href={`/appointment/${appointment.publicToken}`}
              className="rounded-md border border-border px-4 py-3 hover:bg-bg"
            >
              <p className="font-medium text-text-primary">
                {formatDateTimeIn(appointment.startsAt, appointment.timezone)}
              </p>
              <p className="text-sm text-text-secondary">
                {appointment.service.name} · {appointment.location.name}
                {appointment.canCheckIn ? " · today, you can check in" : ""}
              </p>
            </Link>
          ))}
        </Card>
      )}
    </CustomerShell>
  );
}
