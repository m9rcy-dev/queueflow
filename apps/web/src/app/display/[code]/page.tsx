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
    <FullScreen centered={false}>
      {reconnecting && (
        <div className="absolute right-6 top-6 rounded-md bg-amber-500/20 px-3 py-1 text-sm text-amber-200">
          Reconnecting…
        </div>
      )}

      <header className="flex w-full items-center gap-[1.5vw] border-b border-white/10 pb-[1.5vh]">
        <BusinessLogo
          logoPath={snapshot.tenant.logoPath}
          name={snapshot.tenant.name}
          centered={false}
        />
        <div className="text-left">
          <h1 className="text-[clamp(1.25rem,2.2vw,2.5rem)] font-semibold leading-tight">
            {snapshot.tenant.name}
          </h1>
          <p className="text-[clamp(0.9rem,1.3vw,1.5rem)] text-white/60">
            {snapshot.location.name}
          </p>
        </div>
      </header>

      {statusMessage ? (
        <p className="m-auto text-[clamp(2rem,4vw,4rem)] text-white/70">{statusMessage}</p>
      ) : (
        <div className="grid w-full flex-1 gap-[2vw] pt-[2vh] lg:grid-cols-[2fr_3fr]">
          <NowServing entries={snapshot.nowServing} />
          <Waiting next={snapshot.next} waitingCount={snapshot.waitingCount} />
        </div>
      )}
    </FullScreen>
  );
}

/** Who's being served right now — for the customer just called, so big, but they only need it once. */
function NowServing({ entries }: { entries: DisplaySnapshot["nowServing"] }) {
  return (
    <section className="flex flex-col rounded-2xl bg-white/5 p-[2vw]">
      <h2 className="text-[clamp(1rem,1.6vw,2rem)] font-semibold uppercase tracking-widest text-emerald-300">
        Now serving
      </h2>
      {entries.length === 0 ? (
        <p className="m-auto text-[clamp(2rem,4vw,5rem)] text-white/30">—</p>
      ) : (
        <div className="flex flex-1 flex-col justify-center gap-[2vh]">
          {entries.map((entry) => (
            <div key={entry.ticketNumber} className="text-center">
              <span className="block text-[clamp(4rem,9vw,12rem)] font-bold leading-none tabular-nums">
                #{entry.ticketNumber}
              </span>
              <span className="text-[clamp(1rem,1.6vw,2rem)] text-white/60">
                {entry.serviceName}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function ordinal(n: number): string {
  const suffix =
    n % 100 >= 11 && n % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" }[n % 10] ?? "th");
  return `${n}${suffix}`;
}

/**
 * The line, in call order (Phase 17). People waiting watch this to find
 * themselves — especially anyone without notifications — so every ticket
 * is large, labelled with its place, and the very next one stands out.
 */
function Waiting({ next, waitingCount }: { next: number[]; waitingCount: number }) {
  const [first, ...rest] = next;
  const notShown = waitingCount - next.length;
  return (
    <section className="flex flex-col rounded-2xl bg-white/5 p-[2vw]">
      <div className="flex items-baseline justify-between">
        <h2 className="text-[clamp(1rem,1.6vw,2rem)] font-semibold uppercase tracking-widest text-sky-300">
          Waiting
        </h2>
        <span className="text-[clamp(0.9rem,1.4vw,1.75rem)] text-white/60">
          {waitingCount} {waitingCount === 1 ? "person" : "people"} waiting
        </span>
      </div>

      {first === undefined ? (
        <p className="m-auto text-[clamp(1.5rem,2.5vw,3rem)] text-white/40">No one waiting</p>
      ) : (
        <div className="mt-[2vh] flex flex-1 flex-col gap-[1.5vh]">
          <div className="flex items-center justify-between rounded-xl bg-sky-400/20 px-[2vw] py-[1.5vh] ring-2 ring-sky-300/60">
            <span className="text-[clamp(1.25rem,2.2vw,2.75rem)] font-semibold uppercase text-sky-200">
              Next
            </span>
            <span className="text-[clamp(3rem,7vw,9rem)] font-bold leading-none tabular-nums">
              #{first}
            </span>
          </div>
          {rest.length > 0 && (
            <ol className="grid grid-cols-2 gap-[1.2vh] sm:grid-cols-3 xl:grid-cols-4">
              {rest.map((ticketNumber, index) => (
                <li
                  key={ticketNumber}
                  className="flex flex-col items-start rounded-xl bg-white/10 px-[1.2vw] py-[0.8vh]"
                >
                  <span className="text-[clamp(0.8rem,1.1vw,1.4rem)] leading-tight text-white/50">
                    {ordinal(index + 2)}
                  </span>
                  <span className="self-center text-[clamp(2rem,4vw,5.5rem)] font-bold leading-tight tabular-nums">
                    #{ticketNumber}
                  </span>
                </li>
              ))}
            </ol>
          )}
          {notShown > 0 && (
            <p className="text-center text-[clamp(0.9rem,1.4vw,1.75rem)] text-white/50">
              …and {notShown} more
            </p>
          )}
        </div>
      )}
    </section>
  );
}

/** Centered for the loading/error states; the live board lays itself out top-to-bottom. */
function FullScreen({
  children,
  centered = true,
}: {
  children: React.ReactNode;
  centered?: boolean;
}) {
  return (
    <main
      className={`relative flex min-h-screen flex-col items-center gap-4 bg-[#172033] p-[2vw] text-center text-white ${
        centered ? "justify-center" : ""
      }`}
    >
      {children}
    </main>
  );
}
