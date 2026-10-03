"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, Card, type BadgeTone } from "@queueflow/ui";
import type {
  CustomerActiveEntry,
  CustomerPortalSummary,
  QueueEntryStatus,
} from "@queueflow/types";
import { customerApi } from "../../../lib/customer-api-client";
import { TicketQrCode } from "../../../components/TicketQrCode";

const STATUS_COPY: Record<QueueEntryStatus, { title: string; tone: BadgeTone }> = {
  WAITING: { title: "Waiting", tone: "info" },
  CALLED: { title: "You're next!", tone: "success" },
  SERVING: { title: "Being served", tone: "success" },
  COMPLETED: { title: "Completed", tone: "neutral" },
  CANCELLED: { title: "Cancelled", tone: "neutral" },
  SKIPPED: { title: "You'll be called again shortly", tone: "warning" },
  NO_SHOW: { title: "Missed your turn", tone: "danger" },
};

/**
 * The customer's own portal (Phase 9, G-55) — their personal identity code
 * (G-52) plus whatever they're currently queued for at this business. Not
 * SSE-live like the anonymous ticket page (queue/t/[token]) — a customer
 * lands here from their own bookmark/app, not a fresh scan, so a plain
 * fetch-on-load plus a manual refresh is enough for Phase 9's scope.
 */
export default function CustomerPortalPage() {
  const router = useRouter();
  const [summary, setSummary] = useState<CustomerPortalSummary | null>(null);
  const [activeEntry, setActiveEntry] = useState<CustomerActiveEntry | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [regenerating, setRegenerating] = useState(false);

  useEffect(() => {
    (async () => {
      const restored = await customerApi.restoreSession().catch(() => null);
      if (!restored) {
        router.push("/");
        return;
      }
      setSummary(restored);
      const entry = await customerApi.getActiveEntry().catch(() => null);
      setActiveEntry(entry);
      setLoading(false);
    })();
    // `router` from useRouter() is a stable reference across re-renders in
    // the App Router — safe to run this effect once per mount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleRefresh(): Promise<void> {
    setRefreshing(true);
    try {
      const entry = await customerApi.getActiveEntry().catch(() => null);
      setActiveEntry(entry);
    } finally {
      setRefreshing(false);
    }
  }

  async function handleRegenerate(): Promise<void> {
    setRegenerating(true);
    try {
      const { publicCode } = await customerApi.regenerateIdentityCode();
      setSummary((prev) => (prev ? { ...prev, identityCode: publicCode } : prev));
    } finally {
      setRegenerating(false);
    }
  }

  async function handleLogout(): Promise<void> {
    await customerApi.logout();
    router.push("/");
  }

  if (loading || !summary) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-bg p-8 text-center text-text-secondary">
        Loading…
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center gap-6 bg-bg p-6 pt-10 text-center">
      <div>
        <h1 className="text-2xl font-semibold text-text-primary">{summary.tenant.name}</h1>
        <p className="text-text-secondary">Hi, {summary.customer.firstName ?? "there"}</p>
      </div>

      {activeEntry && (
        <Card className="flex w-full flex-col items-center gap-3">
          <Badge tone={STATUS_COPY[activeEntry.status].tone}>
            {STATUS_COPY[activeEntry.status].title}
          </Badge>
          <p className="text-4xl font-semibold text-text-primary">#{activeEntry.ticketNumber}</p>
          <p className="text-text-secondary">{activeEntry.queueName}</p>
          {activeEntry.status === "WAITING" && (
            <div className="text-sm text-text-secondary">
              {activeEntry.position !== null && <p>{activeEntry.position - 1} people ahead</p>}
              {activeEntry.estimatedWaitMinutes !== null && (
                <p>Estimated wait ~{activeEntry.estimatedWaitMinutes} minutes</p>
              )}
            </div>
          )}
          <Button variant="secondary" onClick={handleRefresh} disabled={refreshing}>
            {refreshing ? "Refreshing…" : "Refresh"}
          </Button>
        </Card>
      )}

      <Card className="flex w-full flex-col items-center gap-3">
        <h2 className="text-lg font-medium text-text-primary">Your code</h2>
        <p className="text-sm text-text-secondary">
          Show this at the counter to check in faster next time.
        </p>
        <TicketQrCode url={summary.identityCode} />
        {/* Phase 12 (G-39): this code is now a long, high-entropy token, not
            the short printed alphabet it used to be — meant to be scanned,
            not read aloud or typed, so it's shown small and allowed to wrap
            rather than forced onto one line. */}
        <p className="max-w-full break-all px-4 text-center font-mono text-xs text-text-secondary">
          {summary.identityCode}
        </p>
        <Button variant="secondary" onClick={handleRegenerate} disabled={regenerating}>
          {regenerating ? "Regenerating…" : "Lost or shared it? Get a new code"}
        </Button>
      </Card>

      <button
        type="button"
        onClick={handleLogout}
        className="text-sm text-text-secondary underline"
      >
        Log out
      </button>
    </main>
  );
}
