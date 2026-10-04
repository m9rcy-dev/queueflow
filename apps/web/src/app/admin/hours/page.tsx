"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Card } from "@queueflow/ui";
import { ApiError } from "@queueflow/api-client";
import type { HoursReport, LocationSummary, ShiftRecord } from "@queueflow/types";
import { staffApi } from "../../../lib/staff-api-client";
import { useStaffSession } from "../../../lib/use-staff-session";
import { isBusinessAdmin } from "../../../lib/roles";
import { AppShell } from "../../../components/AppShell";

type Preset = "this-week" | "last-week" | "this-month" | "last-month" | "custom";

const PRESETS: Array<{ id: Preset; label: string }> = [
  { id: "this-week", label: "This week" },
  { id: "last-week", label: "Last week" },
  { id: "this-month", label: "This month" },
  { id: "last-month", label: "Last month" },
  { id: "custom", label: "Custom" },
];

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

/** Weeks start on Monday (pay weeks in NZ usually do). Ranges are [from, to) in this device's time. */
function presetRange(preset: Exclude<Preset, "custom">, now = new Date()): [Date, Date] {
  const today = startOfDay(now);
  const monday = addDays(today, -((today.getDay() + 6) % 7));
  switch (preset) {
    case "this-week":
      return [monday, addDays(monday, 7)];
    case "last-week":
      return [addDays(monday, -7), monday];
    case "this-month":
      return [
        new Date(today.getFullYear(), today.getMonth(), 1),
        new Date(today.getFullYear(), today.getMonth() + 1, 1),
      ];
    case "last-month":
      return [
        new Date(today.getFullYear(), today.getMonth() - 1, 1),
        new Date(today.getFullYear(), today.getMonth(), 1),
      ];
  }
}

