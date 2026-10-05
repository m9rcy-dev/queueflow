"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useParams, useRouter } from "next/navigation";
import { Badge, Card } from "@queueflow/ui";
import { ApiError } from "@queueflow/api-client";
import type { StaffQueueEntrySummary } from "@queueflow/types";
import { staffApi } from "../../../../../lib/staff-api-client";
import { CameraScanner } from "../../../../../components/CameraScanner";
import { useStaffSession } from "../../../../../lib/use-staff-session";

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback;
}

/**
 * The physical counter scanner (Phase 10, D-10/D-11) — no special hardware
 * integration needed: a USB/Bluetooth barcode scanner just types the code
 * into whatever's focused and sends Enter, which submits this page's form
 * exactly like a person typing it. Self-serve, instant — no confirmation
 * step before the join happens (D-11); this screen only confirms *after*.
 */
export default function ScannerPage() {
  const params = useParams<{ queueId: string }>();
  const queueId = params.queueId;
  const session = useStaffSession();
  const router = useRouter();

  const inputRef = useRef<HTMLInputElement>(null);
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<StaffQueueEntrySummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Phase 19: the phone/tablet camera as a backup for the counter scanner.
  const [useCamera, setUseCamera] = useState(false);

  useEffect(() => {
    if (!useCamera) inputRef.current?.focus();
  }, [result, error, useCamera]);

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    await submitCode(code);
  }

  /** One path for both: the counter scanner (typed + Enter) and the camera. */
  async function submitCode(scanned: string): Promise<void> {
    if (!scanned.trim() || submitting) return;
    setSubmitting(true);
    setError(null);
    setResult(null);
    try {
      const entry = await staffApi.scan(queueId, scanned.trim());
      setResult(entry);
    } catch (err) {
      setError(errorMessage(err, "This code isn't recognized."));
    } finally {
      setCode("");
      setSubmitting(false);
    }
  }

  if (!session) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-bg text-text-secondary">
        Loading…
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center gap-6 bg-bg p-6 pt-10 text-center">
      <div>
        <h1 className="text-xl font-semibold text-text-primary">Scan a card or code</h1>
        <p className="text-sm text-text-secondary">
          Present a guest card, a customer&apos;s own QR code, or a booking&apos;s check-in code.
        </p>
      </div>

      <div className="flex w-full rounded-lg border border-border bg-surface p-1 text-sm">
        {[
          { camera: false, label: "Counter scanner" },
          { camera: true, label: "Use camera" },
        ].map((option) => (
          <button
            key={option.label}
            type="button"
            aria-pressed={useCamera === option.camera}
            onClick={() => setUseCamera(option.camera)}
            className={`flex-1 rounded-md px-3 py-2 font-medium ${
              useCamera === option.camera ? "bg-primary text-white" : "text-text-secondary"
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>

      {useCamera && (
        <>
          <CameraScanner onCode={(scanned) => void submitCode(scanned)} paused={submitting} />
          <p className="-mt-3 text-xs text-text-secondary">
            Hold the customer&apos;s code inside the square. It&apos;s read automatically.
          </p>
        </>
      )}

      <form onSubmit={handleSubmit} className={useCamera ? "hidden" : "w-full"}>
        <input
          ref={inputRef}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          disabled={submitting}
          autoFocus
          aria-label="Scanned card or code"
          className="w-full rounded-md border border-border bg-surface px-4 py-4 text-center text-lg text-text-primary"
          placeholder="Waiting for scan…"
        />
      </form>

      {result && (
        <Card className="flex w-full flex-col items-center gap-2">
          <Badge tone="success">{result.appointmentStartsAt ? "Checked in" : "Joined"}</Badge>
          <p className="text-4xl font-semibold text-text-primary">#{result.ticketNumber}</p>
          <p className="text-text-secondary">{result.customerName}</p>
        </Card>
      )}

      {error && (
        <Card className="flex w-full flex-col items-center gap-2">
          <Badge tone="danger">Not recognized</Badge>
          <p className="text-sm text-text-secondary">{error}</p>
        </Card>
      )}

      <button
        type="button"
        onClick={() => router.push(`/admin/queues/${queueId}`)}
        className="text-sm text-text-secondary underline"
      >
        Back to dashboard
      </button>
    </main>
  );
}
