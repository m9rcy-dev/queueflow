import { Injectable } from "@nestjs/common";
import { EmailProvider } from "../notifications/email-provider";
import { MailService } from "./mail.service";

/**
 * Staff auth email, for real (Phase 12, G-41) — `MailService` was still
 * `ConsoleMailService` (log-only) in every environment including
 * production until now, a real gap: a pilot business's staff OTP codes
 * would otherwise be console-logged in plaintext with no way to actually
 * deliver them. Rather than building a second real provider from scratch,
 * this just delegates to the `EmailProvider` abstraction Phase 8 already
 * proved live (Pingram) — the same `EMAIL_PROVIDER` config switch now
 * governs both staff auth email and customer/queue notification email.
 * `MockEmailProvider` (the default) preserves the exact local-dev
 * experience `ConsoleMailService` gave: read the code from the console log.
 */
@Injectable()
export class EmailProviderMailService extends MailService {
  constructor(private readonly emailProvider: EmailProvider) {
    super();
  }

  async sendLoginCode(email: string, code: string): Promise<void> {
    await this.emailProvider.send({
      to: email,
      subject: "Your QueueFlow login code",
      body: `Your login code is ${code}. It expires in 10 minutes.`,
    });
  }

  async sendInviteLink(email: string, tenantName: string, inviteToken: string): Promise<void> {
    await this.emailProvider.send({
      to: email,
      subject: `You're invited to join ${tenantName} on QueueFlow`,
      body: `You've been invited to join "${tenantName}" on QueueFlow. Use invite code ${inviteToken} to accept — you'll be asked to verify your email next.`,
    });
  }

  async sendInviteCode(email: string, code: string, tenantName: string): Promise<void> {
    await this.emailProvider.send({
      to: email,
      subject: `Your invite code for ${tenantName}`,
      body: `Your invite code for "${tenantName}" is ${code}. It expires in 10 minutes.`,
    });
  }
}
