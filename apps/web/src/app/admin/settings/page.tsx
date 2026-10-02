"use client";

import { useEffect, useState } from "react";
import { Button, Card } from "@queueflow/ui";
import type { CodeSummary, TenantSummary } from "@queueflow/types";
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
