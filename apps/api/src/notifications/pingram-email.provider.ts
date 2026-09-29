import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { EmailProvider, type EmailSendRequest } from "./email-provider";

const PINGRAM_EMAIL_ENDPOINT = "https://api.pingram.io/email";

interface PingramErrorBody {
  error?: { code?: string; message?: string; fix?: string };
}

/**
 * Real email delivery via Pingram (pingram.io) — Phase 8/ADR-008. Behind
 * the same EmailProvider interface MockEmailProvider implements, so
 * choosing this over the mock is the `EMAIL_PROVIDER=pingram` config
 * switch in notifications.module.ts, not a rewrite of anything that calls
 * send(). Never logs PINGRAM_API_KEY itself, in a success or failure path
 * — only what Pingram's own response reports went wrong.
 */
@Injectable()
export class PingramEmailProvider extends EmailProvider {
  private readonly logger = new Logger(PingramEmailProvider.name);

  constructor(private readonly configService: ConfigService) {
    super();
  }

  async send(request: EmailSendRequest): Promise<void> {
    const apiKey = this.configService.get<string>("PINGRAM_API_KEY");
    if (!apiKey) {
      throw new Error(
        "PINGRAM_API_KEY is not configured — set it in apps/api/.env before using EMAIL_PROVIDER=pingram.",
      );
    }
    const fromAddress = this.configService.get<string>("PINGRAM_FROM_EMAIL");

    const response = await fetch(PINGRAM_EMAIL_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        type: "transactional",
        to: request.to,
        subject: request.subject,
        html: toSimpleHtml(request.body),
        ...(fromAddress && { fromAddress }),
      }),
    });

    if (!response.ok) {
      const errorBody = (await response.json().catch(() => ({}))) as PingramErrorBody;
      const message = errorBody.error?.message ?? response.statusText;
      this.logger.error(`Pingram email send failed (${response.status}): ${message}`);
      throw new Error(`Pingram email send failed: ${message}`);
    }
  }
}

function toSimpleHtml(plainText: string): string {
  const escaped = plainText.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<p>${escaped}</p>`;
}
