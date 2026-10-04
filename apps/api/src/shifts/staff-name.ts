/** The name customers see for a staff member (Phase 18): their chosen public name or alias, else their display name. */
export function staffPublicName(member: {
  publicName: string | null;
  user: { displayName: string };
}): string {
  return member.publicName?.trim() || member.user.displayName;
}
