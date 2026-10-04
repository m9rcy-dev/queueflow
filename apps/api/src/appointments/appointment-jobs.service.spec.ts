import { nearestDueOffset } from "./appointment-jobs.service";

const START = new Date("2026-10-10T09:00:00Z");
const hoursBefore = (h: number): Date => new Date(START.getTime() - h * 3_600_000);

describe("nearestDueOffset (§75 reminders)", () => {
  const offsets = [1440, 120]; // 24h and 2h

  it("is null before any reminder is due", () => {
    expect(nearestDueOffset(offsets, START, hoursBefore(72), hoursBefore(30))).toBeNull();
  });

  it("returns the 24h reminder once it's due", () => {
    expect(nearestDueOffset(offsets, START, hoursBefore(72), hoursBefore(23))).toBe(1440);
  });

  it("returns only the nearest when several are due (no stale burst)", () => {
    expect(nearestDueOffset(offsets, START, hoursBefore(72), hoursBefore(1))).toBe(120);
  });

  it("skips a reminder whose moment had passed when the booking was made", () => {
    // Booked 3h ahead: no "24 hours to go", but the 2h one still applies.
    expect(nearestDueOffset(offsets, START, hoursBefore(3), hoursBefore(2.5))).toBeNull();
    expect(nearestDueOffset(offsets, START, hoursBefore(3), hoursBefore(1.5))).toBe(120);
  });

  it("is null with no reminders configured", () => {
    expect(nearestDueOffset([], START, hoursBefore(72), hoursBefore(1))).toBeNull();
  });
});
