"use client";

import { useEffect, useState } from "react";

const API_PORT = 4001;
const FALLBACK = `http://localhost:${API_PORT}`;

/**
 * Where the API is. Deployed environments set NEXT_PUBLIC_API_URL. Without
 * it (local development), the API is on port 4001 of whatever host this page
 * was opened on — so a phone on the same Wi-Fi opening http://<mac-ip>:4000
 * talks to http://<mac-ip>:4001, not to its own "localhost" (Phase 19).
 */
export function apiBaseUrl(): string {
  if (process.env.NEXT_PUBLIC_API_URL) return process.env.NEXT_PUBLIC_API_URL;
  if (typeof window === "undefined") return FALLBACK;
  return `${window.location.protocol}//${window.location.hostname}:${API_PORT}`;
}

/**
 * The same, for markup that's also rendered on the server (images): starts
 * with the server's answer so hydration matches, then switches to the
 * browser's own host after mount.
 */
export function useApiBaseUrl(): string {
  const [base, setBase] = useState(process.env.NEXT_PUBLIC_API_URL ?? FALLBACK);
  useEffect(() => setBase(apiBaseUrl()), []);
  return base;
}
