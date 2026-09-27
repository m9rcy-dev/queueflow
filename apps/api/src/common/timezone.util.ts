/**
 * The current calendar date in a location's own timezone, as a plain Date
 * representing local midnight — this is what ticket-number counters (G-10)
 * reset against, not UTC midnight. Two different locations in two
 * different timezones can be on "different ticket days" at the same
 * instant, which is exactly the point.
 */
export function getLocationServiceDate(timezone: string, now: Date = new Date()): Date {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  // en-CA formats as YYYY-MM-DD, which parses unambiguously below.
  const dateString = formatter.format(now);
  return new Date(`${dateString}T00:00:00.000Z`);
}
