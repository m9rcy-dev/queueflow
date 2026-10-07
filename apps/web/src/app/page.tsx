"use client";

import Link from "next/link";
import { QueueFlowLogo } from "../components/QueueFlowLogo";
import { CustomerSignInHint } from "../components/CustomerSignInHint";

/**
 * The bare address (Phase 20: no longer a dead end). Visitors normally
 * arrive through a business's QR code (/q, /c, /display) or staff sign-in;
 * anyone landing here gets a way on: customers back to their own business's
 * sign-in (remembered by this browser), staff to /admin/login.
 */
export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-6 p-8 text-center">
      <h1>
        <QueueFlowLogo size="lg" />
      </h1>
      <p className="text-text-secondary">
        Join queues and book appointments by scanning a business&apos;s QR code.
      </p>
      <CustomerSignInHint tone="card" />
      <Link
        href="/admin/login"
        className="inline-flex min-h-[44px] items-center rounded-md border border-border bg-surface px-5 text-sm font-medium text-text-primary hover:bg-bg"
      >
        Staff sign in
      </Link>
    </main>
  );
}
