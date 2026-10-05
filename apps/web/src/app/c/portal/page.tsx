"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card } from "@queueflow/ui";
import type {
  CustomerLocationOption,
  CustomerUpcomingAppointment,
  CustomerVisit,
} from "@queueflow/types";
import { customerApi } from "../../../lib/customer-api-client";
import { useCustomerSession } from "../../../lib/use-customer-session";
import { CustomerShell } from "../../../components/CustomerShell";
import { CounterQrCode } from "../../../components/CounterQrCode";

const LIVE = ["WAITING", "CALLED", "SERVING", "SKIPPED"];

/**
 * The customer's home (Phase 19): everything they come for, on one screen —
 * a live ticket if they're in a queue, their personal code to show at the
 * counter, their next booking, and each location's "Join the queue" /
 * "Book an appointment" — so the account works without a poster in hand.
 */
export default function CustomerHomePage() {
  const [summary] = useCustomerSession();
  const [visits, setVisits] = useState<CustomerVisit[] | null>(null);
  const [bookings, setBookings] = useState<CustomerUpcomingAppointment[]>([]);
  const [locations, setLocations] = useState<CustomerLocationOption[]>([]);

  useEffect(() => {
    if (!summary) return;
    void Promise.all([
      customerApi.getVisits().catch(() => []),
      customerApi.getUpcomingAppointments().catch(() => []),
      customerApi.listLocations().catch(() => []),
    ]).then(([v, b, l]) => {
      setVisits(v);
      setBookings(b);
      setLocations(l);
    });
    // Only once the session exists.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [summary !== null]);

  if (!summary || !visits) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-bg text-text-secondary">
        Loading…
      </main>
    );
  }

  const live = visits.filter((visit) => LIVE.includes(visit.status) && visit.publicToken);
  const next = bookings[0];
  const name = summary.customer.firstName;

  return (
    <CustomerShell summary={summary} title={name ? `Hi ${name}` : "Home"}>
      {live.map((visit) => (
        <Link
          key={visit.id}
          href={`/queue/t/${visit.publicToken}`}
          className="flex items-center justify-between rounded-lg bg-primary px-5 py-4 text-white hover:bg-primary-hover"
        >
          <span>
            <span className="block text-sm opacity-90">You&apos;re in the queue</span>
            <span className="block text-2xl font-semibold">Ticket #{visit.ticketNumber}</span>
            <span className="block text-sm opacity-90">
              {visit.queueName} · {visit.locationName}
            </span>
          </span>
          <span aria-hidden="true" className="text-2xl">
            →
          </span>
        </Link>
      ))}

      <Card className="flex flex-col items-center gap-3 text-center">
        <h2 className="text-lg font-semibold text-text-primary">Your code</h2>
        <p className="text-sm text-text-secondary">
          Show it at the counter to join the queue straight away.
        </p>
        <CounterQrCode code={summary.identityCode} alt="Your personal code" />
      </Card>

      {next && (
        <Card className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold text-text-primary">Your next booking</h2>
          <Link
            href={`/appointment/${next.publicToken}`}
            className="flex items-center justify-between rounded-md border border-border px-4 py-3 hover:bg-bg"
          >
            <span>
              <span className="block font-medium text-text-primary">{next.service.name}</span>
              <span className="block text-sm text-text-secondary">
                {new Date(next.startsAt).toLocaleString([], {
                  weekday: "short",
                  day: "numeric",
                  month: "short",
                  hour: "numeric",
                  minute: "2-digit",
                })}{" "}
                · {next.location.name}
              </span>
            </span>
            <span className="text-sm text-primary">Check in / details →</span>
          </Link>
          {bookings.length > 1 && (
            <Link href="/c/portal/appointments" className="text-sm text-primary underline">
              All {bookings.length} bookings
            </Link>
          )}
        </Card>
      )}

      {locations.length > 0 && (
        <Card className="flex flex-col gap-4">
          <h2 className="text-lg font-semibold text-text-primary">Join or book</h2>
          {locations.map((location) => (
            <div
              key={location.id}
              className="flex flex-col gap-2 border-t border-border pt-3 first:border-0 first:pt-0"
            >
              <div>
                <p className="font-medium text-text-primary">{location.name}</p>
                {location.address && (
                  <p className="text-sm text-text-secondary">{location.address}</p>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                {location.queues.map((queue) =>
                  queue.status === "ACTIVE" ? (
                    <Link
                      key={queue.code}
                      href={`/q/${queue.code}`}
                      className="inline-flex min-h-[44px] items-center rounded-md bg-primary px-4 text-sm font-medium text-white hover:bg-primary-hover"
                    >
                      Join the queue{location.queues.length > 1 ? `: ${queue.name}` : ""}
                    </Link>
                  ) : (
                    <span
                      key={queue.code}
                      className="inline-flex min-h-[44px] items-center rounded-md border border-border px-4 text-sm text-text-secondary"
                    >
                      {queue.name}: {queue.status === "PAUSED" ? "paused" : "closed"}
                    </span>
                  ),
                )}
                {location.canBook && (
                  <Link
                    href={`/q/${location.queues[0].code}/book`}
                    className="inline-flex min-h-[44px] items-center rounded-md border border-border bg-surface px-4 text-sm font-medium text-text-primary hover:bg-bg"
                  >
                    Book an appointment
                  </Link>
                )}
              </div>
            </div>
          ))}
        </Card>
      )}
    </CustomerShell>
  );
}
