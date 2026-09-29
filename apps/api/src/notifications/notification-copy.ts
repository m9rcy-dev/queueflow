import type { NotificationType } from "@prisma/client";

/**
 * Pure message-body builders (plan §30/§31) — finalized once at enqueue
 * time and stored on the outbox row itself (NotificationOutbox.body), not
 * recomputed at send time. Kept deliberately plain-text; each EmailProvider
 * implementation decides how (or whether) to render this as HTML — SMS
 * (the only channel every current customer actually resolves to) has no
 * such wrapping to do.
 */

export function buildApproachingMessage(params: {
  businessName: string;
  queueName: string;
  peopleAhead: number;
}): string {
  return `${params.businessName}: you're #${params.peopleAhead + 1} for ${params.queueName} — about ${params.peopleAhead} people ahead of you.`;
}

export function buildNearlyNextMessage(params: {
  businessName: string;
  queueName: string;
  peopleAhead: number;
}): string {
  return `${params.businessName}: you're almost up for ${params.queueName} — only ${params.peopleAhead} ahead of you. Please head over now if you're not already there.`;
}

export function buildCalledMessage(params: { businessName: string; ticketNumber: number }): string {
  return `${params.businessName}: it's your turn! Ticket #${params.ticketNumber} — please proceed to the counter now.`;
}

export function buildRecalledMessage(params: {
  businessName: string;
  ticketNumber: number;
}): string {
  return `${params.businessName}: reminder — ticket #${params.ticketNumber} is still being called. Please proceed to the counter now.`;
}

const EMAIL_SUBJECTS: Record<NotificationType, string> = {
  APPROACHING: "You're approaching in line",
  NEARLY_NEXT: "You're almost up!",
  CALLED: "It's your turn!",
  RECALLED: "Reminder: it's your turn",
};

/** Only meaningful for the EMAIL channel — SMS has no subject line. */
export function buildEmailSubject(type: NotificationType): string {
  return EMAIL_SUBJECTS[type];
}
