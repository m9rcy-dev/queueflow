"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useParams, useRouter } from "next/navigation";
import { Badge, Button, Card, Input } from "@queueflow/ui";
import { ApiError } from "@queueflow/api-client";
import type {
  GuestCardSummary,
  QueueEntryStatus,
  QueueTodayStats,
  StaffQueueEntrySummary,
  TeamMemberOption,
} from "@queueflow/types";
import { staffApi } from "../../../../lib/staff-api-client";
import { useStaffSession } from "../../../../lib/use-staff-session";
import { AppShell } from "../../../../components/AppShell";

const POLL_MS = 3_000;

// Historical/terminal statuses aren't shown on the live working view — this
// is "today's active line," not an audit log (that's a future reporting
// concern, not Phase 5's).
const ACTIVE_STATUSES: QueueEntryStatus[] = ["WAITING", "CALLED", "SERVING", "SKIPPED"];

const STATUS_TONE: Record<QueueEntryStatus, "success" | "warning" | "info" | "neutral"> = {
  WAITING: "neutral",
  CALLED: "warning",
  SERVING: "success",
  SKIPPED: "info",
  COMPLETED: "neutral",
  CANCELLED: "neutral",
  NO_SHOW: "neutral",
};

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback;
}

export default function QueueDashboardPage() {
  const params = useParams<{ queueId: string }>();
  const queueId = params.queueId;
  const router = useRouter();
  const session = useStaffSession();

  const [entries, setEntries] = useState<StaffQueueEntrySummary[] | null>(null);
  const [services, setServices] = useState<Array<{ id: string; name: string }>>([]);
  const [banner, setBanner] = useState<{ tone: "error" | "info"; text: string } | null>(null);
  const [busyEntryId, setBusyEntryId] = useState<string | null>(null);
  const [callingNext, setCallingNext] = useState(false);
  const [showWalkInForm, setShowWalkInForm] = useState(false);
  const [deviceTrusting, setDeviceTrusting] = useState(false);
  const [locationId, setLocationId] = useState<string | null>(null);
  const [queueName, setQueueName] = useState<string | null>(null);
  const [team, setTeam] = useState<TeamMemberOption[]>([]);

  const refresh = useCallback(async () => {
    try {
      const result = await staffApi.listEntries(queueId);
      setEntries(result.filter((entry) => ACTIVE_STATUSES.includes(entry.status)));
    } catch {
      // A transient poll failure isn't worth interrupting the dashboard for — it'll succeed on the next tick.
    }
  }, [queueId]);

  useEffect(() => {
    if (!session) return;
    staffApi.listJoinableServices(queueId).then(setServices);
    staffApi.getQueue(queueId).then((queue) => {
      setLocationId(queue.locationId);
      setQueueName(queue.name);
      // Who could take over a customer here (Phase 17 hand-over).
      staffApi
        .listLocationTeam(queue.locationId)
        .then(setTeam)
        .catch(() => setTeam([]));
    });
    refresh();
    const interval = setInterval(refresh, POLL_MS);
    return () => clearInterval(interval);
  }, [session, queueId, refresh]);

  if (!session || !entries) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-bg text-text-secondary">
        Loading…
      </main>
    );
  }

  const waiting = entries.filter((e) => e.status === "WAITING");
  const inProgress = entries.filter((e) => e.status === "CALLED" || e.status === "SERVING");
  const skipped = entries.filter((e) => e.status === "SKIPPED");

  async function runAction<T>(entryId: string, action: () => Promise<T>): Promise<void> {
    setBusyEntryId(entryId);
    setBanner(null);
    try {
      await action();
      await refresh();
    } catch (err) {
      setBanner({ tone: "error", text: errorMessage(err, "Something went wrong.") });
    } finally {
      setBusyEntryId(null);
    }
  }

  async function handleCallNext(): Promise<void> {
    setCallingNext(true);
    setBanner(null);
    try {
      await staffApi.callNext(queueId);
      await refresh();
    } catch (err) {
      setBanner({
        tone: err instanceof ApiError && err.code === "QUEUE_EMPTY" ? "info" : "error",
        text: errorMessage(err, "Something went wrong."),
      });
    } finally {
      setCallingNext(false);
    }
  }

  async function handleTrustDevice(): Promise<void> {
    setDeviceTrusting(true);
    try {
      // Phase 16: the tablet belongs to this queue's location.
      await staffApi.trustDevice(locationId ?? undefined);
      setBanner({
        tone: "info",
        text: "This device is now trusted for quick staff PIN switching at this location.",
      });
    } catch (err) {
      setBanner({ tone: "error", text: errorMessage(err, "Couldn't trust this device.") });
    } finally {
      setDeviceTrusting(false);
    }
  }

  return (
    <AppShell
      session={session}
      title={queueName ?? "Queue"}
      actions={
        // Trust this device lives here, not in the profile menu: a counter
        // tablet belongs to this queue's location (ADR-015).
        <button
          type="button"
          onClick={handleTrustDevice}
          disabled={deviceTrusting}
          className="text-sm text-text-secondary underline"
        >
          Trust this device for this location
        </button>
      }
    >
      <TodayStatsBar queueId={queueId} />

      {banner && (
        <div
          className={
            banner.tone === "error"
              ? "rounded-md bg-red-50 px-4 py-3 text-sm text-red-700"
              : "rounded-md bg-blue-50 px-4 py-3 text-sm text-blue-700"
          }
        >
          {banner.text}
        </div>
      )}

      <div className="flex gap-3">
        <Button onClick={handleCallNext} disabled={callingNext || waiting.length === 0}>
          {callingNext
            ? "Calling…"
            : `Call Next${waiting.length > 0 ? ` (${waiting.length} waiting)` : ""}`}
        </Button>
        <Button variant="secondary" onClick={() => setShowWalkInForm((v) => !v)}>
          {showWalkInForm ? "Cancel" : "Add Walk-in"}
        </Button>
        <Button variant="secondary" onClick={() => router.push(`/admin/queues/${queueId}/scan`)}>
          Scan
        </Button>
        <Button
          variant="secondary"
          onClick={() => router.push(`/admin/queues/${queueId}/settings`)}
        >
          Settings
        </Button>
      </div>

      {showWalkInForm && (
        <WalkInForm
          services={services}
          onCancel={() => setShowWalkInForm(false)}
          onSubmit={async (input) => {
            await staffApi.addWalkIn(queueId, input);
            setShowWalkInForm(false);
            await refresh();
          }}
        />
      )}

      {locationId && <GuestCardsPanel locationId={locationId} />}

      <Section title="Now serving / called">
        {inProgress.length === 0 && <Empty>No one called yet.</Empty>}
        {inProgress.map((entry) => (
          <EntryRow
            key={entry.id}
            entry={entry}
            busy={busyEntryId === entry.id}
            handOver={{
              team,
              onSelect: (tenantUserId) =>
                runAction(entry.id, () => staffApi.handOver(entry.id, tenantUserId)),
            }}
            actions={
              entry.status === "CALLED"
                ? [
                    { label: "Start", onClick: () => staffApi.startEntry(entry.id) },
                    { label: "Recall", onClick: () => staffApi.recallEntry(entry.id) },
                    { label: "No Show", onClick: () => staffApi.noShowEntry(entry.id) },
                    {
                      label: "Cancel",
                      destructive: true,
                      onClick: () => staffApi.cancelEntry(entry.id),
                    },
                  ]
                : [{ label: "Complete", onClick: () => staffApi.completeEntry(entry.id) }]
            }
            onAction={(action) => runAction(entry.id, action)}
          />
        ))}
      </Section>

      <Section title="Waiting">
        {waiting.length === 0 && <Empty>No one waiting.</Empty>}
        {waiting.map((entry) => (
          <EntryRow
            key={entry.id}
            entry={entry}
            busy={busyEntryId === entry.id}
            actions={[
              { label: "Skip", onClick: () => staffApi.skipEntry(entry.id) },
              { label: "Cancel", destructive: true, onClick: () => staffApi.cancelEntry(entry.id) },
            ]}
            onAction={(action) => runAction(entry.id, action)}
          />
        ))}
      </Section>

      {skipped.length > 0 && (
        <Section title="Skipped">
          {skipped.map((entry) => (
            <EntryRow
              key={entry.id}
              entry={entry}
              busy={busyEntryId === entry.id}
              actions={[{ label: "Requeue", onClick: () => staffApi.requeueEntry(entry.id) }]}
              onAction={(action) => runAction(entry.id, action)}
            />
          ))}
        </Section>
      )}
    </AppShell>
  );
}

