import { CustomerApiClient, type CustomerTokenStorage } from "@queueflow/api-client";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4001";

const REFRESH_TOKEN_KEY = "qf_customer_refresh_token";

// Same reasoning as staff-api-client.ts: a private/blocked-storage browser
// must never take down the portal, just fall back to "no stored session".
function readLocalStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writeLocalStorage(key: string, value: string | null): void {
  try {
    if (value === null) {
      localStorage.removeItem(key);
    } else {
      localStorage.setItem(key, value);
    }
  } catch {
    // Best-effort — a customer just won't stay signed in across reloads.
  }
}

const tokenStorage: CustomerTokenStorage = {
  getRefreshToken: () => readLocalStorage(REFRESH_TOKEN_KEY),
  setRefreshToken: (token) => writeLocalStorage(REFRESH_TOKEN_KEY, token),
};

export const customerApi = new CustomerApiClient({ baseUrl: API_URL, tokenStorage });
