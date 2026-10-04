/**
 * Notification provider abstraction (ADR-008/plan §32) — Phase 1 only needs
 * the email channel for OTP codes and invites. Real provider (Pingram) is
 * Phase 8; this interface is what makes that swap a config change, not a
 * rewrite of anything that calls it.
 */
export abstract class MailService {
  abstract sendLoginCode(email: string, code: string): Promise<void>;
  /** Sent once, when the invite is created — points the invitee at the accept link. */
  abstract sendInviteLink(email: string, tenantName: string, inviteToken: string): Promise<void>;
  /** Sent when the invitee actually requests a code from the accept page. */
  abstract sendInviteCode(email: string, code: string, tenantName: string): Promise<void>;
  /** Phase 19 — a platform admin set up a business for this owner: where to sign in and finish setting up. */
  abstract sendOwnerWelcome(email: string, ownerName: string, tenantName: string): Promise<void>;
}