const pad = (n: number) => String(n).padStart(2, "0");
const toDateInput = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const toDateTimeInput = (iso: string) => {
  const d = new Date(iso);
  return `${toDateInput(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

function formatHours(minutes: number): string {
  return `${Math.floor(minutes / 60)}h ${pad(minutes % 60)}m`;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" });
}

/** Spreadsheet-safe CSV: quote every field, and neutralise a leading = + - @ (formula injection). */
function csvField(value: string): string {
  const safe = /^[=+\-@]/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}

function toCsv(shifts: ShiftRecord[]): string {
  const header = ["Staff", "Location", "Date", "Start", "End", "Hours", "Edited by"];
  const rows = shifts.map((shift) => [
    shift.staffName,
    shift.locationName,
    toDateInput(new Date(shift.startedAt)),
    toDateTimeInput(shift.startedAt).slice(11),
    shift.endedAt ? toDateTimeInput(shift.endedAt).slice(11) : "still clocked in",
    (shift.minutes / 60).toFixed(2),
    shift.editedByName ?? "",
  ]);
  return [header, ...rows].map((row) => row.map(csvField).join(",")).join("\r\n");
}

function downloadCsv(filename: string, content: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

/**
 * Hours (Phase 19): the time record from clocking in and out, for pay. No
 * pay is worked out here — export the CSV into the point-of-sale or payroll
 * system. Staff see their own hours, a Manager their location's, owner/admin
 * everyone's (scoped by the API). Owner/admin and Managers can fix a
 * forgotten clock-out — for someone else, never themselves.
 */
export default function HoursPage() {
  const session = useStaffSession();
  const [preset, setPreset] = useState<Preset>("this-week");
  const [custom, setCustom] = useState(() => {
    const [from, to] = presetRange("this-week");
    return { from: toDateInput(from), to: toDateInput(addDays(to, -1)) };
  });
  const [locations, setLocations] = useState<LocationSummary[]>([]);
  const [locationId, setLocationId] = useState("");
  const [report, setReport] = useState<HoursReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);

  const isAdmin = session ? isBusinessAdmin(session.role) : false;
  const canEdit = session ? isAdmin || session.role === "MANAGER" : false;

  const [from, to] = useMemo((): [Date, Date] => {
    if (preset !== "custom") return presetRange(preset);
    const start = new Date(`${custom.from}T00:00`);
    const end = addDays(new Date(`${custom.to}T00:00`), 1); // the "to" day is included
    return [start, end];
  }, [preset, custom]);

  const load = useCallback(async () => {
    if (!session) return;
    if (!(to > from)) {
      setError("The end date must be on or after the start date.");
      return;
    }
    setError(null);
    try {
      setReport(
        await staffApi.hoursReport({
          from: from.toISOString(),
          to: to.toISOString(),
          locationId: locationId || undefined,
        }),
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't load hours.");
    }
  }, [session, from, to, locationId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (session && isBusinessAdmin(session.role)) {
      staffApi
        .listLocations()
        .then(setLocations)
        .catch(() => setLocations([]));
    }
  }, [session]);

  if (!session) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-bg text-text-secondary">
        Loading…
      </main>
    );
  }

  const totalMinutes = report?.totals.reduce((sum, t) => sum + t.minutes, 0) ?? 0;
  const lastDay = addDays(to, -1);

  return (
    <AppShell
      session={session}
      title="Hours"
      actions={
        report &&
        report.shifts.length > 0 && (
          <Button
            variant="secondary"
            className="min-h-[40px] px-4 py-2 text-sm"
            onClick={() =>
              downloadCsv(
                `hours-${toDateInput(from)}-to-${toDateInput(lastDay)}.csv`,
                toCsv(report.shifts),
              )
            }
          >
            Export CSV
          </Button>
        )
      }
    >
      <p className="text-sm text-text-secondary">
        {session.role === "STAFF"
          ? "Your hours from clocking in and out."
          : "Hours from clocking in and out. Export the CSV for your point-of-sale or payroll system."}
      </p>

      <Card className="flex flex-col gap-3 p-4">
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => setPreset(option.id)}
              className={`rounded-full border px-3 py-1.5 text-sm ${
                preset === option.id
                  ? "border-primary bg-primary/10 font-semibold text-primary"
                  : "border-border text-text-primary hover:bg-bg"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-end gap-3 text-sm">
          {preset === "custom" ? (
            <>
              <label className="flex flex-col gap-1 text-text-secondary">
                From
                <input
                  type="date"
                  value={custom.from}
                  onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))}
                  className="min-h-[40px] rounded-md border border-border bg-surface px-2 text-text-primary"
                />
              </label>
              <label className="flex flex-col gap-1 text-text-secondary">
                To
                <input
                  type="date"
                  value={custom.to}
                  onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))}
                  className="min-h-[40px] rounded-md border border-border bg-surface px-2 text-text-primary"
                />
              </label>
            </>
          ) : (
            <p className="text-text-secondary">
              {from.toLocaleDateString()} – {lastDay.toLocaleDateString()}
            </p>
          )}
          {isAdmin && locations.length > 1 && (
            <label className="flex flex-col gap-1 text-text-secondary">
              Location
              <select
                value={locationId}
                onChange={(e) => setLocationId(e.target.value)}
                className="min-h-[40px] rounded-md border border-border bg-surface px-2 text-text-primary"
              >
                <option value="">All locations</option>
                {locations.map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      </Card>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {report && (
        <>
          <Card className="flex flex-col gap-3 p-4">
            <div className="flex items-baseline justify-between">
              <h2 className="text-lg font-semibold text-text-primary">Totals</h2>
              <span className="text-sm text-text-secondary">
                {formatHours(totalMinutes)} in all
              </span>
            </div>
            {report.totals.length === 0 ? (
              <p className="text-sm text-text-secondary">No shifts in this period.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-text-secondary">
                    <tr>
                      <th className="py-1.5 font-medium">Staff</th>
                      <th className="py-1.5 font-medium">Shifts</th>
                      <th className="py-1.5 text-right font-medium">Hours</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.totals.map((total) => (
                      <tr key={total.tenantUserId} className="border-t border-border">
                        <td className="py-2 text-text-primary">{total.staffName}</td>
                        <td className="py-2 text-text-secondary">{total.shiftCount}</td>
                        <td className="py-2 text-right font-semibold tabular-nums text-text-primary">
                          {formatHours(total.minutes)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {report.shifts.length > 0 && (
            <Card className="flex flex-col gap-1 p-4">
              <h2 className="mb-2 text-lg font-semibold text-text-primary">Shifts</h2>
              {report.shifts.map((shift) =>
                editing === shift.id ? (
                  <EditShift
                    key={shift.id}
                    shift={shift}
                    onCancel={() => setEditing(null)}
                    onSaved={async () => {
                      setEditing(null);
                      await load();
                    }}
                  />
                ) : (
                  <div
                    key={shift.id}
                    className="flex flex-wrap items-center justify-between gap-2 border-t border-border py-2 text-sm"
                  >
                    <div>
                      <p className="text-text-primary">
                        <span className="font-medium">{shift.staffName}</span> ·{" "}
                        {formatDay(shift.startedAt)}, {formatTime(shift.startedAt)} –{" "}
                        {shift.endedAt ? (
                          formatTime(shift.endedAt)
                        ) : (
                          <span className="font-medium text-emerald-700">still clocked in</span>
                        )}
                      </p>
                      <p className="text-xs text-text-secondary">
                        {shift.locationName}
                        {shift.editedByName && ` · corrected by ${shift.editedByName}`}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="font-semibold tabular-nums text-text-primary">
                        {formatHours(shift.minutes)}
                      </span>
                      {canEdit && shift.tenantUserId !== session.tenantUserId && (
                        <button
                          type="button"
                          onClick={() => setEditing(shift.id)}
                          className="text-sm text-primary underline"
                        >
                          Fix
                        </button>
                      )}
                    </div>
                  </div>
                ),
              )}
            </Card>
          )}
        </>
      )}
    </AppShell>
  );
}

function EditShift({
  shift,
  onCancel,
  onSaved,
}: {
  shift: ShiftRecord;
  onCancel: () => void;
  onSaved: () => Promise<void>;
}) {
  const [start, setStart] = useState(toDateTimeInput(shift.startedAt));
  const [end, setEnd] = useState(shift.endedAt ? toDateTimeInput(shift.endedAt) : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await staffApi.updateShift(shift.id, {
        startedAt: new Date(start).toISOString(),
        endedAt: end ? new Date(end).toISOString() : null,
      });
      await onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't save that.");
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border border-primary/40 bg-primary/5 p-3 text-sm">
      <p className="font-medium text-text-primary">Fix {shift.staffName}&apos;s shift</p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-text-secondary">
          Clocked in
          <input
            type="datetime-local"
            value={start}
            onChange={(e) => setStart(e.target.value)}
            className="min-h-[40px] rounded-md border border-border bg-surface px-2 text-text-primary"
          />
        </label>
        <label className="flex flex-col gap-1 text-text-secondary">
          Clocked out
          <input
            type="datetime-local"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
            className="min-h-[40px] rounded-md border border-border bg-surface px-2 text-text-primary"
          />
        </label>
        <Button onClick={save} disabled={busy || !start} className="min-h-[40px] px-4 py-2 text-sm">
          {busy ? "Saving…" : "Save"}
        </Button>
        <Button variant="secondary" onClick={onCancel} className="min-h-[40px] px-4 py-2 text-sm">
          Cancel
        </Button>
      </div>
      {!shift.endedAt && (
        <p className="text-xs text-text-secondary">
          Setting a clock-out time ends this shift. Anyone waiting for {shift.staffName} goes back
          to &quot;anyone&quot;.
        </p>
      )}
      {error && <p className="text-red-600">{error}</p>}
    </div>
  );
}
