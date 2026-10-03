import { Injectable, Logger } from "@nestjs/common";
import { EmailProvider, type EmailSendRequest } from "./email-provider";

/**
 * Mock provider for local development and tests — logs instead of sending
 * real email. Backs both queue/customer notification email AND (since
 * Phase 12, via EmailProviderMailService) staff auth email, so this is the
 * one place either kind of OTP/code shows up during local dev. Also keeps
 * an in-memory record of everything it's "sent" (`sent`), purely for test
 * introspection — PingramEmailProvider has no equivalent, since nothing
 * outside this class needs to know what a real send did.
 */
@Injectable()
export class MockEmailProvider extends EmailProvider {
  private readonly logger = new Logger(MockEmailProvider.name);
  readonly sent: EmailSendRequest[] = [];

  async send(request: EmailSendRequest): Promise<void> {
    this.sent.push(request);
    this.logger.log(`[mock email] To ${request.to} (${request.subject}): ${request.body}`);
  }
}
