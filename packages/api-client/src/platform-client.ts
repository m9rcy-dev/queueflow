import type {
  PlatformLoginResponse,
  PlatformTenantDetail,
  PlatformTenantSummary,
} from "@queueflow/types";
import { ApiError } from "./errors";

/**
 * The platform (root) admin client (Phase 19, ADR-018). Deliberately its
 * own small client: a platform session is a separate kind of token (its
 * own signing key, 4 hours, no refresh), so it never mixes with a staff
 * session in the same browser. On expiry the caller just signs in again.
 */
export interface PlatformApiClient {
  requestCode(email: string): Promise<void>;
  verify(email: string, code: string): Promise<PlatformLoginResponse>;
  listTenants(token: string): Promise<PlatformTenantSummary[]>;
  getTenant(token: string, tenantId: string): Promise<PlatformTenantDetail>;
}

export function createPlatformApiClient(baseUrl: string): PlatformApiClient {
  async function request<T>(path: string, init: RequestInit & { token?: string } = {}): Promise<T> {
    const { token, ...rest } = init;
    const res = await fetch(`${baseUrl}${path}`, {
      ...rest,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new ApiError(
        res.status,
        typeof body.code === "string" ? body.code : "UNKNOWN_ERROR",
        typeof body.message === "string" ? body.message : "Something went wrong. Please try again.",
      );
    }
    if (res.status === 204) return undefined as T;
    return res.json() as Promise<T>;
  }

  return {
    requestCode: async (email) => {
      await request("/platform/login/request", { method: "POST", body: JSON.stringify({ email }) });
    },
    verify: (email, code) =>
      request("/platform/login/verify", { method: "POST", body: JSON.stringify({ email, code }) }),
    listTenants: (token) => request("/platform/tenants", { token }),
    getTenant: (token, tenantId) =>
      request(`/platform/tenants/${encodeURIComponent(tenantId)}`, { token }),
  };
}
