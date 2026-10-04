"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { QueueFlowLogo } from "../../components/QueueFlowLogo";

/** The platform admin's page frame (Phase 19) — QueueFlow's own console, so QueueFlow's brand only. */
export function PlatformFrame({
  onSignOut,
  children,
}: {
  onSignOut?: () => void;
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-bg">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <Link href="/platform" className="flex items-center gap-3">
            <QueueFlowLogo />
            <span className="rounded-full bg-text-primary px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-white">
              Platform
            </span>
          </Link>
          {onSignOut && (
            <button
              type="button"
              onClick={onSignOut}
              className="text-sm text-text-secondary underline"
            >
              Sign out
            </button>
          )}
        </div>
      </header>
      <main className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-6 sm:px-6 sm:py-8">
        {children}
      </main>
    </div>
  );
}

export function CapabilityBadges({
  capabilities,
}: {
  capabilities: { queue: boolean; appointments: boolean };
}) {
  const items = [
    { label: "Queue", on: capabilities.queue },
    { label: "Appointments", on: capabilities.appointments },
  ];
  return (
    <span className="flex flex-wrap gap-1.5">
      {items.map((item) => (
        <span
          key={item.label}
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
            item.on
              ? "bg-emerald-100 text-emerald-800"
              : "bg-bg text-text-secondary line-through decoration-text-secondary/50"
          }`}
        >
          {item.label}
        </span>
      ))}
    </span>
  );
}
