import { localTimeToUtc } from "../common/timezone.util";

const MINUTE_MS = 60_000;

export interface OpenPeriod {
  opensAtMinutes: number;
  closesAtMinutes: number;
}

export interface ClosureWindow {
  /** Both null = closed all day. */
  startMinutes: number | null;
  endMinutes: number | null;
}

export interface OccupiedInterval {
  startsAt: Date;
  occupiedUntil: Date;
}

export interface SlotEngineInput {
  /** Location-local YYYY-MM-DD. */
  date: string;
  timezone: string;
  /** Business hours for this date's weekday. */
  openPeriods: OpenPeriod[];
  closures: ClosureWindow[];
  serviceDurationMinutes: number;
  slotIntervalMinutes: number;
  bufferMinutes: number;
  /** Location pool size (G-23). */
  capacity: number;
  /** Every BOOKED appointment whose occupied interval touches this date. */
  existing: OccupiedInterval[];
  /** null = no daily cap. */
  maxPerDay: number | null;
  /** BOOKED appointments already on this local date. */
  bookedCountForDay: number;
  /** now + min lead time — no slot may start before this. */
  earliestStart: Date;
  /** Furthest bookable local date (today + advance window), YYYY-MM-DD. */
  latestDate: string;
}

export interface GeneratedSlot {
  startsAt: Date;
  endsAt: Date;
  /** Minutes past local midnight, for HH:MM display. */
  localMinutes: number;
}

/**
 * Backend-authoritative slot generation (plan §34, G-22/ADR-012). A pure
 * function so every rule is unit-testable without a database; the caller
 * gathers the inputs, and the booking path re-runs it inside the location
 * lock to re-validate a requested start.
 *
 * A slot [t, t + duration) is offered when it sits on the fixed grid
 * (opening time + k × interval), fits inside one open period, overlaps no
 * closure, starts no earlier than `earliestStart`, and the peak number of
 * existing bookings overlapping [t, t + duration + buffer) is below
 * capacity. The buffer occupies capacity but needn't fit before closing.
 */
export function generateSlots(input: SlotEngineInput): GeneratedSlot[] {
  if (input.date > input.latestDate) return [];
  if (input.maxPerDay !== null && input.bookedCountForDay >= input.maxPerDay) return [];
  if (input.closures.some(isFullDay)) return [];

  const slots: GeneratedSlot[] = [];
  const periods = [...input.openPeriods].sort((a, b) => a.opensAtMinutes - b.opensAtMinutes);

  for (const period of periods) {
    for (
      let start = period.opensAtMinutes;
      start + input.serviceDurationMinutes <= period.closesAtMinutes;
      start += input.slotIntervalMinutes
    ) {
      const end = start + input.serviceDurationMinutes;
      if (input.closures.some((closure) => overlapsClosure(closure, start, end))) continue;

      const startsAt = localTimeToUtc(input.date, start, input.timezone);
      if (startsAt < input.earliestStart) continue;

      const endsAt = new Date(startsAt.getTime() + input.serviceDurationMinutes * MINUTE_MS);
      const occupiedUntil = new Date(endsAt.getTime() + input.bufferMinutes * MINUTE_MS);
      if (peakOverlap(input.existing, startsAt, occupiedUntil) >= input.capacity) continue;

      slots.push({ startsAt, endsAt, localMinutes: start });
    }
  }
  return slots;
}

function isFullDay(closure: ClosureWindow): boolean {
  return closure.startMinutes === null || closure.endMinutes === null;
}

function overlapsClosure(closure: ClosureWindow, start: number, end: number): boolean {
  if (isFullDay(closure)) return true;
  return start < closure.endMinutes! && end > closure.startMinutes!;
}

/**
 * The most existing bookings simultaneously in progress at any instant in
 * [from, to). Peak, not a plain overlap count: with capacity 2, bookings
 * at 9:00–9:30 and 9:30–10:00 both overlap 9:15–9:45 but never at the same
 * moment, so a third booking there still fits. The peak is always reached
 * at `from` or at some existing booking's start inside the window.
 */
export function peakOverlap(existing: OccupiedInterval[], from: Date, to: Date): number {
  const overlapping = existing.filter((e) => e.startsAt < to && e.occupiedUntil > from);
  const checkpoints = [
    from,
    ...overlapping.map((e) => e.startsAt).filter((startsAt) => startsAt > from),
  ];
  let peak = 0;
  for (const point of checkpoints) {
    const active = overlapping.filter((e) => e.startsAt <= point && e.occupiedUntil > point).length;
    peak = Math.max(peak, active);
  }
  return peak;
}

/** HH:MM for minutes past local midnight. */
export function formatLocalMinutes(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  return `${String(hours).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}
