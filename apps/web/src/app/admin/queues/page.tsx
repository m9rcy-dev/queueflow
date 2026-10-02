"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Input } from "@queueflow/ui";
import { ApiError } from "@queueflow/api-client";
import type { LocationSummary, QueueSummary } from "@queueflow/types";
import { staffApi } from "../../../lib/staff-api-client";
import { useStaffSession } from "../../../lib/use-staff-session";
import { AdminNav } from "../../../components/AdminNav";

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback;
}

/**
 * The full queue list + create form (Phase 11) — no longer auto-redirects
 * past a lone queue (Phase 5's original "skip the picker in the common
 * case" behavior): this page is also how a business adds a *second*
 * queue, so it has to stay reachable and show the create affordance even
 * when there's only one today.
 */
export default function QueuesPage() {
  const router = useRouter();
  const session = useStaffSession();
  const [queues, setQueues] = useState<QueueSummary[] | null>(null);
  const [locations, setLocations] = useState<LocationSummary[] | null>(null);
  const [showForm, setShowForm] = useState(false);

  useEffect(() => {
    if (!session) return;
    staffApi.listQueues().then(setQueues);
    staffApi.listLocations().then(setLocations);
  }, [session]);

  if (!session || !queues || !locations) {
    return <Centered>Loading…</Centered>;
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col gap-6 bg-bg p-6 pt-10">
      <header>
        <h1 className="mb-4 text-xl font-semibold text-text-primary">Queues</h1>
        <AdminNav current="queues" />
      </header>

      <div className="flex flex-col gap-3">
        {queues.length === 0 && (
          <p className="text-sm text-text-secondary">No queues yet — create your first one.</p>
        )}
        {queues.map((queue) => (
          <Card key={queue.id}>
            <Button variant="secondary" onClick={() => router.push(`/admin/queues/${queue.id}`)}>
              {queue.name}
            </Button>
          </Card>
        ))}
      </div>

      {locations.length === 0 ? (
        <p className="text-sm text-text-secondary">
          Create a location first (under Locations) before adding a queue.
        </p>
      ) : showForm ? (
        <CreateQueueForm
          locations={locations}
          onCancel={() => setShowForm(false)}
          onCreated={(queue) => {
            setQueues((prev) => [...(prev ?? []), queue]);
            setShowForm(false);
          }}
        />
      ) : (
        <Button variant="secondary" onClick={() => setShowForm(true)}>
          + New queue
        </Button>
      )}
    </main>
  );
}

function CreateQueueForm({
  locations,
  onCancel,
  onCreated,
}: {
  locations: LocationSummary[];
  onCancel: () => void;
  onCreated: (queue: QueueSummary) => void;
}) {
  const [name, setName] = useState("");
  const [locationId, setLocationId] = useState(locations[0]?.id ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const queue = await staffApi.createQueue({ name, locationId });
      onCreated(queue);
    } catch (err) {
      setError(errorMessage(err, "Something went wrong."));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card className="flex flex-col gap-4">
      <h2 className="text-lg font-medium text-text-primary">New queue</h2>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} required />
        <label className="flex flex-col gap-1.5 text-sm font-medium text-text-primary">
          Location
          <select
            value={locationId}
            onChange={(e) => setLocationId(e.target.value)}
            className="min-h-[48px] rounded-md border border-border bg-surface px-4 py-3 text-base text-text-primary"
            required
          >
            {locations.map((location) => (
              <option key={location.id} value={location.id}>
                {location.name}
              </option>
            ))}
          </select>
        </label>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex gap-3">
          <Button type="submit" disabled={submitting || !name || !locationId}>
            {submitting ? "Creating…" : "Create"}
          </Button>
          <Button type="button" variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-bg p-8 text-center text-text-secondary">
      {children}
    </main>
  );
}
