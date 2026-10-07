import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { EmailProvider } from "./email-provider";
import { MockEmailProvider } from "./mock-email.provider";
import { PingramEmailProvider } from "./pingram-email.provider";
import { SmtpEmailProvider } from "./smtp-email.provider";
import { SmsProvider } from "./sms-provider";
import { MockSmsProvider } from "./mock-sms.provider";
import { TwilioSmsProvider } from "./twilio-sms.provider";
import { NotificationsService } from "./notifications.service";

/**
 * Email and SMS are independently swappable (ADR-008) — a business could
 * use Pingram for one channel and a different vendor for the other, so
 * each gets its own config switch (`EMAIL_PROVIDER`/`SMS_PROVIDER`) rather
 * than one combined "notification provider" setting. Adding a new vendor
 * for either channel later is a new provider class + one more branch here,
 * never a change to NotificationsService or anything that calls it.
 */
@Module({
  providers: [
    NotificationsService,
    MockEmailProvider,
    PingramEmailProvider,
    SmtpEmailProvider,
    MockSmsProvider,
    TwilioSmsProvider,
    {
      provide: EmailProvider,
      useFactory: (
        config: ConfigService,
        mock: MockEmailProvider,
        pingram: PingramEmailProvider,
        smtp: SmtpEmailProvider,
      ): EmailProvider => {
        const selected = config.get<string>("EMAIL_PROVIDER") ?? "mock";
        if (selected === "mock") return mock;
        if (selected === "pingram") return pingram;
        // Phase 19 — local Mailpit (docker-compose) or any SMTP relay.
        if (selected === "smtp") return smtp;
        throw new Error(
          `Unknown EMAIL_PROVIDER "${selected}" — expected "mock", "pingram" or "smtp".`,
        );
      },
      inject: [ConfigService, MockEmailProvider, PingramEmailProvider, SmtpEmailProvider],
    },
    {
      provide: SmsProvider,
      // Chosen independently of EMAIL_PROVIDER (Phase 20), so email and SMS
      // can come from different vendors. Spending is capped per business per
      // day in NotificationsService (G-29). An unknown value fails at start-up
      // rather than silently falling back to mock.
      useFactory: (
        config: ConfigService,
        mock: MockSmsProvider,
        twilio: TwilioSmsProvider,
      ): SmsProvider => {
        const selected = config.get<string>("SMS_PROVIDER") ?? "mock";
        if (selected === "mock") return mock;
        if (selected === "twilio") return twilio;
        throw new Error(`Unknown SMS_PROVIDER "${selected}" — expected "mock" or "twilio".`);
      },
      inject: [ConfigService, MockSmsProvider, TwilioSmsProvider],
    },
  ],
  // EmailProvider is also exported directly (Phase 9) — CustomerAuthService
  // sends OTP emails straight through it rather than via the outbox
  // (NotificationsService), since a login code must be sent synchronously,
  // not fire-and-forget.
  exports: [NotificationsService, EmailProvider],
})
export class NotificationsModule {}
