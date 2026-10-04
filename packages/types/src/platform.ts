/**
 * The platform (root) admin view (Phase 19, ADR-018) — QueueFlow's own
 * operators, not a business. Read-only: which businesses exist and which
 * services (capabilities) each has switched on. No customer data.
 */

export interface PlatformLoginResponse {
  accessToken: string;
  admin: { email: string; displayName: string };
}

/** The optional capabilities a business has switched on — what they "subscribe" to. */
export interface PlatformCapabilities {
  queue: boolean;
  appointments: boolean;
}

export interface PlatformTenantSummary {
  id: string;
  name: string;
  ownerName: string;
  ownerEmail: string | null;
  logoPath: string | null;
  createdAt: string;
  capabilities: PlatformCapabilities;
  locationCount: number;
  serviceCount: number;
  memberCount: number;
  /** Queue tickets in the last 30 days — a rough "is anyone using it" signal. */
  ticketsLast30Days: number;
  appointmentsLast30Days: number;
}

export interface PlatformTenantDetail extends PlatformTenantSummary {
  locations: Array<{ id: string; name: string; timezone: string; queueCount: number }>;
  services: Array<{
    id: string;
    name: string;
    locationName: string;
    durationMinutes: number;
    active: boolean;
    appointmentEnabled: boolean;
  }>;
  membersByRole: Record<string, number>;
}
