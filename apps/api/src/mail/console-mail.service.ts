import { Injectable, Logger } from "@nestjs/common";
import { MailService } from "./mail.service";

/**
 * Mock provider for local development (Phase 1) — logs the code instead of
 * sending real email. Read the API log to complete an OTP flow locally.
 * Replaced by a real Pingram-backed implementation in Phase 8 (ADR-008),
 * behind the same MailService abstraction so nothing else changes.
 */
@Injectable()
export class ConsoleMailService extends MailService {
  private readonly logger = new Logger(ConsoleMailService.name);

  async sendLoginCode(email: string, code: string): Promise<void> {
    this.logger.log(`[mock email] Login code for ${email}: ${code}`);
  }

  async sendInviteLink(email: string, tenantName: string, inviteToken: string): Promise<void> {
    this.logger.log(
      `[mock email] Invite for ${email} to join "${tenantName}" — token: ${inviteToken}`,
    );
  }

  async sendInviteCode(email: string, code: string, tenantName: string): Promise<void> {
    this.logger.log(`[mock email] Invite code for ${email} to join "${tenantName}": ${code}`);
  }
}
