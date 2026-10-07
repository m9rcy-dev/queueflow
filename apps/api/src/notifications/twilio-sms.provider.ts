import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { SmsProvider, type SmsSendRequest } from "./sms-provider";

interface TwilioErrorBody {
  code?: number;
  message?: string;
}

/**
 * Real SMS through Twilio (Phase 20) — chosen with `SMS_PROVIDER=twilio`,
 * independently of the email provider, so email and SMS never depend on the
 * same vendor. Uses Twilio's REST API directly (no SDK). Sends from either a
 * Messaging Service (`TWILIO_MESSAGING_SERVICE_SID`, preferred — it picks a
 * sender that works in the recipient's country) or a number
 * (`TWILIO_FROM_NUMBER`). Never logs the auth token. Spending is capped per
 * business per day in NotificationsService (G-29).
 */
@Injectable()
export class TwilioSmsProvider extends SmsProvider {
  private readonly logger = new Logger(TwilioSmsProvider.name);

  constructor(private readonly config: ConfigService) {
    super();
  }

  async send(request: SmsSendRequest): Promise<void> {
    const accountSid = this.config.get<string>("TWILIO_ACCOUNT_SID");
    const authToken = this.config.get<string>("TWILIO_AUTH_TOKEN");
    const messagingServiceSid = this.config.get<string>("TWILIO_MESSAGING_SERVICE_SID");
    const fromNumber = this.config.get<string>("TWILIO_FROM_NUMBER");
    if (!accountSid || !authToken || (!messagingServiceSid && !fromNumber)) {
      throw new Error(
        "Twilio isn't configured: set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_MESSAGING_SERVICE_SID (or TWILIO_FROM_NUMBER).",
      );
    }

    const form = new URLSearchParams({ To: request.to, Body: request.body });
    if (messagingServiceSid) form.set("MessagingServiceSid", messagingServiceSid);
    else if (fromNumber) form.set("From", fromNumber);

    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: form.toString(),
      },
    );
    if (!response.ok) {
      const error = (await response.json().catch(() => ({}))) as TwilioErrorBody;
      const message = error.message ?? response.statusText;
      this.logger.error(
        `Twilio SMS send failed (${response.status}, code ${error.code ?? "?"}): ${message}`,
      );
      throw new Error(`Twilio SMS send failed: ${message}`);
    }
  }
}
