export interface EmailSendRequest {
  to: string;
  subject: string;
  /** Plain text — each concrete provider decides how (or whether) to render this as HTML for its own API. */
  body: string;
}

/**
 * Email delivery abstraction (ADR-008) — independently swappable from
 * SmsProvider (a business might use Pingram for one channel and a
 * different vendor for the other) via its own config switch
 * (`EMAIL_PROVIDER`). `MockEmailProvider` is always available;
 * `PingramEmailProvider` is Phase 8's real implementation.
 */
export abstract class EmailProvider {
  abstract send(request: EmailSendRequest): Promise<void>;
}
