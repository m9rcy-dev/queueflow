"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Input } from "@queueflow/ui";
import { ApiError } from "@queueflow/api-client";
import type { LocationSummary } from "@queueflow/types";
import { staffApi } from "../../../lib/staff-api-client";
import { useStaffSession } from "../../../lib/use-staff-session";
import { AdminNav } from "../../../components/AdminNav";

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback;
}

export default function LocationsPage() {
  const router = useRouter();
  const session = useStaffSession();
  const [locations, setLocations] = useState<LocationSummary[] | null>(null);
  const [showForm, setShowForm] = useState(false);

  useEffect(() => {
    if (!session) return;
    staffApi.listLocations().then(setLocations);
  }, [session]);

  if (!session || !locations) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-bg text-text-secondary">
        Loading…
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 bg-bg p-6">
      <header className="pt-4">
        <h1 className="mb-4 text-xl font-semibold text-text-primary">Locations</h1>
        <AdminNav current="locations" />
      </header>

      <div className="flex flex-col gap-3">
        {locations.length === 0 && (
          <p className="text-sm text-text-secondary">No locations yet — create your first one.</p>
        )}
        {locations.map((location) => (
          <Card
            key={location.id}
            className="flex cursor-pointer items-center justify-between"
            onClick={() => router.push(`/admin/locations/${location.id}`)}
          >
            <div>
              <p className="font-medium text-text-primary">{location.name}</p>
              <p className="text-sm text-text-secondary">
                {location.address ?? "No address set"} · {location.timezone}
              </p>
            </div>
          </Card>
        ))}
      </div>

      {showForm ? (
        <CreateLocationForm
          onCancel={() => setShowForm(false)}
          onCreated={(location) => {
            setLocations((prev) => [...(prev ?? []), location]);
            setShowForm(false);
          }}
        />
      ) : (
        <Button variant="secondary" onClick={() => setShowForm(true)}>
          + New location
        </Button>
      )}
    </main>
  );
}

function CreateLocationForm({
  onCancel,
  onCreated,
}: {
  onCancel: () => void;
  onCreated: (location: LocationSummary) => void;
}) {
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [timezone, setTimezone] = useState(
    Intl.DateTimeFormat().resolvedOptions().timeZone || "Pacific/Auckland",
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const location = await staffApi.createLocation({
        name,
        address: address || undefined,
        timezone,
      });
      onCreated(location);
    } catch (err) {
      setError(errorMessage(err, "Something went wrong."));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card className="flex flex-col gap-4">
      <h2 className="text-lg font-medium text-text-primary">New location</h2>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} required />
        <Input
          label="Address (optional)"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
        />
        <Input
          label="Timezone (IANA, e.g. Pacific/Auckland)"
          value={timezone}
          onChange={(e) => setTimezone(e.target.value)}
          required
        />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex gap-3">
          <Button type="submit" disabled={submitting || !name || !timezone}>
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
