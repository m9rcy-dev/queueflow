export interface SmsSendRequest {
  to: string;
  body: string;
}

/**
 * SMS delivery abstraction (ADR-008) — independently swappable from
 * EmailProvider via its own config switch (`SMS_PROVIDER`). Only
 * `MockSmsProvider` exists today: real SMS is a later adapter, gated on
 * real per-tenant cost caps existing first (G-29) — see
 * `notifications.module.ts` for how choosing anything else fails loudly
 * at startup rather than silently falling back.
 */
export abstract class SmsProvider {
  abstract send(request: SmsSendRequest): Promise<void>;
}
