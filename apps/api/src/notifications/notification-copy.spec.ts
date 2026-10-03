import {
  buildAppointmentBookedMessage,
  buildAppointmentCancelledMessage,
  buildEmailSubject,
  formatAppointmentTime,
} from "./notification-copy";

describe("appointment notification copy (Phase 13)", () => {
  it("formats the time in the location's timezone, not the server's", () => {
    // 2026-11-09T20:00Z is 09:00 on Tue 10 Nov in Auckland (NZDT, UTC+13).
    const when = formatAppointmentTime(new Date("2026-11-09T20:00:00Z"), "Pacific/Auckland");
    expect(when).toMatch(/Tue/);
    expect(when).toMatch(/10 Nov/);
    expect(when).toMatch(/9:00/);
  });

  it("includes the manage link in the booked message", () => {
    const body = buildAppointmentBookedMessage({
      businessName: "Joe's",
      serviceName: "Haircut",
      when: "Tue 10 Nov, 9:00 am",
      manageUrl: "https://q.example/appointment/abc",
    });
    expect(body).toContain("https://q.example/appointment/abc");
    expect(body).toContain("Haircut");
  });

  it("says who cancelled", () => {
    const params = { businessName: "Joe's", serviceName: "Haircut", when: "Tue 10 Nov" };
    expect(buildAppointmentCancelledMessage({ ...params, cancelledByBusiness: true })).toContain(
      "by the business",
    );
    expect(
      buildAppointmentCancelledMessage({ ...params, cancelledByBusiness: false }),
    ).not.toContain("by the business");
  });

  it("has an email subject for each appointment type", () => {
    expect(buildEmailSubject("APPOINTMENT_BOOKED")).toBeTruthy();
    expect(buildEmailSubject("APPOINTMENT_CANCELLED")).toBeTruthy();
  });
});
