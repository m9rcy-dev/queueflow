"use client";

import { useState, type FormEvent } from "react";
import { Button, Card, Input } from "@queueflow/ui";
import { ApiError } from "@queueflow/api-client";
import type { StaffProfile } from "@queueflow/types";
import { staffApi } from "../lib/staff-api-client";

/**
 * The name customers see (Phase 18) — on the TV board ("#12 with Ana") and
 * when choosing who they'd like at the join page. Your own name or an
 * alias; blank uses your display name. Per business.
 */
export function PublicNameSettings({ profile }: { profile: StaffProfile }) {
  const [value, setValue] = useState(profile.publicName ?? "");
  const [saved, setSaved] = useState<string | null>(profile.publicName);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "error" | "info"; text: string } | null>(null);

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const updated = await staffApi.updatePublicName(value.trim() || null);
      setSaved(updated.publicName);
      setValue(updated.publicName ?? "");
      setMessage({ tone: "info", text: "Saved." });
    } catch (err) {
      setMessage({
        tone: "error",
        text: err instanceof ApiError ? err.message : "Couldn't save that.",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="flex flex-col gap-3">
      <div>
        <h2 className="text-lg font-semibold text-text-primary">Name customers see</h2>
        <p className="text-sm text-text-secondary">
          Shown on the TV board and when customers choose who they&apos;d like at{" "}
          {profile.tenantName}. Use your own name or an alias. Right now customers see{" "}
          <span className="font-medium text-text-primary">{saved || profile.displayName}</span>.
        </p>
      </div>
      <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-3">
        <div className="min-w-[200px] flex-1">
          <Input
            label="Public name"
            value={value}
            maxLength={60}
            placeholder={profile.displayName}
            onChange={(e) => setValue(e.target.value)}
          />
        </div>
        <Button type="submit" disabled={busy} className="min-h-[40px] px-4 py-2 text-sm">
          {busy ? "Saving…" : "Save"}
        </Button>
      </form>
      {message && (
        <p
          className={`text-sm ${message.tone === "error" ? "text-red-600" : "text-text-secondary"}`}
        >
          {message.text}
        </p>
      )}
    </Card>
  );
}
