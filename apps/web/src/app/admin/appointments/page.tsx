"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Badge, Button, Card, Input } from "@queueflow/ui";
import { ApiError } from "@queueflow/api-client";
import type {
  AppointmentCalendarDay,
  AppointmentCancellationReason,
  AppointmentSlot,
  LocationSummary,
  ServiceSummary,
  StaffAppointmentSummary,
} from "@queueflow/types";
import { staffApi } from "../../../lib/staff-api-client";
import { publicApi } from "../../../lib/api-client";
import { useStaffSession } from "../../../lib/use-staff-session";
import { AdminNav } from "../../../components/AdminNav";
import {
  CANCELLATION_REASON_LABELS,
  formatLocalDate,
  formatTimeIn,
  todayIn,
} from "../../../lib/appointment-format";

const WEEKDAY_HEADINGS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback;
}

function shiftMonth(month: string, delta: number): string {
  const d = new Date(`${month}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + delta);
  return d.toISOString().slice(0, 7);
}

function monthLabel(month: string): string {
  return new Intl.DateTimeFormat("en-NZ", {
    timeZone: "UTC",
    month: "long",
    year: "numeric",
  }).format(new Date(`${month}-01T00:00:00Z`));
}

/** Leading nulls pad the first week so day 1 lands under its weekday. */
function monthCells(month: string): Array<string | null> {
  const first = new Date(`${month}-01T00:00:00Z`);
  const daysInMonth = new Date(
    Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0),
  ).getUTCDate();
  const cells: Array<string | null> = Array(first.getUTCDay()).fill(null);
  for (let day = 1; day <= daysInMonth; day += 1) {
    cells.push(`${month}-${String(day).padStart(2, "0")}`);
  }
  return cells;
}

/**
 * The business appointment calendar (plan-review §5.5): a month view with a
 * booking count per day, drilling into one day's list, where staff can
 * cancel any booking with a required reason or take a booking by phone.
 */
export default function AppointmentsPage() {
  const session = useStaffSession();
  const [locations, setLocations] = useState<LocationSummary[] | null>(null);
  const [locationId, setLocationId] = useState("");
  const [appointmentsOn, setAppointmentsOn] = useState<boolean | null>(null);

  useEffect(() => {
    if (!session) return;
    staffApi.getTenant().then((tenant) => setAppointmentsOn(tenant.appointmentEnabled));
    staffApi.listLocations().then((list) => {
      setLocations(list);
      if (list.length > 0) setLocationId(list[0].id);
    });
  }, [session]);

  if (!session || !locations || appointmentsOn === null) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-bg text-text-secondary">
        Loading…
      </main>
    );
  }

  const location = locations.find((l) => l.id === locationId) ?? null;

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-6 bg-bg p-6">
      <header className="pt-4">
        <h1 className="mb-4 text-xl font-semibold text-text-primary">Appointments</h1>
        <AdminNav current="appointments" role={session.role} />
      </header>

      {!appointmentsOn && (
        <Card>
          <p className="text-text-secondary">
            Appointments are turned off for this business. Turn them on in Settings, then mark
            services as bookable on a location&apos;s page.
          </p>
        </Card>
      )}

      {locations.length > 1 && (
        <label className="flex flex-col gap-1.5 text-sm font-medium text-text-primary">
          Location
          <select
            value={locationId}
            onChange={(e) => setLocationId(e.target.value)}
            className="min-h-[48px] rounded-md border border-border bg-surface px-4 text-base"
          >
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
      )}

      {location ? (
        <LocationCalendar key={location.id} location={location} />
      ) : (
        <Card>
          <p className="text-text-secondary">Add a location first.</p>
        </Card>
      )}
    </main>
  );
}

function LocationCalendar({ location }: { location: LocationSummary }) {
  const today = todayIn(location.timezone);
  const [month, setMonth] = useState(today.slice(0, 7));
  const [selectedDate, setSelectedDate] = useState(today);
  const [counts, setCounts] = useState<AppointmentCalendarDay[]>([]);
  const [dayList, setDayList] = useState<StaffAppointmentSummary[] | null>(null);
  const [showBookingForm, setShowBookingForm] = useState(false);

  const refreshMonth = useCallback(async () => {
    setCounts(await staffApi.getAppointmentCalendar(location.id, month));
  }, [location.id, month]);

  const refreshDay = useCallback(async () => {
    setDayList(await staffApi.listAppointmentsForDay(location.id, selectedDate));
  }, [location.id, selectedDate]);

  useEffect(() => {
    void refreshMonth();
  }, [refreshMonth]);

  useEffect(() => {
    setDayList(null);
    void refreshDay();
  }, [refreshDay]);

  async function refreshAll(): Promise<void> {
    await Promise.all([refreshMonth(), refreshDay()]);
  }

  const countByDate = new Map(counts.map((c) => [c.date, c.count]));

  return (
    <>
      <Card className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <Button
            variant="secondary"
            onClick={() => setMonth(shiftMonth(month, -1))}
            aria-label="Previous month"
          >
            ‹
          </Button>
          <h2 className="text-lg font-medium text-text-primary">{monthLabel(month)}</h2>
          <Button
            variant="secondary"
            onClick={() => setMonth(shiftMonth(month, 1))}
            aria-label="Next month"
          >
            ›
          </Button>
        </div>
        <div className="grid grid-cols-7 gap-1 text-center text-sm">
          {WEEKDAY_HEADINGS.map((heading) => (
            <div key={heading} className="py-1 font-medium text-text-secondary">
              {heading}
            </div>
          ))}
          {monthCells(month).map((date, index) => {
            if (!date) return <div key={`blank-${index}`} />;
            const count = countByDate.get(date) ?? 0;
            const isSelected = date === selectedDate;
            return (
              <button
                key={date}
                type="button"
                onClick={() => setSelectedDate(date)}
                aria-pressed={isSelected}
                aria-label={`${formatLocalDate(date)}: ${count} booking${count === 1 ? "" : "s"}`}
                className={[
                  "flex min-h-[56px] flex-col items-center justify-center rounded-md border",
                  isSelected ? "border-primary bg-surface" : "border-transparent hover:bg-surface",
                  date === today ? "font-semibold" : "",
                ].join(" ")}
              >
                <span className="text-text-primary">{Number(date.slice(8))}</span>
                {count > 0 && (
                  <span className="mt-0.5 rounded-sm bg-blue-50 px-1.5 text-xs text-blue-700">
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </Card>

      <Card className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-medium text-text-primary">{formatLocalDate(selectedDate)}</h2>
          <Button variant="secondary" onClick={() => setShowBookingForm((v) => !v)}>
            {showBookingForm ? "Close" : "+ Phone booking"}
          </Button>
        </div>

        {showBookingForm && (
          <StaffBookingForm
            location={location}
            date={selectedDate}
            onBooked={async () => {
              setShowBookingForm(false);
              await refreshAll();
            }}
          />
        )}

        {dayList === null && <p className="text-sm text-text-secondary">Loading…</p>}
        {dayList?.length === 0 && (
          <p className="text-sm text-text-secondary">No appointments on this day.</p>
        )}
        {dayList?.map((appointment) => (
          <AppointmentRow
            key={appointment.id}
            appointment={appointment}
            timezone={location.timezone}
            isToday={selectedDate === today}
            onChanged={refreshAll}
          />
        ))}
      </Card>
    </>
  );
}

const STATUS_BADGE: Record<
  StaffAppointmentSummary["status"],
  { label: string; tone: "info" | "success" | "warning" | "neutral" }
> = {
  BOOKED: { label: "Booked", tone: "info" },
  CHECKED_IN: { label: "Checked in", tone: "success" },
  NO_SHOW: { label: "No-show", tone: "warning" },
  CANCELLED: { label: "Cancelled", tone: "neutral" },
};

function AppointmentRow({
  appointment,
  timezone,
  isToday,
  onChanged,
}: {
  appointment: StaffAppointmentSummary;
  timezone: string;
  isToday: boolean;
  onChanged: () => Promise<void>;
}) {
  const [acting, setActing] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState<AppointmentCancellationReason | "">("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isBooked = appointment.status === "BOOKED";

  /** Check-in and restore (Phase 14) — one-tap actions, errors shown inline. */
  async function runAction(action: () => Promise<unknown>): Promise<void> {
    setActing(true);
    setError(null);
    try {
      await action();
      await onChanged();
    } catch (err) {
      setError(errorMessage(err, "Something went wrong."));
    } finally {
      setActing(false);
    }
  }

  async function handleCancel(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!reason) return;
    setSubmitting(true);
    setError(null);
    try {
      await staffApi.cancelAppointment(appointment.id, { reason, note: note || undefined });
      // The row stays mounted (same key) once the list refreshes, so its
      // form state has to be reset here, not left for an unmount.
      setCancelling(false);
      setSubmitting(false);
      await onChanged();
    } catch (err) {
      setError(errorMessage(err, "Something went wrong."));
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-md border border-border px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-medium text-text-primary">
            {formatTimeIn(appointment.startsAt, timezone)}–
            {formatTimeIn(appointment.endsAt, timezone)} ·{" "}
            {appointment.customer.firstName ?? "Customer"}
          </p>
          <p className="text-sm text-text-secondary">
            {appointment.service.name} · {appointment.customer.phoneE164}
            {appointment.bookedByStaff ? " · booked by staff" : ""}
          </p>
          {appointment.status === "CANCELLED" && appointment.cancellationReason && (
            <p className="text-sm text-text-secondary">
              Cancelled: {CANCELLATION_REASON_LABELS[appointment.cancellationReason]}
              {appointment.cancellationNote ? ` (${appointment.cancellationNote})` : ""}
            </p>
          )}
        </div>
        <div className="flex items-center gap-3">
          <Badge tone={STATUS_BADGE[appointment.status].tone}>
            {STATUS_BADGE[appointment.status].label}
          </Badge>
          {isBooked && isToday && !cancelling && (
            <Button
              disabled={acting}
              onClick={() => runAction(() => staffApi.checkInAppointment(appointment.id))}
            >
              {acting ? "Checking in…" : "Check in"}
            </Button>
          )}
          {appointment.status === "NO_SHOW" && isToday && (
            <Button
              variant="secondary"
              disabled={acting}
              onClick={() => runAction(() => staffApi.restoreAppointment(appointment.id))}
            >
              {acting ? "Restoring…" : "Undo no-show"}
            </Button>
          )}
          {isBooked && !cancelling && (
            <Button variant="destructive" onClick={() => setCancelling(true)}>
              Cancel
            </Button>
          )}
        </div>
      </div>

      {error && !cancelling && <p className="text-sm text-red-600">{error}</p>}
      {cancelling && (
        <form onSubmit={handleCancel} className="flex flex-col gap-3 border-t border-border pt-3">
          <label className="flex flex-col gap-1.5 text-sm font-medium text-text-primary">
            Reason
            <select
              value={reason}
              onChange={(e) => setReason(e.target.value as AppointmentCancellationReason)}
              required
              className="min-h-[48px] rounded-md border border-border bg-surface px-4 text-base"
            >
              <option value="" disabled>
                Choose a reason
              </option>
              {Object.entries(CANCELLATION_REASON_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <Input label="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
          <p className="text-sm text-text-secondary">The customer will be told it was cancelled.</p>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex gap-3">
            <Button type="submit" variant="destructive" disabled={submitting || !reason}>
              {submitting ? "Cancelling…" : "Cancel appointment"}
            </Button>
            <Button type="button" variant="secondary" onClick={() => setCancelling(false)}>
              Keep it
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}

/** A booking taken by phone — the same slot rules as online, offered from the public availability endpoint. */
function StaffBookingForm({
  location,
  date,
  onBooked,
}: {
  location: LocationSummary;
  date: string;
  onBooked: () => Promise<void>;
}) {
  const [services, setServices] = useState<ServiceSummary[] | null>(null);
  const [serviceId, setServiceId] = useState("");
  const [slots, setSlots] = useState<AppointmentSlot[] | null>(null);
  const [startsAt, setStartsAt] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    staffApi.listServices(location.id).then((list) => {
      const bookable = list.filter((s) => s.active && s.appointmentEnabled);
      setServices(bookable);
      if (bookable.length === 1) setServiceId(bookable[0].id);
    });
  }, [location.id]);

  useEffect(() => {
    if (!serviceId) return;
    setSlots(null);
    setStartsAt("");
    publicApi
      .getAppointmentAvailability(location.id, serviceId, date)
      .then((availability) => setSlots(availability.slots))
      .catch((err) => setError(errorMessage(err, "Couldn't load times.")));
  }, [location.id, serviceId, date]);

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await staffApi.bookAppointmentForCustomer(location.id, {
        serviceId,
        startsAt,
        customerName,
        customerPhone,
      });
      await onBooked();
    } catch (err) {
      setError(errorMessage(err, "Something went wrong."));
      setSubmitting(false);
    }
  }

  if (services?.length === 0) {
    return (
      <p className="text-sm text-text-secondary">
        No bookable services at this location yet. Mark one as bookable on the location&apos;s page.
      </p>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-3 rounded-md border border-border p-4"
    >
      <label className="flex flex-col gap-1.5 text-sm font-medium text-text-primary">
        Service
        <select
          value={serviceId}
          onChange={(e) => setServiceId(e.target.value)}
          required
          className="min-h-[48px] rounded-md border border-border bg-surface px-4 text-base"
        >
          <option value="" disabled>
            Choose a service
          </option>
          {services?.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} (~{s.durationMinutes} min)
            </option>
          ))}
        </select>
      </label>
      {serviceId && (
        <label className="flex flex-col gap-1.5 text-sm font-medium text-text-primary">
          Time
          <select
            value={startsAt}
            onChange={(e) => setStartsAt(e.target.value)}
            required
            disabled={!slots || slots.length === 0}
            className="min-h-[48px] rounded-md border border-border bg-surface px-4 text-base"
          >
            <option value="" disabled>
              {slots === null
                ? "Loading…"
                : slots.length === 0
                  ? "No times available this day"
                  : "Choose a time"}
            </option>
            {slots?.map((slot) => (
              <option key={slot.startsAt} value={slot.startsAt}>
                {slot.localTime}
              </option>
            ))}
          </select>
        </label>
      )}
      <Input
        label="Customer name"
        value={customerName}
        onChange={(e) => setCustomerName(e.target.value)}
        required
      />
      <Input
        label="Customer mobile"
        type="tel"
        value={customerPhone}
        onChange={(e) => setCustomerPhone(e.target.value)}
        required
      />
      {error && <p className="text-sm text-red-600">{error}</p>}
      <Button type="submit" disabled={submitting || !startsAt} className="self-start">
        {submitting ? "Booking…" : "Book appointment"}
      </Button>
    </form>
  );
}