/** The live "today" dashboard (Phase 11, G-14) — refetched alongside the entry list, same POLL_MS cadence. */
function TodayStatsBar({ queueId }: { queueId: string }) {
  const [stats, setStats] = useState<QueueTodayStats | null>(null);

  const refresh = useCallback(async () => {
    try {
      setStats(await staffApi.getTodayStats(queueId));
    } catch {
      // Same "don't interrupt the dashboard over a transient poll failure" reasoning as the entry list.
    }
  }, [queueId]);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, POLL_MS);
    return () => clearInterval(interval);
  }, [refresh]);

  if (!stats) return null;

  return (
    <Card className="grid grid-cols-2 gap-4 p-4 sm:grid-cols-5">
      <Stat label="Waiting now" value={stats.waitingCount} />
      <Stat label="Served today" value={stats.servedCount} />
      <Stat label="Avg wait" value={stats.averageWaitMinutes} suffix=" min" />
      <Stat label="Avg service time" value={stats.averageServiceDurationMinutes} suffix=" min" />
      <Stat label="Abandoned / no-show" value={`${stats.abandonedCount} / ${stats.noShowCount}`} />
    </Card>
  );
}

function Stat({
  label,
  value,
  suffix = "",
}: {
  label: string;
  value: number | string | null;
  suffix?: string;
}) {
  return (
    <div className="flex flex-col">
      <span className="text-2xl font-semibold text-text-primary">
        {value === null ? "—" : `${value}${suffix}`}
      </span>
      <span className="text-xs text-text-secondary">{label}</span>
    </div>
  );
}

