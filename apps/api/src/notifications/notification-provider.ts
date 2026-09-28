import type { NotificationChannel } from "@prisma/client";

export interface NotificationSendRequest {
  channel: NotificationChannel;
  recipient: string;
  body: string;
}

/**
 * Notification provider abstraction (ADR-008/G-31) — the same
 * one-interface-behind-a-swap pattern as MailService (apps/api/src/mail),
 * but for queue-event notifications (approaching/nearly-next/called/
 * recalled) rather than auth OTP/invites — a deliberately separate concern
 * with its own channel shape (SMS-first, since anonymous walk-ins only
 * ever have a phone). MockNotificationProvider is Phase 7's only
 * implementation; a real Pingram-backed one is Phase 8's job, behind this
 * same interface.
 */
export abstract class NotificationProvider {
  abstract send(request: NotificationSendRequest): Promise<void>;
}
