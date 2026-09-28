import { Injectable, Logger } from "@nestjs/common";
import { NotificationProvider, type NotificationSendRequest } from "./notification-provider";

/**
 * Mock provider for local development and Phase 7 (mirrors ConsoleMailService's
 * exact pattern) — logs instead of sending real SMS/email. Also keeps an
 * in-memory record of everything it's "sent" (`sent`), purely for test
 * introspection — a real provider (Phase 8) has no equivalent, since
 * nothing outside this class needs to know what a real send did.
 */
@Injectable()
export class MockNotificationProvider extends NotificationProvider {
  private readonly logger = new Logger(MockNotificationProvider.name);
  readonly sent: NotificationSendRequest[] = [];

  async send(request: NotificationSendRequest): Promise<void> {
    this.sent.push(request);
    this.logger.log(`[mock ${request.channel}] To ${request.recipient}: ${request.body}`);
  }
}
