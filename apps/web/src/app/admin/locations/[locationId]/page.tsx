"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useParams } from "next/navigation";
import { Badge, Button, Card, Input } from "@queueflow/ui";
import { ApiError } from "@queueflow/api-client";
import type { BusinessHoursEntry, LocationSummary, ServiceSummary } from "@queueflow/types";
import { staffApi } from "../../../../lib/staff-api-client";
import { useStaffSession } from "../../../../lib/use-staff-session";
import { AdminNav } from "../../../../components/AdminNav";

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback;
}

function minutesToTime(minutes: number): string {
  const h = Math.floor(minutes / 60)
    .toString()
    .padStart(2, "0");
  const m = (minutes % 60).toString().padStart(2, "0");
  return `${h}:${m}`;
}

function timeToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

interface DayRow {
  open: boolean;
  opensAt: string;
  closesAt: string;
}

function defaultDayRows(): DayRow[] {
  return DAY_NAMES.map(() => ({ open: false, opensAt: "09:00", closesAt: "17:00" }));
}

export default function LocationDetailPage() {
  const params = useParams<{ locationId: string }>();
  const locationId = params.locationId;
  const session = useStaffSession();

  const [location, setLocation] = useState<LocationSummary | null>(null);
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [timezone, setTimezone] = useState("");
  const [savingLocation, setSavingLocation] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);

  const [days, setDays] = useState<DayRow[]>(defaultDayRows());
  const [savingHours, setSavingHours] = useState(false);
  const [hoursError, setHoursError] = useState<string | null>(null);
  const [hoursSaved, setHoursSaved] = useState(false);

  const [services, setServices] = useState<ServiceSummary[] | null>(null);
  const [showServiceForm, setShowServiceForm] = useState(false);

  useEffect(() => {
    if (!session) return;
    staffApi.getLocation(locationId).then((loc) => {
      setLocation(loc);
      setName(loc.name);
      setAddress(loc.address ?? "");
      setTimezone(loc.timezone);
    });
    staffApi.getBusinessHours(locationId).then((entries) => {
      const rows = defaultDayRows();
      for (const entry of entries) {
        rows[entry.dayOfWeek] = {
          open: true,
          opensAt: minutesToTime(entry.opensAtMinutes),
          closesAt: minutesToTime(entry.closesAtMinutes),
        };
      }
      setDays(rows);
    });
    staffApi.listServices(locationId).then(setServices);
  }, [session, locationId]);

  async function handleSaveLocation(event: FormEvent): Promise<void> {
    event.preventDefault();
    setSavingLocation(true);
    setLocationError(null);
    try {
      const updated = await staffApi.updateLocation(locationId, {
        name,
        address: address || undefined,
        timezone,
      });
      setLocation(updated);
    } catch (err) {
      setLocationError(errorMessage(err, "Something went wrong."));
    } finally {
      setSavingLocation(false);
    }
  }

  async function handleSaveHours(event: FormEvent): Promise<void> {
    event.preventDefault();
    setSavingHours(true);
    setHoursError(null);
    setHoursSaved(false);
    const entries: BusinessHoursEntry[] = days
      .map((day, dayOfWeek) => ({ day, dayOfWeek }))
      .filter(({ day }) => day.open)
      .map(({ day, dayOfWeek }) => ({
        dayOfWeek,
        opensAtMinutes: timeToMinutes(day.opensAt),
        closesAtMinutes: timeToMinutes(day.closesAt),
      }));
    try {
      await staffApi.replaceBusinessHours(locationId, { entries });
      setHoursSaved(true);
    } catch (err) {
      setHoursError(errorMessage(err, "Something went wrong."));
    } finally {
      setSavingHours(false);
    }
  }

  if (!session || !location || !services) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-bg text-text-secondary">
        Loading…
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 bg-bg p-6">
      <header className="pt-4">
        <h1 className="mb-4 text-xl font-semibold text-text-primary">{location.name}</h1>
        <AdminNav current="locations" />
      </header>

      <Card className="flex flex-col gap-4">
        <h2 className="text-sm font-medium uppercase tracking-wide text-text-secondary">
          Location details
        </h2>
        <form onSubmit={handleSaveLocation} className="flex flex-col gap-4">
          <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} required />
          <Input
            label="Address (optional)"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
          />
          <Input
            label="Timezone (IANA)"
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
            required
          />
          {locationError && <p className="text-sm text-red-600">{locationError}</p>}
          <Button type="submit" disabled={savingLocation}>
            {savingLocation ? "Saving…" : "Save"}
          </Button>
        </form>
      </Card>

      <Card className="flex flex-col gap-4">
        <h2 className="text-sm font-medium uppercase tracking-wide text-text-secondary">
          Business hours
        </h2>
        <p className="text-sm text-text-secondary">
          One open period per day. A day with no period set is closed.
        </p>
        <form onSubmit={handleSaveHours} className="flex flex-col gap-3">
          {DAY_NAMES.map((dayName, dayOfWeek) => {
            const day = days[dayOfWeek];
            return (
              <div key={dayName} className="flex flex-wrap items-center gap-3">
                <label className="flex w-28 items-center gap-2 text-sm text-text-primary">
                  <input
                    type="checkbox"
                    checked={day.open}
                    onChange={(e) =>
                      setDays((prev) =>
                        prev.map((d, i) =>
                          i === dayOfWeek ? { ...d, open: e.target.checked } : d,
                        ),
                      )
                    }
                  />
                  {dayName}
                </label>
                {day.open && (
                  <>
                    <input
                      type="time"
                      value={day.opensAt}
                      onChange={(e) =>
                        setDays((prev) =>
                          prev.map((d, i) =>
                            i === dayOfWeek ? { ...d, opensAt: e.target.value } : d,
                          ),
                        )
                      }
                      className="rounded-md border border-border bg-surface px-3 py-2 text-text-primary"
                    />
                    <span className="text-text-secondary">to</span>
                    <input
                      type="time"
                      value={day.closesAt}
                      onChange={(e) =>
                        setDays((prev) =>
                          prev.map((d, i) =>
                            i === dayOfWeek ? { ...d, closesAt: e.target.value } : d,
                          ),
                        )
                      }
                      className="rounded-md border border-border bg-surface px-3 py-2 text-text-primary"
                    />
                  </>
                )}
              </div>
            );
          })}
          {hoursError && <p className="text-sm text-red-600">{hoursError}</p>}
          {hoursSaved && <p className="text-sm text-green-700">Saved.</p>}
          <Button type="submit" variant="secondary" disabled={savingHours} className="self-start">
            {savingHours ? "Saving…" : "Save business hours"}
          </Button>
        </form>
      </Card>

      <Card className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium uppercase tracking-wide text-text-secondary">
            Services
          </h2>
          <Button variant="secondary" onClick={() => setShowServiceForm((v) => !v)}>
            {showServiceForm ? "Cancel" : "+ Add service"}
          </Button>
        </div>
        {showServiceForm && (
          <ServiceForm
            locationId={locationId}
            onCreated={(service) => {
              setServices((prev) => [...(prev ?? []), service]);
              setShowServiceForm(false);
            }}
          />
        )}
        <div className="flex flex-col gap-2">
          {services.length === 0 && <p className="text-sm text-text-secondary">No services yet.</p>}
          {services.map((service) => (
            <div
              key={service.id}
              className="flex items-center justify-between rounded-md border border-border px-4 py-3"
            >
              <div>
                <p className="font-medium text-text-primary">{service.name}</p>
                <p className="text-sm text-text-secondary">~{service.durationMinutes} min</p>
              </div>
              <div className="flex items-center gap-3">
                <Badge tone={service.active ? "success" : "neutral"}>
                  {service.active ? "Active" : "Inactive"}
                </Badge>
                <Button
                  variant="secondary"
                  onClick={async () => {
                    const updated = await staffApi.updateService(service.id, {
                      active: !service.active,
                    });
                    setServices((prev) =>
                      (prev ?? []).map((s) => (s.id === updated.id ? updated : s)),
                    );
                  }}
                >
                  {service.active ? "Deactivate" : "Activate"}
                </Button>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </main>
  );
}

function ServiceForm({
  locationId,
  onCreated,
}: {
  locationId: string;
  onCreated: (service: ServiceSummary) => void;
}) {
  const [name, setName] = useState("");
  const [durationMinutes, setDurationMinutes] = useState("15");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();
      setSubmitting(true);
      setError(null);
      try {
        const service = await staffApi.createService({
          locationId,
          name,
          durationMinutes: Number(durationMinutes),
          description: description || undefined,
        });
        onCreated(service);
      } catch (err) {
        setError(errorMessage(err, "Something went wrong."));
      } finally {
        setSubmitting(false);
      }
    },
    [locationId, name, durationMinutes, description, onCreated],
  );

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-3 rounded-md border border-border p-4"
    >
      <Input label="Service name" value={name} onChange={(e) => setName(e.target.value)} required />
      <Input
        label="Duration (minutes)"
        type="number"
        min={1}
        value={durationMinutes}
        onChange={(e) => setDurationMinutes(e.target.value)}
        required
      />
      <Input
        label="Description (optional)"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />
      {error && <p className="text-sm text-red-600">{error}</p>}
      <Button type="submit" disabled={submitting || !name}>
        {submitting ? "Adding…" : "Add service"}
      </Button>
    </form>
  );
}
