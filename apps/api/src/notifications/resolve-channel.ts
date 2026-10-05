import type { NotificationChannel } from "@prisma/client";

/**
 * Where a customer's notification goes (G-32/ADR-008): the email they gave
 * for this visit (Phase 19 — `contactEmail` on the ticket or booking), else
 * their account email (Phase 9), else SMS to their phone. Shared by queue
 * and appointment notifications.
 */
export function resolveChannel(
  customer: { phoneE164: string; email: string | null },
  contactEmail: string | null = null,
): {
  channel: NotificationChannel;
  recipient: string;
} {
  const email = contactEmail ?? customer.email;
  return email
    ? { channel: "EMAIL", recipient: email }
    : { channel: "SMS", recipient: customer.phoneE164 };
}
