"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import type { DisplaySnapshot } from "@queueflow/types";
import { publicApi } from "../../../lib/api-client";
import { BusinessLogo } from "../../../components/BusinessLogo";

const WATCHDOG_INTERVAL_MS = 15_000;
// Comfortably more than the server's 25s heartbeat (queue-events'
// SSE_HEARTBEAT_MS) — anything past this with zero messages, not even a
// heartbeat, means the connection is silently dead, not just quiet.
const STALE_AFTER_MS = 70_000;

/**
 * The public TV board (Phase 6, C-01/G-07) — no auth, identified purely by
 * the DISPLAY-context code in the URL. Fullscreen, dark, and built to run
 * unattended for hours: the browser's own EventSource reconnect handles a
 * clean drop (onerror fires), and a watchdog timer catches the rarer case
 * of a connection gone silently stale (some proxies leave one open without
 * ever signaling an error) by forcing a fresh connection. Never renders
 * anything but ticket numbers and service names — no customer or staff
 * identity ever reaches this page (see DisplaySnapshot's own contract).
 */
export default function DisplayPage() {
  const params = useParams<{ code: string }>();
  const code = params.code;

  const [snapshot, setSnapshot] = useState<DisplaySnapshot | null>(null);
  const [reconnecting, setReconnecting] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const lastMessageAtRef = useRef(Date.now());
  const sourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    let cancelled = false;

    function connect(): void {
      sourceRef.current?.close();
      const source = new EventSource(publicApi.displayEventsUrl(code));
      sourceRef.current = source;

      source.onmessage = (event) => {
        if (cancelled) return;
        lastMessageAtRef.current = Date.now();
        setReconnecting(false);
        try {
          const data: unknown = JSON.parse(event.data);
          if (data && typeof data === "object" && "queue" in data) {
            setSnapshot(data as DisplaySnapshot);
            setNotFound(false);
          }
          // Anything else (the heartbeat ping) is deliberately ignored.
        } catch {
          // Not JSON — a heartbeat, or a transient bad frame. Ignore either way.
        }
      };
      source.onerror = () => {
        if (cancelled) return;
        setReconnecting(true);
      };
    }

    connect();

    const watchdog = setInterval(() => {
      if (Date.now() - lastMessageAtRef.current > STALE_AFTER_MS) {
        connect();
      }
    }, WATCHDOG_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(watchdog);
      sourceRef.current?.close();
    };
  }, [code]);

  useEffect(() => {
    if (!snapshot) {
      const timeout = setTimeout(() => setNotFound(true), 8000);
      return () => clearTimeout(timeout);
    }
  }, [snapshot]);

  if (!snapshot) {
    return (
      <FullScreen>
        <p className="text-white/70">Loading…</p>
        {notFound && (
          <p className="text-sm text-white/50">
            This screen isn&apos;t linked to a queue, or the code has been deactivated. Ask a
            business owner to check the display code.
          </p>
        )}
      </FullScreen>
    );
  }

  const statusMessage =
    snapshot.queue.status === "PAUSED"
      ? "Queue temporarily paused"
      : snapshot.queue.status === "CLOSED"
        ? "Queue closed"
        : null;

  return (
    <FullScreen>
      {reconnecting && (
        <div className="absolute right-6 top-6 rounded-md bg-amber-500/20 px-3 py-1 text-sm text-amber-200">
          Reconnecting…
        </div>
      )}

      <header className="text-center">
        <BusinessLogo logoPath={snapshot.tenant.logoPath} name={snapshot.tenant.name} size="lg" />
        <h1 className="text-3xl font-semibold">{snapshot.tenant.name}</h1>
        <p className="text-white/60">{snapshot.location.name}</p>
      </header>

      {statusMessage ? (
        <p className="mt-16 text-4xl text-white/70">{statusMessage}</p>
      ) : (
        <>
          <section className="mt-12 w-full max-w-4xl">
            <h2 className="mb-4 text-center text-xl uppercase tracking-widest text-white/50">
              Now Serving
            </h2>
            {snapshot.nowServing.length === 0 ? (
              <p className="text-center text-2xl text-white/40">—</p>
            ) : (
              <div className="flex flex-wrap justify-center gap-8">
                {snapshot.nowServing.map((entry) => (
                  <div key={entry.ticketNumber} className="flex flex-col items-center">
                    <span className="text-8xl font-bold tabular-nums">#{entry.ticketNumber}</span>
                    <span className="mt-2 text-lg text-white/60">{entry.serviceName}</span>
                  </div>
                ))}
              </div>
            )}
          </section>

          {snapshot.next.length > 0 && (
            <section className="mt-16">
              <h2 className="mb-3 text-center text-sm uppercase tracking-widest text-white/40">
                Next Up
              </h2>
              <div className="flex justify-center gap-4 text-3xl tabular-nums text-white/60">
                {snapshot.next.map((ticketNumber) => (
                  <span key={ticketNumber}>#{ticketNumber}</span>
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </FullScreen>
  );
}

function FullScreen({ children }: { children: React.ReactNode }) {
  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center gap-4 bg-[#172033] p-8 text-center text-white">
      {children}
    </main>
  );
}
