"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { Card } from "@queueflow/ui";
import { ApiError } from "@queueflow/api-client";
import type { PlatformTenantDetail } from "@queueflow/types";
import { platformApi, usePlatformToken } from "../../../../lib/platform-session";
import { BusinessLogo } from "../../../../components/BusinessLogo";
import { CapabilityBadges, PlatformFrame } from "../../PlatformFrame";

const ROLE_LABELS: Record<string, string> = {
  TENANT_OWNER: "Owner",
  TENANT_ADMIN: "Admin",
  MANAGER: "Manager",
  STAFF: "Staff",
};

/** One business, read-only (Phase 19, ADR-018): capabilities, locations, services, team size. */
export default function PlatformTenantPage() {
  const { tenantId } = useParams<{ tenantId: string }>();
  const router = useRouter();
  const [token, setToken] = usePlatformToken();
  const [tenant, setTenant] = useState<PlatformTenantDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (token === undefined) return;
    if (!token) {
      router.replace("/platform");
      return;
    }
    platformApi
      .getTenant(token, tenantId)
      .then(setTenant)
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) {
          setToken(null);
          router.replace("/platform");
        } else {
          setError(err instanceof ApiError ? err.message : "Couldn't load this business.");
        }
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, tenantId]);

  const signOut = () => {
    setToken(null);
    router.replace("/platform");
  };

  return (
    <PlatformFrame onSignOut={signOut}>
      <Link href="/platform" className="text-sm text-text-secondary underline">
        ← All businesses
      </Link>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {!tenant && !error && <p className="text-text-secondary">Loading…</p>}
      {tenant && (
        <>
          <Card className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <BusinessLogo logoPath={tenant.logoPath} name={tenant.name} centered={false} />
              <div>
                <h1 className="text-xl font-semibold text-text-primary">{tenant.name}</h1>
                <p className="text-sm text-text-secondary">
                  {tenant.ownerName}
                  {tenant.ownerEmail ? ` · ${tenant.ownerEmail}` : ""} · joined{" "}
                  {new Date(tenant.createdAt).toLocaleDateString()}
                </p>
              </div>
            </div>
            <div className="flex flex-col items-end gap-1">
              <span className="text-xs font-medium uppercase tracking-wide text-text-secondary">
                Services subscribed
              </span>
              <CapabilityBadges capabilities={tenant.capabilities} />
            </div>
          </Card>

          <div className="grid gap-3 sm:grid-cols-4">
            <Stat label="Locations" value={tenant.locationCount} />
            <Stat label="Staff" value={tenant.memberCount} />
            <Stat label="Tickets, 30 days" value={tenant.ticketsLast30Days} />
            <Stat label="Bookings, 30 days" value={tenant.appointmentsLast30Days} />
          </div>

          <Card className="flex flex-col gap-2">
            <h2 className="text-lg font-semibold text-text-primary">Locations</h2>
            {tenant.locations.length === 0 && (
              <p className="text-sm text-text-secondary">None yet.</p>
            )}
            {tenant.locations.map((location) => (
              <div
                key={location.id}
                className="flex justify-between border-t border-border py-2 text-sm"
              >
                <span className="text-text-primary">{location.name}</span>
                <span className="text-text-secondary">
                  {location.timezone} · {location.queueCount} queue
                  {location.queueCount === 1 ? "" : "s"}
                </span>
              </div>
            ))}
          </Card>

          <Card className="flex flex-col gap-2">
            <h2 className="text-lg font-semibold text-text-primary">Their services</h2>
            {tenant.services.length === 0 && (
              <p className="text-sm text-text-secondary">None yet.</p>
            )}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <tbody>
                  {tenant.services.map((service) => (
                    <tr key={service.id} className="border-t border-border">
                      <td className="py-2 text-text-primary">
                        {service.name}
                        {!service.active && (
                          <span className="ml-2 text-xs text-text-secondary">(inactive)</span>
                        )}
                      </td>
                      <td className="py-2 text-text-secondary">{service.locationName}</td>
                      <td className="py-2 text-text-secondary">{service.durationMinutes} min</td>
                      <td className="py-2 text-right text-text-secondary">
                        {service.appointmentEnabled ? "Bookable" : "Walk-in"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card className="flex flex-col gap-2">
            <h2 className="text-lg font-semibold text-text-primary">Team</h2>
            <p className="text-sm text-text-secondary">
              {Object.entries(tenant.membersByRole)
                .map(([role, count]) => `${count} ${ROLE_LABELS[role] ?? role}`)
                .join(" · ") || "No one yet."}
            </p>
          </Card>
        </>
      )}
    </PlatformFrame>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <Card className="flex flex-col gap-1 p-4">
      <span className="text-2xl font-semibold tabular-nums text-text-primary">{value}</span>
      <span className="text-xs text-text-secondary">{label}</span>
    </Card>
  );
}
