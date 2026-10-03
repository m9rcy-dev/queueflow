import { Module } from "@nestjs/common";
import { NotificationsModule } from "../notifications/notifications.module";
import { EmailProviderMailService } from "./email-provider-mail.service";
import { MailService } from "./mail.service";

/**
 * Backed by the same EmailProvider (mock/Pingram) as queue notifications
 * (Phase 12, G-41) — see EmailProviderMailService for why ConsoleMailService
 * (log-only, no real delivery path) was replaced here.
 */
@Module({
  imports: [NotificationsModule],
  providers: [{ provide: MailService, useClass: EmailProviderMailService }],
  exports: [MailService],
})
export class MailModule {}
