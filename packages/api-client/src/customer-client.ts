import type {
  AuthenticatorSetup,
  AuthenticatorStatus,
  CustomerActiveEntry,
  CustomerAuthResponse,
  CustomerPortalSummary,
  CustomerUpcomingAppointment,
} from "@queueflow/types";
import type { CustomerSignupInput } from "@queueflow/validation";
import { ApiError } from "./errors";

/** The customer's own refresh-token slot — deliberately separate from StaffApiClient's TokenStorage (no device-trust concept for customers, and the two must never share a key). */
export interface CustomerTokenStorage {
  getRefreshToken(): Promise<string | null> | string | null;
  setRefreshToken(token: string | null): Promise<void> | void;
}

export interface CustomerApiClientConfig {
  baseUrl: string;
  fetchImpl?: typeof fetch;
  tokenStorage?: CustomerTokenStorage;
}

interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
}

/**
 * The customer portal client (Phase 9, D-09) — same Bearer-token +
 * refresh-and-retry-once shape as StaffApiClient, against the entirely
 * separate `/public/customers/*` (auth) and `/customers/me/*` (portal)
 * routes and their own customer-jwt credential. Never shares a token with
 * StaffApiClient — a customer and a staff session can coexist in the same
 * browser (e.g. a shop owner checking their own loyalty status).
 */
export class CustomerApiClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly tokenStorage?: CustomerTokenStorage;
  private accessToken: string | null = null;

  constructor(config: CustomerApiClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, "");
    this.fetchImpl = config.fetchImpl ?? fetch.bind(globalThis);
    this.tokenStorage = config.tokenStorage;
  }

  setAccessToken(token: string | null): void {
    this.accessToken = token;
  }

  /** Self-service signup via a GENERAL code's landing page (D-10) — no session yet; the customer verifies their email next. */
  async signUp(input: CustomerSignupInput): Promise<{ message: string }> {
    return this.request("/public/customers/signup", { method: "POST", body: input });
  }

  /** `forceEmail` = "Email me a code instead" (Phase 15). */
  async requestLoginCode(tenantId: string, email: string, forceEmail = false): Promise<void> {
    await this.request("/public/customers/login/request", {
      method: "POST",
      body: forceEmail ? { tenantId, email, forceEmail } : { tenantId, email },
    });
  }

  async verifyLoginCode(
    tenantId: string,
    email: string,
    code: string,
  ): Promise<CustomerAuthResponse> {
    const response = await this.request<CustomerAuthResponse>("/public/customers/login/verify", {
      method: "POST",
      body: { tenantId, email, code },
    });
    this.accessToken = response.accessToken;
    await this.tokenStorage?.setRefreshToken(response.refreshToken);
    return response;
  }

  async logout(): Promise<void> {
    const refreshToken = await this.tokenStorage?.getRefreshToken();
    this.accessToken = null;
    await this.tokenStorage?.setRefreshToken(null);
    if (refreshToken) {
      await this.request("/public/customers/logout", {
        method: "POST",
        body: { refreshToken },
      }).catch(() => undefined);
    }
  }

  /** Call once on app/page load: exchanges a surviving refresh token for a fresh access token + the portal summary, or returns null. */
  async restoreSession(): Promise<CustomerPortalSummary | null> {
    const refreshed = await this.refreshAccessToken();
    if (!refreshed) return null;
    return this.getMe();
  }

  getMe(): Promise<CustomerPortalSummary> {
    return this.request("/customers/me");
  }

  getIdentityCode(): Promise<{ publicCode: string }> {
    return this.request("/customers/me/identity-code");
  }

  regenerateIdentityCode(): Promise<{ publicCode: string }> {
    return this.request("/customers/me/identity-code/regenerate", { method: "POST" });
  }

  getActiveEntry(): Promise<CustomerActiveEntry | null> {
    return this.request("/customers/me/active-entry");
  }

  getUpcomingAppointments(): Promise<CustomerUpcomingAppointment[]> {
    return this.request("/customers/me/appointments");
  }

  // --- Authenticator app login (Phase 15) ---

  getAuthenticatorStatus(): Promise<AuthenticatorStatus> {
    return this.request("/customers/me/authenticator");
  }

  beginAuthenticatorSetup(): Promise<AuthenticatorSetup> {
    return this.request("/customers/me/authenticator/setup", { method: "POST" });
  }

  confirmAuthenticator(code: string): Promise<AuthenticatorStatus> {
    return this.request("/customers/me/authenticator/confirm", { method: "POST", body: { code } });
  }

  disableAuthenticator(): Promise<AuthenticatorStatus> {
    return this.request("/customers/me/authenticator", { method: "DELETE" });
  }

  private async request<T>(
    path: string,
    options: RequestOptions = {},
    isRetry = false,
  ): Promise<T> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.accessToken) {
      headers["Authorization"] = `Bearer ${this.accessToken}`;
    }

    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method: options.method ?? "GET",
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });

    // Same silent refresh-and-retry-once as StaffApiClient — never on the
    // public auth endpoints themselves (an expired/missing token there
    // just means "not logged in", not "session expired mid-use").
    if (response.status === 401 && !isRetry && !path.startsWith("/public/customers/")) {
      const refreshed = await this.refreshAccessToken();
      if (refreshed) {
        return this.request<T>(path, options, true);
      }
    }

    if (!response.ok) {
      const errorBody = (await response.json().catch(() => ({}))) as {
        code?: string;
        message?: string;
      };
      throw new ApiError(
        response.status,
        errorBody.code ?? "UNKNOWN_ERROR",
        errorBody.message ?? response.statusText,
      );
    }
    if (response.status === 204) {
      return undefined as T;
    }
    // GET /customers/me/active-entry returns a 200 with an empty body when
    // there's nothing active (NestJS's standard handling of a `null`
    // return value) — response.json() would throw on that, so parse text
    // first and treat "nothing there" as null rather than an error.
    const text = await response.text();
    return (text ? JSON.parse(text) : null) as T;
  }

  private async refreshAccessToken(): Promise<boolean> {
    if (!this.tokenStorage) return false;
    const refreshToken = await this.tokenStorage.getRefreshToken();
    if (!refreshToken) return false;
    try {
      const response = await this.fetchImpl(`${this.baseUrl}/public/customers/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken }),
      });
      if (!response.ok) {
        await this.tokenStorage.setRefreshToken(null);
        return false;
      }
      const data = (await response.json()) as { accessToken: string; refreshToken: string };
      this.accessToken = data.accessToken;
      await this.tokenStorage.setRefreshToken(data.refreshToken);
      return true;
    } catch {
      return false;
    }
  }
}