/** The location's guest-card pool (Phase 10, D-14) — how many cards exist and how many are currently out with a guest, plus a resize control. */
function GuestCardsPanel({ locationId }: { locationId: string }) {
  const [cards, setCards] = useState<GuestCardSummary[] | null>(null);
  const [poolSizeInput, setPoolSizeInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const result = await staffApi.listGuestCards(locationId);
    setCards(result);
    setPoolSizeInput(String(result.length));
  }, [locationId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function handleResize(event: FormEvent): Promise<void> {
    event.preventDefault();
    const poolSize = Number(poolSizeInput);
    if (!Number.isInteger(poolSize) || poolSize < 0) return;
    setSaving(true);
    setError(null);
    try {
      const result = await staffApi.resizeGuestCardPool(locationId, poolSize);
      setCards(result);
    } catch (err) {
      setError(errorMessage(err, "Couldn't resize the pool."));
    } finally {
      setSaving(false);
    }
  }

  if (!cards) return null;
  const inUseCount = cards.filter((c) => c.inUse).length;

  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium uppercase tracking-wide text-text-secondary">
          Guest cards
        </h2>
        <span className="text-sm text-text-secondary">
          {inUseCount} of {cards.length} in use
        </span>
      </div>
      {cards.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {cards.map((card) => (
            <span
              key={card.id}
              className={
                "rounded-md border px-2 py-1 text-xs " +
                (card.inUse
                  ? "border-amber-300 bg-amber-50 text-amber-700"
                  : "border-border text-text-secondary")
              }
            >
              Guest {card.guestNumber}
            </span>
          ))}
        </div>
      )}
      <form onSubmit={handleResize} className="flex items-end gap-2">
        <label className="flex flex-col gap-1 text-sm text-text-secondary">
          Pool size
          <input
            type="number"
            min={0}
            max={500}
            value={poolSizeInput}
            onChange={(e) => setPoolSizeInput(e.target.value)}
            className="w-24 rounded-md border border-border bg-surface px-3 py-2 text-text-primary"
          />
        </label>
        <Button type="submit" variant="secondary" disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </Button>
      </form>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </Card>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-medium uppercase tracking-wide text-text-secondary">{title}</h2>
      <div className="flex flex-col gap-2">{children}</div>
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-text-secondary">{children}</p>;
}

