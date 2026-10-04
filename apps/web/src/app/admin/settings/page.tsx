"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Button, Card, Input } from "@queueflow/ui";
import { ApiError } from "@queueflow/api-client";
import type { AppointmentSettings, CodeSummary, TenantSummary } from "@queueflow/types";
import { staffApi } from "../../../lib/staff-api-client";
import { useStaffSession } from "../../../lib/use-staff-session";
import { AdminNav } from "../../../components/AdminNav";
import { TicketQrCode } from "../../../components/TicketQrCode";

export default function SettingsPage() {
  const session = useStaffSession();
  const [tenant, setTenant] = useState<TenantSummary | null>(null);
  const [savingCapability, setSavingCapability] = useState<
    "queueEnabled" | "appointmentEnabled" | null
  >(null);
  const [generalCodes, setGeneralCodes] = useState<CodeSummary[] | null>(null);
  const [minting, setMinting] = useState(false);

  async function refreshCodes(): Promise<void> {
    setGeneralCodes(await staffApi.listGeneralCodes());
  }

  useEffect(() => {
    if (!session) return;
    staffApi.getTenant().then(setTenant);
    refreshCodes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  async function toggleCapability(key: "queueEnabled" | "appointmentEnabled"): Promise<void> {
    if (!tenant) return;
    setSavingCapability(key);
    try {
      const updated = await staffApi.updateCapabilities({ [key]: !tenant[key] });
      setTenant(updated);
    } finally {
      setSavingCapability(null);
    }
  }

  if (!session || !tenant || !generalCodes) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-bg text-text-secondary">
        Loading…
      </main>
    );
  }

  // listGeneralCodes returns every GENERAL code ever minted, newest first —
  // the first active one is "the" current poster (regenerate deactivates
  // whatever was active before minting a new one, so there's normally at
  // most one).
  const activeGeneralCode = generalCodes.find((c) => c.active) ?? null;
  const posterUrl =
    activeGeneralCode && typeof window !== "undefined"
      ? `${window.location.origin}/c/${activeGeneralCode.publicCode}`
      : null;

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 bg-bg p-6">
      <header className="pt-4">
        <h1 className="mb-4 text-xl font-semibold text-text-primary">Settings</h1>
        <AdminNav current="settings" />
      </header>

      <Card className="flex flex-col gap-4">
        <h2 className="text-sm font-medium uppercase tracking-wide text-text-secondary">
          Capabilities
        </h2>
        <label className="flex items-center justify-between">
          <span className="text-text-primary">Queue</span>
          <input
            type="checkbox"
            checked={tenant.queueEnabled}
            disabled={savingCapability === "queueEnabled"}
            onChange={() => toggleCapability("queueEnabled")}
          />
        </label>
        <label className="flex items-center justify-between">
          <span className="text-text-primary">Appointments</span>
          <input
            type="checkbox"
            checked={tenant.appointmentEnabled}
            disabled={savingCapability === "appointmentEnabled"}
            onChange={() => toggleCapability("appointmentEnabled")}
          />
        </label>
      </Card>

      {tenant.appointmentEnabled && <AppointmentSettingsCard />}

      <Card className="flex flex-col items-center gap-4">
        <h2 className="self-start text-sm font-medium uppercase tracking-wide text-text-secondary">
          Customer sign-up poster
        </h2>
        <p className="self-start text-sm text-text-secondary">
          Print this QR code — customers scan it with their own phone to create an account or log
          back in, without needing staff or a kiosk.
        </p>
        {activeGeneralCode ? (
          <>
            {posterUrl && <TicketQrCode url={posterUrl} />}
            <p className="font-mono text-lg tracking-widest text-text-primary">
              {activeGeneralCode.publicCode}
            </p>
            <Button
              variant="secondary"
              onClick={async () => {
                setMinting(true);
                try {
                  await staffApi.regenerateGeneralCode();
                  await refreshCodes();
                } finally {
                  setMinting(false);
                }
              }}
              disabled={minting}
            >
              {minting ? "Generating…" : "Lost or leaked? Get a new poster code"}
            </Button>
          </>
        ) : (
          <Button
            onClick={async () => {
              setMinting(true);
              try {
                await staffApi.createGeneralCode();
                await refreshCodes();
              } finally {
                setMinting(false);
              }
            }}
            disabled={minting}
          >
            {minting ? "Generating…" : "Create sign-up poster"}
          </Button>
        )}
      </Card>
    </main>
  );
}

