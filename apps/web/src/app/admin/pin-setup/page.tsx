"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Input } from "@queueflow/ui";
import { ApiError } from "@queueflow/api-client";
import { staffApi } from "../../../lib/staff-api-client";
import { useStaffSession } from "../../../lib/use-staff-session";

/** Lets a staff member set/change their own PIN for quick counter-device switching (D-03a). */
export default function PinSetupPage() {
  const router = useRouter();
  const session = useStaffSession();
  const [pin, setPin] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  if (!session) {
    return <Centered>Loading…</Centered>;
  }

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (pin !== confirm) {
      setError("PINs don't match.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await staffApi.setPin(pin);
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 bg-bg p-6">
      <Card className="flex flex-col gap-4">
        <h1 className="text-lg font-medium text-text-primary">Set up your PIN</h1>
        <p className="text-sm text-text-secondary">
          Used to quickly switch in on a shared counter device once it&apos;s been trusted.
        </p>
        {saved ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-green-700">PIN saved.</p>
            <Button onClick={() => router.push("/admin/queues")}>Continue</Button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <Input
              label="New PIN (4-6 digits)"
              type="password"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={6}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
              required
            />
            <Input
              label="Confirm PIN"
              type="password"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={6}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value.replace(/\D/g, ""))}
              required
            />
            {error && <p className="text-sm text-red-600">{error}</p>}
            <Button type="submit" disabled={submitting || pin.length < 4}>
              {submitting ? "Saving…" : "Save PIN"}
            </Button>
          </form>
        )}
      </Card>
    </main>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-bg p-8 text-center text-text-secondary">
      {children}
    </main>
  );
}
