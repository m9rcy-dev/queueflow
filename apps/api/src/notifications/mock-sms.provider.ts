import { Injectable, Logger } from "@nestjs/common";
import { SmsProvider, type SmsSendRequest } from "./sms-provider";

/** Mock provider — logs instead of sending real SMS. Keeps an in-memory `sent` log for test introspection, same pattern as MockEmailProvider. */
@Injectable()
export class MockSmsProvider extends SmsProvider {
  private readonly logger = new Logger(MockSmsProvider.name);
  readonly sent: SmsSendRequest[] = [];

  async send(request: SmsSendRequest): Promise<void> {
    this.sent.push(request);
    this.logger.log(`[mock SMS] To ${request.to}: ${request.body}`);
  }
}
