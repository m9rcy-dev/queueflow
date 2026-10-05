import {
  buildAppointmentBookedMessage,
  buildAppointmentCancelledMessage,
  buildEmailSubject,
  buildQrEmailHtml,
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

describe("buildQrEmailHtml (Phase 19)", () => {
  it("escapes the text, keeps links clickable, and puts the QR image under it", () => {
    const html = buildQrEmailHtml({
      text: `<b>Bob's</b> & Co: you're in.\n\nOpen: https://q.example.com/queue/t/abc`,
      qrImageUrl: "https://api.example.com/public/queue-entries/abc/qr.png",
      qrCaption: "Ticket #3",
    });
    expect(html).toContain("&lt;b&gt;Bob's&lt;/b&gt; &amp; Co");
    expect(html).not.toContain("<b>");
    expect(html).toContain('<a href="https://q.example.com/queue/t/abc"');
    expect(html).toContain('<img src="https://api.example.com/public/queue-entries/abc/qr.png"');
    expect(html).toContain("Ticket #3");
  });
});
