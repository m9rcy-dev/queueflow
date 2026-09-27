import { getLocationServiceDate } from "./timezone.util";

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
