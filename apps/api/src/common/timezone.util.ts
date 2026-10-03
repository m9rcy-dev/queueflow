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

/** A location-local calendar date as YYYY-MM-DD — the string form of getLocationServiceDate. */
export function formatLocalDate(timezone: string, instant: Date): string {
  return getLocationServiceDate(timezone, instant).toISOString().slice(0, 10);
}

/** How far ahead of UTC the timezone's wall clock is at `instant`, in ms (negative west of Greenwich). */
function timezoneOffsetMs(timezone: string, instant: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value);
  const wallClockAsUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second"),
  );
  return wallClockAsUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/**
 * The UTC instant at which a location's wall clock reads `minutes` past
 * local midnight on `date` (YYYY-MM-DD). DST-safe: the offset is re-read at
 * the first guess, so a time on a transition day uses that day's actual
 * offset. A wall-clock time that doesn't exist (inside a spring-forward
 * gap) resolves to the instant one gap-length later — acceptable, since no
 * business opens in the small hours a DST jump happens in.
 */
export function localTimeToUtc(date: string, minutes: number, timezone: string): Date {
  const [year, month, day] = date.split("-").map(Number);
  const wallClockAsUtc = Date.UTC(year, month - 1, day, 0, minutes);
  const firstGuess = wallClockAsUtc - timezoneOffsetMs(timezone, new Date(wallClockAsUtc));
  const corrected = wallClockAsUtc - timezoneOffsetMs(timezone, new Date(firstGuess));
  return new Date(corrected);
}

/** 0=Sunday .. 6=Saturday for a YYYY-MM-DD calendar date (independent of any timezone — it's already a local date). */
export function dayOfWeekOf(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

/** Adds whole calendar days to a YYYY-MM-DD date. */
export function addDays(date: string, days: number): string {
  const base = new Date(`${date}T00:00:00Z`);
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}
