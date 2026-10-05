"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Badge, Button, Card, type BadgeTone } from "@queueflow/ui";
import type { CustomerVisit, QueueEntryStatus } from "@queueflow/types";
import { customerApi } from "../../../../lib/customer-api-client";
import { useCustomerSession } from "../../../../lib/use-customer-session";
import { CustomerShell } from "../../../../components/CustomerShell";

const STATUS_COPY: Record<QueueEntryStatus, { title: string; tone: BadgeTone }> = {
  WAITING: { title: "Waiting", tone: "info" },
  CALLED: { title: "You're next!", tone: "success" },
  SERVING: { title: "Being served", tone: "success" },
  COMPLETED: { title: "Completed", tone: "neutral" },
  CANCELLED: { title: "Cancelled", tone: "neutral" },
  SKIPPED: { title: "You'll be called again shortly", tone: "warning" },
  NO_SHOW: { title: "Missed your turn", tone: "danger" },
};

const ACTIVE: QueueEntryStatus[] = ["WAITING", "CALLED", "SERVING", "SKIPPED"];

/** Queues (Phase 17): anything live at the top (opens the live ticket), then the last 10 visits. */
export default function CustomerQueuesPage() {
  const [summary] = useCustomerSession();
  const [visits, setVisits] = useState<CustomerVisit[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  async function load(): Promise<void> {
    setVisits(await customerApi.getVisits().catch(() => []));
  }

  useEffect(() => {
    if (summary) void load();
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

  const live = visits.filter((v) => ACTIVE.includes(v.status));
  const past = visits.filter((v) => !ACTIVE.includes(v.status));
  const dateTime = (iso: string) =>
    new Date(iso).toLocaleString([], {
      day: "numeric",
      month: "short",
      hour: "numeric",
      minute: "2-digit",
    });

  return (
    <CustomerShell summary={summary} title="Visits">
      {live.length === 0 ? (
        <Card>
          <p className="text-text-secondary">
            You&apos;re not in a queue right now. Scan the QR poster at {summary.tenant.name}, or
            show your code (under QR Codes) at the counter.
          </p>
        </Card>
      ) : (
        live.map((visit) => (
          <Card key={visit.id} className="flex flex-col items-center gap-3 text-center">
            <Badge tone={STATUS_COPY[visit.status].tone}>{STATUS_COPY[visit.status].title}</Badge>
            <p className="text-4xl font-semibold text-text-primary">#{visit.ticketNumber}</p>
            <p className="text-text-secondary">
              {visit.serviceName} · {visit.queueName}, {visit.locationName}
            </p>
            {visit.publicToken && (
              <Link
                href={`/queue/t/${visit.publicToken}`}
                className="inline-flex min-h-[48px] items-center rounded-md bg-primary px-6 font-medium text-white hover:bg-primary-hover"
              >
                See your place in the queue
              </Link>
            )}
          </Card>
        ))
      )}

      <Card className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium uppercase tracking-wide text-text-secondary">
            Recent visits
          </h2>
          <Button
            variant="secondary"
            className="min-h-[36px] px-3 py-1 text-sm"
            disabled={refreshing}
            onClick={async () => {
              setRefreshing(true);
              await load();
              setRefreshing(false);
            }}
          >
            {refreshing ? "Refreshing…" : "Refresh"}
          </Button>
        </div>
        {past.length === 0 && <p className="text-sm text-text-secondary">No past visits yet.</p>}
        {past.map((visit) => (
          <div
            key={visit.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-4 py-3"
          >
            <div>
              <p className="font-medium text-text-primary">
                {visit.serviceName} · {visit.locationName}
              </p>
              <p className="text-sm text-text-secondary">
                {dateTime(visit.completedAt ?? visit.joinedAt)}
                {visit.servedByName ? ` · with ${visit.servedByName}` : ""}
              </p>
            </div>
            <Badge tone={STATUS_COPY[visit.status].tone}>{STATUS_COPY[visit.status].title}</Badge>
          </div>
        ))}
      </Card>
    </CustomerShell>
  );
}
