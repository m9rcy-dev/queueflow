import type { NotificationChannel } from "@prisma/client";

/** Email if the customer has one on file (account holders, Phase 9), SMS otherwise (G-32/ADR-008) — every anonymous walk-in or booker resolves to SMS by construction. Shared by queue and appointment notifications. */
export function resolveChannel(customer: { phoneE164: string; email: string | null }): {
  channel: NotificationChannel;
  recipient: string;
} {
  return customer.email
    ? { channel: "EMAIL", recipient: customer.email }
    : { channel: "SMS", recipient: customer.phoneE164 };
}
