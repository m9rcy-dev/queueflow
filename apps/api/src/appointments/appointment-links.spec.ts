import type { ConfigService } from "@nestjs/config";
import { googleCalendarUrl, ticketUrl } from "./appointment-links";

describe("appointment links (Phase 19)", () => {
  it("builds the ticket link from WEB_APP_URL, defaulting to the local web port", () => {
    const config = (url?: string) => ({ get: () => url }) as unknown as ConfigService;
    expect(ticketUrl(config("https://q.example.com/"), "tok")).toBe(
      "https://q.example.com/queue/t/tok",
    );
    expect(ticketUrl(config(), "tok")).toBe("http://localhost:4000/queue/t/tok");
  });

  it("builds a Google Calendar event link in UTC basic format", () => {
    const url = new URL(
      googleCalendarUrl({
        title: "Haircut — Demo Barbers",
        startsAt: new Date("2026-10-06T21:30:00.000Z"),
        endsAt: new Date("2026-10-06T22:00:00.000Z"),
        details: "Check in: https://x/appointment/t",
        location: "Demo Barbers, Riccarton",
      }),
    );
    expect(url.origin + url.pathname).toBe("https://calendar.google.com/calendar/render");
    expect(url.searchParams.get("action")).toBe("TEMPLATE");
    expect(url.searchParams.get("dates")).toBe("20261006T213000Z/20261006T220000Z");
    expect(url.searchParams.get("text")).toBe("Haircut — Demo Barbers");
  });
});
