"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { signInPath } from "../lib/use-customer-session";

/**
 * Phase 20: points customers to their own sign-in. Customer accounts belong
 * to one business and sign in on that business's page (/c/<code>); the staff
 * sign-in won't find them. If this browser has been to a business's sign-in
 * page before, link straight there.
 */
export function CustomerSignInHint({ tone = "muted" }: { tone?: "muted" | "card" }) {
  const [path, setPath] = useState<string | null>(null);
  useEffect(() => setPath(signInPath()), []);
  const known = path !== null && path !== "/";
  const text = known ? (
    <>
      Customer?{" "}
      <Link href={path} className="font-medium text-primary underline">
        Sign in to your customer account
      </Link>
      .
    </>
  ) : (
    <>Customer? Sign in from your business&apos;s QR poster, or the link in an email from them.</>
  );
  return tone === "card" ? (
    <p className="rounded-md border border-border bg-surface px-4 py-3 text-sm text-text-secondary">
      {text}
    </p>
  ) : (
    <p className="text-center text-sm text-text-secondary">{text}</p>
  );
}
