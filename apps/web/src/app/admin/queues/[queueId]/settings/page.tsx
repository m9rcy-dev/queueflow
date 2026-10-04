"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useParams, useRouter } from "next/navigation";
import { Badge, Button, Card, Input } from "@queueflow/ui";
import { ApiError } from "@queueflow/api-client";
import type { CodeSummary, QueueStatus, QueueSummary, ServiceSummary } from "@queueflow/types";
import { staffApi } from "../../../../../lib/staff-api-client";
import { useStaffSession } from "../../../../../lib/use-staff-session";
import { AppShell } from "../../../../../components/AppShell";
import { TicketQrCode } from "../../../../../components/TicketQrCode";

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback;
}

const CONFIG_FIELDS = [
  { key: "servingCapacity", label: "Serving capacity (chairs/counters)" },
  { key: "maxActiveTicketsPerCustomer", label: "Max active tickets per customer" },
  { key: "maxRecallCount", label: "Max recall attempts" },
  { key: "recallGracePeriodMinutes", label: "Recall grace period (minutes)" },
  { key: "approachingThreshold", label: '"Approaching" threshold (people ahead)' },
  { key: "nearlyNextThreshold", label: '"Nearly next" threshold (people ahead)' },
] as const;

export default function QueueSettingsPage() {
  const params = useParams<{ queueId: string }>();
  const queueId = params.queueId;
  const router = useRouter();
  const session = useStaffSession();

  const [queue, setQueue] = useState<QueueSummary | null>(null);
  const [name, setName] = useState("");
  const [config, setConfig] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const [codes, setCodes] = useState<CodeSummary[] | null>(null);
  const [minting, setMinting] = useState<"QUEUE" | "DISPLAY" | null>(null);
  const [changingStatus, setChangingStatus] = useState(false);

  const [services, setServices] = useState<ServiceSummary[] | null>(null);
  const [attachedIds, setAttachedIds] = useState<string[] | null>(null);
  const [attaching, setAttaching] = useState(false);
  const [pickedServiceId, setPickedServiceId] = useState("");

  async function refreshCodes(): Promise<void> {
    setCodes(await staffApi.listCodes(queueId));
  }

  useEffect(() => {
    if (!session) return;
    staffApi.getQueue(queueId).then((q) => {
      setQueue(q);
      setName(q.name);
      setConfig({
        servingCapacity: String(q.servingCapacity),
        maxActiveTicketsPerCustomer: String(q.maxActiveTicketsPerCustomer),
        maxRecallCount: String(q.maxRecallCount),
        recallGracePeriodMinutes: String(q.recallGracePeriodMinutes),
        approachingThreshold: String(q.approachingThreshold),
        nearlyNextThreshold: String(q.nearlyNextThreshold),
      });
      staffApi.listServices(q.locationId).then(setServices);
    });
    refreshCodes();
    staffApi.listAttachedServiceIds(queueId).then(setAttachedIds);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, queueId]);

  async function handleSaveConfig(event: FormEvent): Promise<void> {
    event.preventDefault();
    setSaving(true);
    setSaveError(null);
    setSaved(false);
    try {
      const updated = await staffApi.updateQueueConfig(queueId, {
        name,
        servingCapacity: Number(config.servingCapacity),
        maxActiveTicketsPerCustomer: Number(config.maxActiveTicketsPerCustomer),
        maxRecallCount: Number(config.maxRecallCount),
        recallGracePeriodMinutes: Number(config.recallGracePeriodMinutes),
        approachingThreshold: Number(config.approachingThreshold),
        nearlyNextThreshold: Number(config.nearlyNextThreshold),
      });
      setQueue(updated);
      setSaved(true);
    } catch (err) {
      setSaveError(errorMessage(err, "Something went wrong."));
    } finally {
      setSaving(false);
    }
  }

  async function handleChangeStatus(status: QueueStatus): Promise<void> {
    setChangingStatus(true);
    try {
      setQueue(await staffApi.updateQueueStatus(queueId, status));
    } finally {
      setChangingStatus(false);
    }
  }

  async function handleAttach(): Promise<void> {
    if (!pickedServiceId) return;
    setAttaching(true);
    try {
      await staffApi.attachService(queueId, pickedServiceId);
      setAttachedIds((prev) => [...(prev ?? []), pickedServiceId]);
      setPickedServiceId("");
    } finally {
      setAttaching(false);
    }
  }

  if (!session || !queue || !codes || !services || !attachedIds) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-bg text-text-secondary">
        Loading…
      </main>
    );
  }

  const unattachedServices = services.filter((s) => !attachedIds.includes(s.id));
  const attachedServices = services.filter((s) => attachedIds.includes(s.id));
  const queueCode = codes.find((c) => c.contextType === "QUEUE" && c.active) ?? null;
  const displayCode = codes.find((c) => c.contextType === "DISPLAY" && c.active) ?? null;
  const origin = typeof window !== "undefined" ? window.location.origin : "";

  return (
    <AppShell
      session={session}
      title={`${queue.name} — Settings`}
      actions={
        <button
          type="button"
          onClick={() => router.push(`/admin/queues/${queueId}`)}
          className="text-sm text-text-secondary underline"
        >
          Back to dashboard
        </button>
      }
    >
      <Card className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium uppercase tracking-wide text-text-secondary">
            Status
          </h2>
          <Badge
            tone={
              queue.status === "ACTIVE"
                ? "success"
                : queue.status === "PAUSED"
                  ? "warning"
                  : "neutral"
            }
          >
            {queue.status}
          </Badge>
        </div>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            disabled={changingStatus || queue.status === "ACTIVE"}
            onClick={() => handleChangeStatus("ACTIVE")}
          >
            Set active
          </Button>
          <Button
            variant="secondary"
            disabled={changingStatus || queue.status === "PAUSED"}
            onClick={() => handleChangeStatus("PAUSED")}
          >
            Pause
          </Button>
          <Button
            variant="destructive"
            disabled={changingStatus || queue.status === "CLOSED"}
            onClick={() => handleChangeStatus("CLOSED")}
          >
            Close
          </Button>
        </div>
        <p className="text-sm text-text-secondary">
          Paused or closed queues reject new joins; closing also cancels anyone still waiting.
        </p>
      </Card>

      <Card className="flex flex-col gap-4">
        <h2 className="text-sm font-medium uppercase tracking-wide text-text-secondary">
          Configuration
        </h2>
        <form onSubmit={handleSaveConfig} className="flex flex-col gap-4">
          <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} required />
          {CONFIG_FIELDS.map((field) => (
            <Input
              key={field.key}
              label={field.label}
              type="number"
              min={0}
              value={config[field.key] ?? ""}
              onChange={(e) => setConfig((prev) => ({ ...prev, [field.key]: e.target.value }))}
              required
            />
          ))}
          {saveError && <p className="text-sm text-red-600">{saveError}</p>}
          {saved && <p className="text-sm text-green-700">Saved.</p>}
          <Button type="submit" disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </form>
      </Card>

      <Card className="flex flex-col gap-4">
        <h2 className="text-sm font-medium uppercase tracking-wide text-text-secondary">
          Services
        </h2>
        <div className="flex flex-wrap gap-2">
          {attachedServices.length === 0 && (
            <p className="text-sm text-text-secondary">No services attached yet.</p>
          )}
          {attachedServices.map((s) => (
            <Badge key={s.id} tone="info">
              {s.name}
            </Badge>
          ))}
        </div>
        {unattachedServices.length > 0 && (
          <div className="flex items-end gap-2">
            <label className="flex flex-col gap-1.5 text-sm font-medium text-text-primary">
              Attach a service
              <select
                value={pickedServiceId}
                onChange={(e) => setPickedServiceId(e.target.value)}
                className="min-h-[48px] w-64 rounded-md border border-border bg-surface px-4 py-3 text-base text-text-primary"
              >
                <option value="">Choose…</option>
                {unattachedServices.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <Button
              variant="secondary"
              onClick={handleAttach}
              disabled={attaching || !pickedServiceId}
            >
              {attaching ? "Attaching…" : "Attach"}
            </Button>
          </div>
        )}
      </Card>

      <Card className="flex flex-col gap-4">
        <h2 className="text-sm font-medium uppercase tracking-wide text-text-secondary">
          Customer QR poster
        </h2>
        {queueCode ? (
          <div className="flex flex-col items-center gap-2">
            <TicketQrCode url={`${origin}/q/${queueCode.publicCode}`} />
            <p className="font-mono text-text-primary">{queueCode.publicCode}</p>
            <Button
              variant="destructive"
              onClick={async () => {
                await staffApi.deactivateCode(queueId, queueCode.id);
                await refreshCodes();
              }}
            >
              Deactivate
            </Button>
          </div>
        ) : (
          <Button
            disabled={minting === "QUEUE"}
            onClick={async () => {
              setMinting("QUEUE");
              try {
                await staffApi.createCode(queueId, "QUEUE");
                await refreshCodes();
              } finally {
                setMinting(null);
              }
            }}
          >
            {minting === "QUEUE" ? "Generating…" : "Create QR poster"}
          </Button>
        )}
      </Card>

      <Card className="flex flex-col gap-4">
        <h2 className="text-sm font-medium uppercase tracking-wide text-text-secondary">
          Public display code
        </h2>
        {displayCode ? (
          <div className="flex flex-col items-center gap-2">
            <p className="text-sm text-text-secondary">Point the TV&apos;s browser at:</p>
            <p className="font-mono text-text-primary">
              {origin}/display/{displayCode.publicCode}
            </p>
            <Button
              variant="destructive"
              onClick={async () => {
                await staffApi.deactivateCode(queueId, displayCode.id);
                await refreshCodes();
              }}
            >
              Deactivate
            </Button>
          </div>
        ) : (
          <Button
            disabled={minting === "DISPLAY"}
            onClick={async () => {
              setMinting("DISPLAY");
              try {
                await staffApi.createCode(queueId, "DISPLAY");
                await refreshCodes();
              } finally {
                setMinting(null);
              }
            }}
          >
            {minting === "DISPLAY" ? "Generating…" : "Create display code"}
          </Button>
        )}
      </Card>
    </AppShell>
  );
}
