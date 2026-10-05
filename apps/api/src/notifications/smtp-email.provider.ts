import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as nodemailer from "nodemailer";
import { EmailProvider, type EmailSendRequest } from "./email-provider";

/**
 * Plain SMTP (Phase 19) — for local development against Mailpit
 * (docker-compose, http://localhost:8026), so every login code, invite and
 * queue notification can actually be read in an inbox instead of the API
 * log. `EMAIL_PROVIDER=smtp`. Works with any SMTP relay; credentials are
 * optional because Mailpit takes none (some servers reject empty ones).
 */
@Injectable()
export class SmtpEmailProvider extends EmailProvider {
  private transporter: nodemailer.Transporter | null = null;

  constructor(private readonly config: ConfigService) {
    super();
  }

  async send(request: EmailSendRequest): Promise<void> {
    await this.transport().sendMail({
      from: this.config.get<string>("SMTP_FROM") ?? "QueueFlow <noreply@queueflow.local>",
      to: request.to,
      subject: request.subject,
      text: request.body,
      html: request.html ?? `<p>${escapeHtml(request.body).replace(/\n/g, "<br>")}</p>`,
    });
  }

  // Created on first send, so choosing another provider never opens a connection.
  private transport(): nodemailer.Transporter {
    if (!this.transporter) {
      const user = this.config.get<string>("SMTP_USER");
      const pass = this.config.get<string>("SMTP_PASSWORD");
      this.transporter = nodemailer.createTransport({
        host: this.config.get<string>("SMTP_HOST") ?? "localhost",
        port: Number(this.config.get<string>("SMTP_PORT") ?? 1026),
        secure: this.config.get<string>("SMTP_SECURE") === "true",
        auth: user && pass ? { user, pass } : undefined,
      });
    }
    return this.transporter;
  }
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
