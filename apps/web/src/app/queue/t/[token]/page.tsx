"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Badge, Button, Card, type BadgeTone } from "@queueflow/ui";
import type { PublicTicketSummary, QueueEntrySummary } from "@queueflow/types";
import { publicApi } from "../../../../lib/api-client";
import { TicketQrCode } from "../../../../components/TicketQrCode";
import { BusinessLogo } from "../../../../components/BusinessLogo";

const STATUS_COPY: Record<QueueEntrySummary["status"], { title: string; tone: BadgeTone }> = {
  WAITING: { title: "Waiting", tone: "info" },
  CALLED: { title: "You're next!", tone: "success" },
  SERVING: { title: "Being served", tone: "success" },
  COMPLETED: { title: "Completed", tone: "neutral" },
  CANCELLED: { title: "Cancelled", tone: "neutral" },
  SKIPPED: { title: "You'll be called again shortly", tone: "warning" },
  NO_SHOW: { title: "Missed your turn", tone: "danger" },
};

/**
 * The live ticket page (plan §12/§24) — SSE-updated, never trusts it caught
 * every event (G-27): the EventSource auto-reconnects on its own, and the
 * very next message re-syncs full current state rather than a diff.
 */
export default function TicketPage() {
  const params = useParams<{ token: string }>();
  const token = params.token;

  const [entry, setEntry] = useState<PublicTicketSummary | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  useEffect(() => {
    const source = new EventSource(publicApi.ticketEventsUrl(token));

    source.onmessage = (event) => {
      setReconnecting(false);
      try {
        const data: unknown = JSON.parse(event.data);
        if (data && typeof data === "object" && "status" in data) {
          setEntry(data as PublicTicketSummary);
        }
        // Anything else (the heartbeat ping) is deliberately ignored.
      } catch {
        // Not JSON — a heartbeat, or a transient bad frame. Ignore either way.
      }
    };
    source.onerror = () => {
      // EventSource reconnects on its own; if the token turns out to be
      // invalid the browser will keep retrying a 404 forever, so give the
      // customer a way out rather than an endless silent spinner.
      setReconnecting(true);
    };

    return () => source.close();
  }, [token]);

  useEffect(() => {
    if (!entry) {
      const timeout = setTimeout(() => setNotFound(true), 8000);
      return () => clearTimeout(timeout);
    }
  }, [entry]);

  async function handleLeaveQueue(): Promise<void> {
    // eslint-disable-next-line no-alert -- a real confirm dialog is the simplest correct UX here
    if (!window.confirm("Are you sure you want to leave the queue?")) return;
    setCancelling(true);
    try {
      const updated = await publicApi.cancelTicket(token);
      // The cancel response is the bare entry — keep the business header from before.
      setEntry((prev) => (prev ? { ...prev, ...updated } : prev));
    } finally {
      setCancelling(false);
    }
  }

  if (!entry) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-3 bg-bg p-8 text-center">
        <p className="text-text-secondary">Loading your ticket…</p>
        {notFound && (
          <p className="text-sm text-text-secondary">
            This is taking longer than expected — double check the link, or ask a staff member.
          </p>
        )}
      </main>
    );
  }

  const statusInfo = STATUS_COPY[entry.status];
  const canLeave = entry.status === "WAITING" || entry.status === "CALLED";
  const ticketUrl = typeof window !== "undefined" ? window.location.href : "";

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center gap-6 bg-bg p-6 pt-10 text-center">
      {reconnecting && (
        <p className="w-full rounded-md bg-amber-50 px-4 py-2 text-sm text-amber-700">
          Reconnecting…
        </p>
      )}

      {/* Phase 16 — whose queue this is: the business's name and logo. */}
      <div className="flex flex-col items-center gap-2">
        <BusinessLogo logoPath={entry.tenant.logoPath} name={entry.tenant.name} />
        <p className="text-lg font-medium text-text-primary">{entry.tenant.name}</p>
      </div>

      <Card className="flex w-full flex-col items-center gap-4">
        <Badge tone={statusInfo.tone}>{statusInfo.title}</Badge>
        <p className="text-6xl font-semibold text-text-primary">#{entry.ticketNumber}</p>

        {entry.status === "WAITING" && (
          <div className="text-text-secondary">
            {entry.position !== null && <p>{entry.position - 1} people ahead</p>}
            {entry.estimatedWaitMinutes !== null && (
              <p>Estimated wait ~{entry.estimatedWaitMinutes} minutes</p>
            )}
          </div>
        )}
        {entry.status === "CALLED" && (
          <p className="text-text-secondary">Please proceed to the counter.</p>
        )}

        {ticketUrl && <TicketQrCode url={ticketUrl} />}

        {canLeave && (
          <Button variant="destructive" onClick={handleLeaveQueue} disabled={cancelling}>
            {cancelling ? "Leaving…" : "Leave Queue"}
          </Button>
        )}
      </Card>
    </main>
  );
}
