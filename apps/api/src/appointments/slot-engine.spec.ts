import { localTimeToUtc } from "../common/timezone.util";
import {
  formatLocalMinutes,
  generateSlots,
  peakOverlap,
  type OccupiedInterval,
  type SlotEngineInput,
} from "./slot-engine";

const TZ = "Pacific/Auckland";
const DATE = "2026-11-10";

function at(minutes: number, date = DATE): Date {
  return localTimeToUtc(date, minutes, TZ);
}

function booking(startMinutes: number, occupiedMinutes: number): OccupiedInterval {
  return { startsAt: at(startMinutes), occupiedUntil: at(startMinutes + occupiedMinutes) };
}

function baseInput(overrides: Partial<SlotEngineInput> = {}): SlotEngineInput {
  return {
    date: DATE,
    timezone: TZ,
    openPeriods: [{ opensAtMinutes: 9 * 60, closesAtMinutes: 10 * 60 }],
    closures: [],
    serviceDurationMinutes: 30,
    slotIntervalMinutes: 15,
    bufferMinutes: 0,
    capacity: 1,
    existing: [],
    maxPerDay: null,
    bookedCountForDay: 0,
    earliestStart: new Date("2000-01-01T00:00:00Z"),
    latestDate: "2099-12-31",
    ...overrides,
  };
}

function localTimes(input: SlotEngineInput): string[] {
  return generateSlots(input).map((slot) => formatLocalMinutes(slot.localMinutes));
}

describe("generateSlots", () => {
  it("steps a fixed grid from opening time and only offers slots that finish by close", () => {
    expect(localTimes(baseInput())).toEqual(["09:00", "09:15", "09:30"]);
  });

  it("returns real UTC instants for the location's timezone", () => {
    const [first] = generateSlots(baseInput());
    // November is NZDT (UTC+13): 09:00 local = 20:00 UTC the previous day.
    expect(first.startsAt.toISOString()).toBe("2026-11-09T20:00:00.000Z");
    expect(first.endsAt.toISOString()).toBe("2026-11-09T20:30:00.000Z");
  });

  it("offers nothing on a day with no business hours", () => {
    expect(localTimes(baseInput({ openPeriods: [] }))).toEqual([]);
  });

  it("generates each split period on its own grid", () => {
    const input = baseInput({
      openPeriods: [
        { opensAtMinutes: 13 * 60 + 10, closesAtMinutes: 14 * 60 },
        { opensAtMinutes: 9 * 60, closesAtMinutes: 9 * 60 + 30 },
      ],
      slotIntervalMinutes: 20,
    });
    expect(localTimes(input)).toEqual(["09:00", "13:10", "13:30"]);
  });

  it("offers nothing when a full-day closure exists", () => {
    expect(localTimes(baseInput({ closures: [{ startMinutes: null, endMinutes: null }] }))).toEqual(
      [],
    );
  });

  it("skips slots overlapping a partial-day closure (closure wins over hours)", () => {
    const input = baseInput({ closures: [{ startMinutes: 9 * 60 + 20, endMinutes: 9 * 60 + 30 }] });
    // 09:00-09:30 and 09:15-09:45 both overlap 09:20-09:30; 09:30 starts as it ends.
    expect(localTimes(input)).toEqual(["09:30"]);
  });

  it("blocks slots overlapping an existing booking at capacity 1", () => {
    const input = baseInput({ existing: [booking(9 * 60, 30)] });
    expect(localTimes(input)).toEqual(["09:30"]);
  });

  it("counts the buffer as occupied after the new slot", () => {
    // A 09:00 slot would occupy until 09:40 with a 10-minute buffer, colliding with 09:30-10:00.
    const input = baseInput({
      bufferMinutes: 10,
      existing: [booking(9 * 60 + 30, 30)],
      openPeriods: [{ opensAtMinutes: 8 * 60 + 30, closesAtMinutes: 10 * 60 }],
    });
    expect(localTimes(input)).toEqual(["08:30", "08:45"]);
  });

  it("lets the buffer run past closing time — only the service must fit", () => {
    const input = baseInput({ bufferMinutes: 30 });
    expect(localTimes(input)).toContain("09:30");
  });

  it("respects an existing booking's own stored buffer (occupiedUntil)", () => {
    const input = baseInput({ existing: [booking(9 * 60, 45)] });
    expect(localTimes(input)).toEqual([]);
  });

  it("allows overlap up to capacity", () => {
    const input = baseInput({ capacity: 2, existing: [booking(9 * 60, 30)] });
    expect(localTimes(input)).toEqual(["09:00", "09:15", "09:30"]);
  });

  it("uses peak overlap, not a plain count, against capacity", () => {
    const input = baseInput({
      capacity: 2,
      existing: [booking(9 * 60, 30), booking(9 * 60 + 30, 30)],
    });
    // 09:15-09:45 overlaps both bookings, but only one at any instant.
    expect(localTimes(input)).toContain("09:15");
  });

  it("offers nothing starting before the minimum lead time", () => {
    const input = baseInput({ earliestStart: at(9 * 60 + 10) });
    expect(localTimes(input)).toEqual(["09:15", "09:30"]);
  });

  it("offers nothing beyond the advance booking window", () => {
    expect(localTimes(baseInput({ latestDate: "2026-11-09" }))).toEqual([]);
  });

  it("offers nothing once the daily cap is reached", () => {
    expect(localTimes(baseInput({ maxPerDay: 3, bookedCountForDay: 3 }))).toEqual([]);
  });

  it("still offers slots below the daily cap", () => {
    expect(localTimes(baseInput({ maxPerDay: 3, bookedCountForDay: 2 }))).toHaveLength(3);
  });

  it("generates correct instants on a DST transition day", () => {
    // 2026-09-27 NZ clocks go forward at 02:00; 09:00 is already NZDT (UTC+13).
    const [first] = generateSlots(baseInput({ date: "2026-09-27" }));
    expect(first.startsAt.toISOString()).toBe("2026-09-26T20:00:00.000Z");
  });
});

describe("peakOverlap", () => {
  it("is zero with no existing bookings", () => {
    expect(peakOverlap([], at(540), at(570))).toBe(0);
  });

  it("ignores bookings that only touch the window's edges", () => {
    expect(peakOverlap([booking(510, 30), booking(570, 30)], at(540), at(570))).toBe(0);
  });

  it("finds a peak that starts inside the window", () => {
    const existing = [booking(500, 60), booking(550, 30), booking(555, 10)];
    expect(peakOverlap(existing, at(540), at(570))).toBe(3);
  });
});
