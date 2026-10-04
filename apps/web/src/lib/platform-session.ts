"use client";

import { useEffect, useState } from "react";
import { createPlatformApiClient } from "@queueflow/api-client";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4001";
const KEY = "queueflow.platformToken";

export const platformApi = createPlatformApiClient(API_URL);

/**
 * The platform admin's token (Phase 19, ADR-018) lives in sessionStorage:
 * it ends with the tab, and never touches the staff session's storage.
 */
export function savePlatformToken(token: string | null): void {
  try {
    if (token) sessionStorage.setItem(KEY, token);
    else sessionStorage.removeItem(KEY);
  } catch {
    // Storage blocked — the session simply won't survive a reload.
  }
}

/** undefined while reading storage; null when signed out. */
export function usePlatformToken(): [string | null | undefined, (token: string | null) => void] {
  const [token, setToken] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    try {
      setToken(sessionStorage.getItem(KEY));
    } catch {
      setToken(null);
    }
  }, []);
  return [
    token,
    (next) => {
      savePlatformToken(next);
      setToken(next);
    },
  ];
}
