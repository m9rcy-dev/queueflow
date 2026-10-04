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

/**
 * "Tue 10 Nov, 9:00 am" in the location's own timezone — never the
 * server's, and never UTC (an appointment time is meaningless to a
 * customer in anything but the business's local clock).
 */
export function formatAppointmentTime(startsAt: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-NZ", {
    timeZone: timezone,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(startsAt);
}

export function buildAppointmentBookedMessage(params: {
  businessName: string;
  serviceName: string;
  when: string;
  manageUrl: string;
}): string {
  return `${params.businessName}: your ${params.serviceName} appointment is booked for ${params.when}. View or cancel: ${params.manageUrl}`;
}

export function buildAppointmentCancelledMessage(params: {
  businessName: string;
  serviceName: string;
  when: string;
  cancelledByBusiness: boolean;
}): string {
  const who = params.cancelledByBusiness ? " by the business" : "";
  return `${params.businessName}: your ${params.serviceName} appointment for ${params.when} has been cancelled${who}.`;
}

export function buildAppointmentReminderMessage(params: {
  businessName: string;
  serviceName: string;
  when: string;
  manageUrl: string;
}): string {
  return `${params.businessName}: reminder of your ${params.serviceName} appointment, ${params.when}. When you arrive, check in here: ${params.manageUrl}`;
}

const EMAIL_SUBJECTS: Record<NotificationType, string> = {
  APPROACHING: "You're approaching in line",
  NEARLY_NEXT: "You're almost up!",
  CALLED: "It's your turn!",
  RECALLED: "Reminder: it's your turn",
  APPOINTMENT_BOOKED: "Your appointment is booked",
  APPOINTMENT_CANCELLED: "Your appointment has been cancelled",
  APPOINTMENT_REMINDER: "Reminder: your upcoming appointment",
};

/** Only meaningful for the EMAIL channel — SMS has no subject line. */
export function buildEmailSubject(type: NotificationType): string {
  return EMAIL_SUBJECTS[type];
}