type NumericSettingKey = Exclude<keyof AppointmentSettings, "reminderOffsetsMinutes">;

const SETTING_FIELDS: Array<{ key: NumericSettingKey; label: string; min: number }> = [
  { key: "slotIntervalMinutes", label: "Offer a start time every (minutes)", min: 5 },
  { key: "bufferMinutes", label: "Gap after each appointment (minutes)", min: 0 },
  { key: "minLeadMinutes", label: "Earliest booking, from now (minutes)", min: 0 },
  { key: "advanceDays", label: "Furthest booking ahead (days)", min: 0 },
  {
    key: "cancelNoticeMinutes",
    label: "Customers can cancel online until (minutes before)",
    min: 0,
  },
  {
    key: "priorityWindowMinutes",
    label: "Checked-in bookings go ahead of walk-ins from (minutes before)",
    min: 0,
  },
  {
    key: "noShowGraceMinutes",
    label: "Mark as no-show if not checked in after (minutes late)",
    min: 0,
  },
];

/** "24, 2" (hours, the way people think about reminders) <-> [1440, 120] (minutes, what the API stores). */
function hoursText(minutes: number[]): string {
  return minutes.map((m) => String(m / 60)).join(", ");
}
function parseHours(text: string): number[] {
  return text
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part !== "")
    .map((part) => Math.round(Number(part) * 60));
}

/** Tenant-wide slot rules (Phase 13, G-22/ADR-012) — only shown once the Appointments capability is on. */
function AppointmentSettingsCard() {
  const [values, setValues] = useState<Record<keyof AppointmentSettings, string> | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    staffApi.getAppointmentSettings().then((settings) => {
      setValues({
        slotIntervalMinutes: String(settings.slotIntervalMinutes),
        bufferMinutes: String(settings.bufferMinutes),
        minLeadMinutes: String(settings.minLeadMinutes),
        advanceDays: String(settings.advanceDays),
        cancelNoticeMinutes: String(settings.cancelNoticeMinutes),
        priorityWindowMinutes: String(settings.priorityWindowMinutes),
        noShowGraceMinutes: String(settings.noShowGraceMinutes),
        reminderOffsetsMinutes: hoursText(settings.reminderOffsetsMinutes),
      });
    });
  }, []);

  async function handleSave(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!values) return;
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      await staffApi.updateAppointmentSettings({
        slotIntervalMinutes: Number(values.slotIntervalMinutes),
        bufferMinutes: Number(values.bufferMinutes),
        minLeadMinutes: Number(values.minLeadMinutes),
        advanceDays: Number(values.advanceDays),
        cancelNoticeMinutes: Number(values.cancelNoticeMinutes),
        priorityWindowMinutes: Number(values.priorityWindowMinutes),
        noShowGraceMinutes: Number(values.noShowGraceMinutes),
        reminderOffsetsMinutes: parseHours(values.reminderOffsetsMinutes),
      });
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="flex flex-col gap-4">
      <h2 className="text-sm font-medium uppercase tracking-wide text-text-secondary">
        Appointment rules
      </h2>
      <p className="text-sm text-text-secondary">
        Applies to every location. Mark services as bookable on each location&apos;s page.
      </p>
      {values && (
        <form onSubmit={handleSave} className="flex flex-col gap-3">
          {SETTING_FIELDS.map((field) => (
            <Input
              key={field.key}
              label={field.label}
              type="number"
              min={field.min}
              value={values[field.key]}
              onChange={(e) => setValues({ ...values, [field.key]: e.target.value })}
              required
            />
          ))}
          <Input
            label="Reminders, hours before (comma-separated, blank for none)"
            value={values.reminderOffsetsMinutes}
            onChange={(e) => setValues({ ...values, reminderOffsetsMinutes: e.target.value })}
            placeholder="24, 2"
          />
          {error && <p className="text-sm text-red-600">{error}</p>}
          {saved && <p className="text-sm text-green-700">Saved.</p>}
          <Button type="submit" variant="secondary" disabled={saving} className="self-start">
            {saving ? "Saving…" : "Save appointment rules"}
          </Button>
        </form>
      )}
    </Card>
  );
}
