"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Badge, Button, Card } from "@queueflow/ui";
import { ApiError } from "@queueflow/api-client";
import type {
  CodeSummary,
  GuestCardSummary,
  LocationSummary,
  QueueSummary,
} from "@queueflow/types";
import { staffApi } from "../../../lib/staff-api-client";
import { useStaffSession } from "../../../lib/use-staff-session";
import { isBusinessAdmin } from "../../../lib/roles";
import { AppShell } from "../../../components/AppShell";
import { TicketQrCode } from "../../../components/TicketQrCode";

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback;
}

/** A print view for one code (new tab), so posters come out as a clean page. */
function printHref(url: string, title: string, subtitle: string, caption: string): string {
  const params = new URLSearchParams({ url, title, subtitle, caption });
  return `/admin/codes/print?${params.toString()}`;
}

interface LocationGroup {
  location: LocationSummary;
  queues: Array<{ queue: QueueSummary; codes: CodeSummary[] }>;
  guestCards: GuestCardSummary[];
}

/**
 * Every QR code in one place (Phase 17): per location, each queue's
 * customer poster and TV-board link, and the guest-card pool; for
 * owner/admins, the business sign-up poster too. Managers manage their
 * own location's codes (the API scopes them, ADR-016); anyone else gets a
 * read-only view.
 */
export default function QrCodesPage() {
  const session = useStaffSession();
  const [groups, setGroups] = useState<LocationGroup[] | null>(null);
  const [generalCodes, setGeneralCodes] = useState<CodeSummary[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const origin = typeof window !== "undefined" ? window.location.origin : "";

  const canManage = session ? isBusinessAdmin(session.role) || session.role === "MANAGER" : false;
  const isAdmin = session ? isBusinessAdmin(session.role) : false;

  const load = useCallback(async () => {
    if (!session) return;
    const [locations, queues] = await Promise.all([
      staffApi.listLocations(),
      staffApi.listQueues(),
    ]);
    const built = await Promise.all(
      locations.map(async (location) => {
        const locationQueues = queues.filter((q) => q.locationId === location.id);
        const [withCodes, guestCards] = await Promise.all([
          Promise.all(
            locationQueues.map(async (queue) => ({
              queue,
              codes: await staffApi.listCodes(queue.id),
            })),
          ),
          staffApi.listGuestCards(location.id).catch(() => []),
        ]);
        return { location, queues: withCodes, guestCards };
      }),
    );
    setGroups(built);
    if (isBusinessAdmin(session.role)) {
      setGeneralCodes(await staffApi.listGeneralCodes());
    }
  }, [session]);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(key: string, action: () => Promise<unknown>): Promise<void> {
    setBusy(key);
    setError(null);
    try {
      await action();
      await load();
    } catch (err) {
      setError(errorMessage(err, "Something went wrong."));
    } finally {
      setBusy(null);
    }
  }

  if (!session || !groups) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-bg text-text-secondary">
        Loading…
      </main>
    );
  }

  const activeGeneral = generalCodes.find((c) => c.active) ?? null;

  return (
    <AppShell session={session} title="QR Codes">
      <p className="text-sm text-text-secondary">
        Print a poster for each queue (customers scan it to join or book), open the TV link on the
        screen at each location, and print guest cards for walk-ins without a phone.
      </p>
      {error && <p className="text-sm text-red-600">{error}</p>}

      {isAdmin && (
        <Card className="flex flex-col gap-4">
          <SectionHeading title="Customer sign-up poster" detail="Whole business" />
          {activeGeneral ? (
            <CodeTile
              label="Scan to create an account"
              url={`${origin}/c/${activeGeneral.publicCode}`}
              printUrl={printHref(
                `${origin}/c/${activeGeneral.publicCode}`,
                session.tenantName,
                "Create an account",
                "Scan with your phone camera",
              )}
              actions={
                <Button
                  variant="secondary"
                  disabled={busy === "general"}
                  onClick={() => run("general", () => staffApi.regenerateGeneralCode())}
                >
                  New code
                </Button>
              }
            />
          ) : (
            <Button
              className="self-start"
              disabled={busy === "general"}
              onClick={() => run("general", () => staffApi.createGeneralCode())}
            >
              Create sign-up poster
            </Button>
          )}
        </Card>
      )}

      {groups.length === 0 && (
        <Card>
          <p className="text-text-secondary">No locations yet.</p>
        </Card>
      )}

      {groups.map(({ location, queues, guestCards }) => (
        <Card key={location.id} className="flex flex-col gap-5">
          <SectionHeading title={location.name} detail="Location" />

          {queues.length === 0 && (
            <p className="text-sm text-text-secondary">No queues at this location yet.</p>
          )}

          {queues.map(({ queue, codes }) => {
            const poster = codes.find((c) => c.contextType === "QUEUE" && c.active) ?? null;
            const display = codes.find((c) => c.contextType === "DISPLAY" && c.active) ?? null;
            return (
              <div key={queue.id} className="flex flex-col gap-3 border-t border-border pt-4">
                <div className="flex items-center gap-2">
                  <h3 className="font-medium text-text-primary">{queue.name}</h3>
                  <Badge tone={queue.status === "ACTIVE" ? "success" : "neutral"}>
                    {queue.status}
                  </Badge>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  {poster ? (
                    <CodeTile
                      label="Customer poster: join or book"
                      url={`${origin}/q/${poster.publicCode}`}
                      printUrl={printHref(
                        `${origin}/q/${poster.publicCode}`,
                        session.tenantName,
                        `${location.name}: ${queue.name}`,
                        "Scan to join the queue",
                      )}
                      actions={
                        canManage && (
                          <Button
                            variant="destructive"
                            disabled={busy === poster.id}
                            onClick={() =>
                              run(poster.id, () => staffApi.deactivateCode(queue.id, poster.id))
                            }
                          >
                            Deactivate
                          </Button>
                        )
                      }
                    />
                  ) : (
                    <EmptyTile
                      label="No customer poster"
                      action={
                        canManage && (
                          <Button
                            disabled={busy === `${queue.id}-q`}
                            onClick={() =>
                              run(`${queue.id}-q`, () => staffApi.createCode(queue.id, "QUEUE"))
                            }
                          >
                            Create poster
                          </Button>
                        )
                      }
                    />
                  )}
                  {display ? (
                    <CodeTile
                      label="TV board: open this link on the screen"
                      url={`${origin}/display/${display.publicCode}`}
                      showQr={false}
                      actions={
                        canManage && (
                          <Button
                            variant="destructive"
                            disabled={busy === display.id}
                            onClick={() =>
                              run(display.id, () => staffApi.deactivateCode(queue.id, display.id))
                            }
                          >
                            Deactivate
                          </Button>
                        )
                      }
                    />
                  ) : (
                    <EmptyTile
                      label="No TV board link"
                      action={
                        canManage && (
                          <Button
                            variant="secondary"
                            disabled={busy === `${queue.id}-d`}
                            onClick={() =>
                              run(`${queue.id}-d`, () => staffApi.createCode(queue.id, "DISPLAY"))
                            }
                          >
                            Create TV link
                          </Button>
                        )
                      }
                    />
                  )}
                </div>
              </div>
            );
          })}

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
            <div>
              <h3 className="font-medium text-text-primary">Guest cards</h3>
              <p className="text-sm text-text-secondary">
                {guestCards.length === 0
                  ? "None yet. Set the pool size on the location's page."
                  : `${guestCards.length} cards, ${guestCards.filter((c) => c.inUse).length} in use right now`}
              </p>
            </div>
            {guestCards.length > 0 && (
              <Link
                href={`/admin/codes/guest-cards/${location.id}`}
                target="_blank"
                className="text-sm text-primary underline"
              >
                Print card sheet
              </Link>
            )}
          </div>
        </Card>
      ))}
    </AppShell>
  );
}

