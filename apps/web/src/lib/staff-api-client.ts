import { StaffApiClient, type TokenStorage } from "@queueflow/api-client";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4001";

const REFRESH_TOKEN_KEY = "qf_staff_refresh_token";
const DEVICE_TRUST_TOKEN_KEY = "qf_staff_device_trust_token";

// localStorage throws in a private/blocked-storage browser — never let a
// storage failure take down the whole staff app, just fall back to "no
// stored session" (same reasoning as any other localStorage usage here).
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
    // Best-effort — a staff member just won't stay signed in across reloads.
  }
}

const tokenStorage: TokenStorage = {
  getRefreshToken: () => readLocalStorage(REFRESH_TOKEN_KEY),
  setRefreshToken: (token) => writeLocalStorage(REFRESH_TOKEN_KEY, token),
  getDeviceTrustToken: () => readLocalStorage(DEVICE_TRUST_TOKEN_KEY),
  setDeviceTrustToken: (token) => writeLocalStorage(DEVICE_TRUST_TOKEN_KEY, token),
};

export const staffApi = new StaffApiClient({ baseUrl: API_URL, tokenStorage });
