"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { publicApi } from "../lib/api-client";
import { forgetVisit, savedVisits, type SavedVisit } from "../lib/saved-visits";

interface LiveVisit {
  href: string;
  label: string;
}

const ACTIVE_TICKET = ["WAITING", "CALLED", "SERVING", "SKIPPED"];

/**
 * "You're already in this queue — open ticket #12" (Phase 19): brings a
 * customer back to the ticket or booking this browser made from the same
 * poster, after a closed tab or the back button. Finished ones are
 * forgotten as they're found.
 */
export function SavedVisitBanner({ kind, scopeId }: { kind: SavedVisit["kind"]; scopeId: string }) {
  const [live, setLive] = useState<LiveVisit[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const found: LiveVisit[] = [];
      for (const visit of savedVisits(kind, scopeId)) {
        try {
          if (visit.kind === "ticket") {
            const ticket = await publicApi.getTicket(visit.token);
            if (ACTIVE_TICKET.includes(ticket.status)) {
              found.push({
                href: `/queue/t/${visit.token}`,
                label: `Your ticket #${ticket.ticketNumber}`,
              });
            } else forgetVisit(visit.token);
          } else {
            const booking = await publicApi.getAppointment(visit.token);
            if (
              (booking.status === "BOOKED" || booking.status === "CHECKED_IN") &&
              new Date(booking.endsAt) > new Date()
            ) {
              const when = new Date(booking.startsAt).toLocaleString([], {
                weekday: "short",
                day: "numeric",
                month: "short",
                hour: "numeric",
                minute: "2-digit",
              });
              found.push({
                href: `/appointment/${visit.token}`,
                label: `Your ${booking.service.name}, ${when}`,
              });
            } else forgetVisit(visit.token);
          }
        } catch {
          forgetVisit(visit.token); // gone or unreadable
        }
      }
      if (!cancelled) setLive(found);
    })();
    return () => {
      cancelled = true;
    };
  }, [kind, scopeId]);

  if (live.length === 0) return null;
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-primary/40 bg-primary/5 p-4">
      <p className="text-sm font-medium text-text-primary">
        {kind === "ticket" ? "You're already in this queue" : "You have a booking here"}
      </p>
      {live.map((visit) => (
        <Link
          key={visit.href}
          href={visit.href}
          className="inline-flex min-h-[44px] items-center justify-between rounded-md bg-primary px-4 text-sm font-medium text-white hover:bg-primary-hover"
        >
          {visit.label}
          <span aria-hidden="true">→</span>
        </Link>
      ))}
    </div>
  );
}