function SectionHeading({ title, detail }: { title: string; detail: string }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-text-secondary">{detail}</p>
      <h2 className="text-lg font-semibold text-text-primary">{title}</h2>
    </div>
  );
}

function CodeTile({
  label,
  url,
  printUrl,
  showQr = true,
  actions,
}: {
  label: string;
  url: string;
  printUrl?: string;
  showQr?: boolean;
  actions?: React.ReactNode;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-col gap-3 rounded-md border border-border p-4">
      <p className="text-sm font-medium text-text-primary">{label}</p>
      {showQr && (
        <div className="self-center">
          <TicketQrCode url={url} size={140} alt={label} />
        </div>
      )}
      <p className="break-all font-mono text-xs text-text-secondary">{url}</p>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          className="min-h-[40px] px-4 py-2 text-sm"
          onClick={async () => {
            await navigator.clipboard?.writeText(url).catch(() => undefined);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? "Copied" : "Copy link"}
        </Button>
        {printUrl && (
          <Link
            href={printUrl}
            target="_blank"
            className="inline-flex min-h-[40px] items-center rounded-md border border-border bg-surface px-4 text-sm font-medium text-text-primary hover:bg-bg"
          >
            Print
          </Link>
        )}
        {actions}
      </div>
    </div>
  );
}

function EmptyTile({ label, action }: { label: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-3 rounded-md border border-dashed border-border p-4">
      <p className="text-sm text-text-secondary">{label}</p>
      {action}
    </div>
  );
}
