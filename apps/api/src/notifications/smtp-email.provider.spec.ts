import { ConfigService } from "@nestjs/config";
import * as nodemailer from "nodemailer";
import { SmtpEmailProvider } from "./smtp-email.provider";

jest.mock("nodemailer", () => ({ createTransport: jest.fn() }));

describe("SmtpEmailProvider (Phase 19 — local Mailpit)", () => {
  const sendMail = jest.fn().mockResolvedValue({});
  beforeEach(() => {
    jest.mocked(nodemailer.createTransport).mockReturnValue({ sendMail } as never);
    sendMail.mockClear();
  });

  const config = (values: Record<string, string>) =>
    ({ get: (key: string) => values[key] }) as unknown as ConfigService;

  it("defaults to docker-compose's Mailpit with no credentials, and sends text plus escaped HTML", async () => {
    const provider = new SmtpEmailProvider(config({}));
    await provider.send({ to: "a@example.com", subject: "Hi", body: "Code <123456>\nThanks" });

    expect(nodemailer.createTransport).toHaveBeenCalledWith({
      host: "localhost",
      port: 1026,
      secure: false,
      requireTLS: false,
      auth: undefined,
    });
    expect(sendMail).toHaveBeenCalledWith({
      from: "QueueFlow <noreply@queueflow.local>",
      to: "a@example.com",
      subject: "Hi",
      text: "Code <123456>\nThanks",
      html: "<p>Code &lt;123456&gt;<br>Thanks</p>",
    });
  });

  it("uses configured host, port, TLS and credentials", async () => {
    const provider = new SmtpEmailProvider(
      config({
        SMTP_HOST: "smtp.example.com",
        SMTP_PORT: "465",
        SMTP_SECURE: "true",
        SMTP_USER: "u",
        SMTP_PASSWORD: "p",
        SMTP_FROM: "Biz <b@example.com>",
        NODE_ENV: "production",
      }),
    );
    await provider.send({ to: "a@example.com", subject: "Hi", body: "x" });
    expect(nodemailer.createTransport).toHaveBeenCalledWith({
      host: "smtp.example.com",
      port: 465,
      secure: true,
      requireTLS: true,
      auth: { user: "u", pass: "p" },
    });
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ from: "Biz <b@example.com>" }));
  });
});
