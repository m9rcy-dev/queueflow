"use client";

/**
 * "Add to calendar" for a booking (Phase 19): Google Calendar by link, and
 * an .ics file (Apple Calendar, Outlook, anything else). Times are UTC, so
 * every calendar shows them in the viewer's own zone. The event links back
 * to this page, where the customer checks in or cancels.
 */
export function AddToCalendar({
  title,
  startsAt,
  endsAt,
  location,
  token,
}: {
  title: string;
  startsAt: string;
  endsAt: string;
  location: string;
  token: string;
}) {
  const pageUrl = typeof window !== "undefined" ? window.location.href : "";
  const stamp = (iso: string) =>
    new Date(iso)
      .toISOString()
      .replace(/[-:]/g, "")
      .replace(/\.\d{3}/, "");
  const details = `Check in or cancel: ${pageUrl}`;

  const google = `https://calendar.google.com/calendar/render?${new URLSearchParams({
    action: "TEMPLATE",
    text: title,
    dates: `${stamp(startsAt)}/${stamp(endsAt)}`,
    details,
    location,
  }).toString()}`;

  function downloadIcs(): void {
    // RFC 5545 text escaping for commas, semicolons, backslashes and newlines.
    const esc = (text: string) =>
      text
        .replace(/\\/g, "\\\\")
        .replace(/([,;])/g, "\\$1")
        .replace(/\n/g, "\\n");
    const ics = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//QueueFlow//Appointments//EN",
      "BEGIN:VEVENT",
      `UID:${token}@queueflow`,
      `DTSTAMP:${stamp(new Date().toISOString())}`,
      `DTSTART:${stamp(startsAt)}`,
      `DTEND:${stamp(endsAt)}`,
      `SUMMARY:${esc(title)}`,
      `LOCATION:${esc(location)}`,
      `DESCRIPTION:${esc(details)}`,
      `URL:${pageUrl}`,
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    const url = URL.createObjectURL(new Blob([ics], { type: "text/calendar;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "appointment.ics";
    link.click();
    URL.revokeObjectURL(url);
  }

  const buttonClass =
    "inline-flex min-h-[44px] flex-1 items-center justify-center rounded-md border border-border bg-surface px-4 text-sm font-medium text-text-primary hover:bg-bg";
  return (
    <div className="flex flex-col gap-2">
      <p className="text-center text-sm text-text-secondary">Add to your calendar</p>
      <div className="flex flex-wrap gap-2">
        <a href={google} target="_blank" rel="noopener noreferrer" className={buttonClass}>
          Google Calendar
        </a>
        <button type="button" onClick={downloadIcs} className={buttonClass}>
          Apple / Outlook (.ics)
        </button>
      </div>
    </div>
  );
}
