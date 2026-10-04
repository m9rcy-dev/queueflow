"use client";

import { useEffect, useState } from "react";
import { Button, Card } from "@queueflow/ui";
import type { CustomerUpcomingAppointment } from "@queueflow/types";
import { customerApi } from "../../../../lib/customer-api-client";
import { useCustomerSession } from "../../../../lib/use-customer-session";
import { CustomerShell } from "../../../../components/CustomerShell";
import { TicketQrCode } from "../../../../components/TicketQrCode";
import { formatDateTimeIn } from "../../../../lib/appointment-format";

/**
 * QR Codes (Phase 17): the customer's personal code (show it at the
 * counter to join instantly, G-52) and each upcoming booking's check-in
 * code (D-12).
 */
export default function CustomerCodesPage() {
  const [summary, updateSummary] = useCustomerSession();
  const [appointments, setAppointments] = useState<CustomerUpcomingAppointment[]>([]);
  const [regenerating, setRegenerating] = useState(false);

  useEffect(() => {
    if (!summary) return;
    customerApi
      .getUpcomingAppointments()
      .catch(() => [])
      .then(setAppointments);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [summary !== null]);

  if (!summary) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-bg text-text-secondary">
        Loading…
      </main>
    );
  }

  const withCheckIn = appointments.filter((a) => a.checkInCode);

  return (
    <CustomerShell summary={summary} title="QR Codes">
      <Card className="flex flex-col items-center gap-3 text-center">
        <h2 className="text-lg font-medium text-text-primary">Your code</h2>
        <p className="text-sm text-text-secondary">
          Show this at the counter scanner to join the queue straight away.
        </p>
        <TicketQrCode url={summary.identityCode} alt="Your personal code" />
        <Button
          variant="secondary"
          disabled={regenerating}
          onClick={async () => {
            setRegenerating(true);
            try {
              const { publicCode } = await customerApi.regenerateIdentityCode();
              updateSummary((prev) => ({ ...prev, identityCode: publicCode }));
            } finally {
              setRegenerating(false);
            }
          }}
        >
          {regenerating ? "Getting a new code…" : "Lost or shared it? Get a new code"}
        </Button>
      </Card>

      {withCheckIn.map((appointment) => (
        <Card
          key={appointment.publicToken}
          className="flex flex-col items-center gap-2 text-center"
        >
          <h2 className="text-lg font-medium text-text-primary">Check-in code</h2>
          <p className="text-sm text-text-secondary">
            {appointment.service.name},{" "}
            {formatDateTimeIn(appointment.startsAt, appointment.timezone)}
          </p>
          <TicketQrCode
            url={appointment.checkInCode!}
            alt={`Check-in code for ${appointment.service.name}`}
          />
          <p className="text-xs text-text-secondary">Scan it at the counter when you arrive.</p>
        </Card>
      ))}
    </CustomerShell>
  );
}
