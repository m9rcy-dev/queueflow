import {
  addDays,
  dayOfWeekOf,
  formatLocalDate,
  getLocationServiceDate,
  localTimeToUtc,
} from "./timezone.util";

describe("getLocationServiceDate", () => {
  it("returns the local calendar date for the given timezone", () => {
    // 2026-01-01 11:00 UTC is already 2026-01-02 in Pacific/Auckland (UTC+13 in NZDT).
    const utcMoment = new Date("2026-01-01T11:00:00.000Z");
    const result = getLocationServiceDate("Pacific/Auckland", utcMoment);
    expect(result.toISOString()).toBe("2026-01-02T00:00:00.000Z");
  });

  it("two locations in different timezones can be on different service dates at the same instant", () => {
    const instant = new Date("2026-01-01T11:00:00.000Z");
    const auckland = getLocationServiceDate("Pacific/Auckland", instant);
    const losAngeles = getLocationServiceDate("America/Los_Angeles", instant);
    expect(auckland.getTime()).not.toBe(losAngeles.getTime());
  });

  it("is stable across the exact same instant (deterministic, no clock drift)", () => {
    const instant = new Date("2026-06-15T09:00:00.000Z");
    const first = getLocationServiceDate("Pacific/Auckland", instant);
    const second = getLocationServiceDate("Pacific/Auckland", instant);
    expect(first.getTime()).toBe(second.getTime());
  });
});

describe("localTimeToUtc", () => {
  it("converts NZ standard time (UTC+12) wall clock to UTC", () => {
    expect(localTimeToUtc("2026-07-01", 9 * 60, "Pacific/Auckland").toISOString()).toBe(
      "2026-06-30T21:00:00.000Z",
    );
  });

  it("converts NZ daylight time (UTC+13) wall clock to UTC", () => {
    expect(localTimeToUtc("2026-01-15", 9 * 60, "Pacific/Auckland").toISOString()).toBe(
      "2026-01-14T20:00:00.000Z",
    );
  });

  it("uses the post-transition offset on a DST start day (NZ, 2026-09-27)", () => {
    // Clocks jump 02:00 -> 03:00 NZST->NZDT; 09:00 that morning is UTC+13.
    expect(localTimeToUtc("2026-09-27", 9 * 60, "Pacific/Auckland").toISOString()).toBe(
      "2026-09-26T20:00:00.000Z",
    );
  });

  it("handles timezones west of UTC", () => {
    expect(localTimeToUtc("2026-07-01", 9 * 60, "America/Los_Angeles").toISOString()).toBe(
      "2026-07-01T16:00:00.000Z",
    );
  });

  it("round-trips with formatLocalDate", () => {
    const instant = localTimeToUtc("2026-03-10", 23 * 60 + 30, "Pacific/Auckland");
    expect(formatLocalDate("Pacific/Auckland", instant)).toBe("2026-03-10");
  });
});

describe("dayOfWeekOf / addDays", () => {
  it("reads the weekday of a calendar date", () => {
    expect(dayOfWeekOf("2026-10-05")).toBe(1); // a Monday
  });

  it("adds days across a month boundary", () => {
    expect(addDays("2026-10-30", 3)).toBe("2026-11-02");
  });
});