function EntryRow({
  entry,
  busy,
  actions,
  onAction,
  handOver,
}: {
  entry: StaffQueueEntrySummary;
  busy: boolean;
  actions: Array<{ label: string; destructive?: boolean; onClick: () => Promise<unknown> }>;
  onAction: (action: () => Promise<unknown>) => void;
  /** Phase 17 — only for called/in-progress customers: pass them to whoever is actually serving. */
  handOver?: { team: TeamMemberOption[]; onSelect: (tenantUserId: string) => void };
}) {
  // Who's doing the work (Phase 17): the hand-over/Start record wins over who called.
  const servingName = entry.servedByStaffName ?? entry.assignedStaffName;
  return (
    <Card className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <div className="flex items-center gap-2">
          <span className="text-lg font-semibold text-text-primary">#{entry.ticketNumber}</span>
          <Badge tone={STATUS_TONE[entry.status]}>{entry.status}</Badge>
          {/* Phase 14 — booked customers; "priority" once their window opened (G-25). The
              counter device sits at the location, so its own clock is the location's. */}
          {entry.appointmentStartsAt && (
            <Badge tone={entry.priorityActive ? "success" : "info"}>
              Appointment{" "}
              {new Date(entry.appointmentStartsAt).toLocaleTimeString([], {
                hour: "numeric",
                minute: "2-digit",
              })}
              {entry.priorityActive ? " · priority" : ""}
            </Badge>
          )}
        </div>
        <p className="text-sm text-text-secondary">
          {entry.customerName} · {entry.customerPhone}
          {entry.position !== null ? ` · position ${entry.position}` : ""}
          {servingName ? ` · with ${servingName}` : ""}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {handOver && handOver.team.length > 1 && (
          <label className="flex items-center gap-1.5 text-sm text-text-secondary">
            <span className="sr-only">Hand over #{entry.ticketNumber} to</span>
            <select
              value=""
              disabled={busy}
              onChange={(e) => e.target.value && handOver.onSelect(e.target.value)}
              className="min-h-[40px] rounded-md border border-border bg-surface px-2 text-sm text-text-primary"
            >
              <option value="">Hand over to…</option>
              {handOver.team
                .filter((member) => member.tenantUserId !== entry.servedByStaffId)
                .map((member) => (
                  <option key={member.tenantUserId} value={member.tenantUserId}>
                    {member.displayName}
                  </option>
                ))}
            </select>
          </label>
        )}
        {actions.map((action) => (
          <Button
            key={action.label}
            variant={action.destructive ? "destructive" : "secondary"}
            disabled={busy}
            onClick={() => onAction(action.onClick)}
            className="min-h-[40px] px-4 py-2 text-sm"
          >
            {action.label}
          </Button>
        ))}
      </div>
    </Card>
  );
}

function WalkInForm({
  services,
  onCancel,
  onSubmit,
}: {
  services: Array<{ id: string; name: string }>;
  onCancel: () => void;
  onSubmit: (input: {
    serviceId: string;
    customerName: string;
    customerPhone: string;
  }) => Promise<void>;
}) {
  const [serviceId, setServiceId] = useState(services[0]?.id ?? "");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit({ serviceId, customerName, customerPhone });
      setCustomerName("");
      setCustomerPhone("");
    } catch (err) {
      setError(errorMessage(err, "Something went wrong."));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card className="flex flex-col gap-4">
      <h2 className="text-lg font-medium text-text-primary">Add a walk-in</h2>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {services.length > 1 && (
          <label className="flex flex-col gap-1.5 text-sm font-medium text-text-primary">
            Service
            <select
              value={serviceId}
              onChange={(e) => setServiceId(e.target.value)}
              className="min-h-[48px] rounded-md border border-border bg-surface px-4 py-3 text-base text-text-primary"
              required
            >
              {services.map((service) => (
                <option key={service.id} value={service.id}>
                  {service.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <Input
          label="Customer name"
          value={customerName}
          onChange={(e) => setCustomerName(e.target.value)}
          required
        />
        <Input
          label="Mobile number"
          type="tel"
          value={customerPhone}
          onChange={(e) => setCustomerPhone(e.target.value)}
          required
          placeholder="021 123 4567"
        />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex gap-3">
          <Button type="submit" disabled={submitting || !serviceId}>
            {submitting ? "Adding…" : "Add to queue"}
          </Button>
          <Button type="button" variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  );
}
