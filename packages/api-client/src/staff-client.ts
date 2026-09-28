import type {
  AuthSuccessResponse,
  DeviceContextResponse,
  LoginVerifyResponse,
  QueueSummary,
  StaffQueueEntrySummary,
  TenantRole,
  TenantSummary,
  TrustDeviceResponse,
} from "@queueflow/types";
import type { JoinQueueInput } from "@queueflow/validation";
import { ApiError } from "./errors";

/** Mirrors apps/api's RequestUser (an API-internal shape, not published to @queueflow/types) — what GET /auth/me returns. */
export interface StaffSession {
  userId: string;
  tenantId: string;
  tenantUserId: string;
  role: TenantRole;
}

/**
 * The authenticated staff client (Phase 5) — Bearer token attachment,
 * refresh-and-retry-once on a 401, and the trusted-device/PIN flow
 * (D-03a), all mirroring budget-terry's proven `ApiClient` shape
 * (`docs/trusted-device-plan.md`) adapted to QueueFlow's tenant-scoped
 * sessions. The anonymous customer client (`public-client.ts`) is a
 * separate, deliberately much simpler thing — no tokens, no retry.
 */
export interface TokenStorage {
  getRefreshToken(): Promise<string | null> | string | null;
  setRefreshToken(token: string | null): Promise<void> | void;
  /** Survives logout by design (D-03a) — a trusted device should skip straight to PIN switching even after signing out, so this is a separate slot from the refresh token. */
  getDeviceTrustToken(): Promise<string | null> | string | null;
  setDeviceTrustToken(token: string | null): Promise<void> | void;
}

export interface StaffApiClientConfig {
  baseUrl: string;
  fetchImpl?: typeof fetch;
  tokenStorage?: TokenStorage;
}

interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
}

export class StaffApiClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly tokenStorage?: TokenStorage;
  /** Never persisted — restored via restoreSession()/tryDeviceLogin() on each app load, same reasoning as budget-terry's ADR-011. */
  private accessToken: string | null = null;

  constructor(config: StaffApiClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, "");
    this.fetchImpl = config.fetchImpl ?? fetch.bind(globalThis);
    this.tokenStorage = config.tokenStorage;
  }

  setAccessToken(token: string | null): void {
    this.accessToken = token;
  }

  async requestLoginCode(email: string): Promise<void> {
    await this.request<void>("/auth/login/request", { method: "POST", body: { email } });
  }

  async verifyLoginCode(email: string, code: string): Promise<LoginVerifyResponse> {
    const response = await this.request<LoginVerifyResponse>("/auth/login/verify", {
      method: "POST",
      body: { email, code },
    });
    if (!response.requiresTenantSelection) {
      await this.applyAuthResponse(response);
    }
    return response;
  }

  async selectTenant(pendingToken: string, tenantId: string): Promise<AuthSuccessResponse> {
    const response = await this.request<AuthSuccessResponse>("/auth/select-tenant", {
      method: "POST",
      body: { pendingToken, tenantId },
    });
    await this.applyAuthResponse(response);
    return response;
  }

  /** "Trust this device" (D-03a) — call once already authenticated. Persists the returned token for tryRestoreDeviceContext() on future app loads. */
  async trustDevice(): Promise<TrustDeviceResponse> {
    const response = await this.request<TrustDeviceResponse>("/auth/devices/trust", {
      method: "POST",
    });
    await this.tokenStorage?.setDeviceTrustToken(response.deviceTrustToken);
    return response;
  }

  /**
   * Call on app startup, before showing the normal login form: if a
   * trusted-device token survived from a previous session, exchanges it
   * for the tenant's staff roster (for a "pick your name" screen) —
   * persisting the rotated token — or clears storage and returns null if
   * it was rejected, so the caller falls through to normal OTP login.
   */
  async tryRestoreDeviceContext(): Promise<DeviceContextResponse | null> {
    const deviceTrustToken = await this.tokenStorage?.getDeviceTrustToken();
    if (!deviceTrustToken) {
      return null;
    }
    try {
      const response = await this.request<DeviceContextResponse>("/auth/device-context", {
        method: "POST",
        body: { deviceTrustToken },
      });
      await this.tokenStorage?.setDeviceTrustToken(response.deviceTrustToken);
      return response;
    } catch {
      await this.tokenStorage?.setDeviceTrustToken(null);
      return null;
    }
  }

  /** Second half of shift-change switching — a staff member's PIN, checked against a trusted device (D-03a). */
  async staffPinLogin(
    deviceTrustToken: string,
    tenantUserId: string,
    pin: string,
  ): Promise<AuthSuccessResponse> {
    const response = await this.request<AuthSuccessResponse>("/auth/staff-pin-login", {
      method: "POST",
      body: { deviceTrustToken, tenantUserId, pin },
    });
    await this.applyAuthResponse(response);
    return response;
  }

  /** Sets/changes the current staff member's own PIN for quick device switching. */
  async setPin(pin: string): Promise<void> {
    await this.request<void>("/auth/pin", { method: "POST", body: { pin } });
  }

  async logout(): Promise<void> {
    const refreshToken = await this.tokenStorage?.getRefreshToken();
    this.accessToken = null;
    await this.tokenStorage?.setRefreshToken(null);
    if (refreshToken) {
      await this.request("/auth/logout", { method: "POST", body: { refreshToken } }).catch(
        () => undefined,
      );
    }
  }

  /** Call once on app startup: exchanges a surviving refresh token for a fresh access token, or returns null. */
  async restoreSession(): Promise<StaffSession | null> {
    const refreshed = await this.refreshAccessToken();
    if (!refreshed) {
      return null;
    }
    return this.request<StaffSession>("/auth/me");
  }

  getMe(): Promise<StaffSession> {
    return this.request<StaffSession>("/auth/me");
  }

  getTenant(): Promise<TenantSummary> {
    return this.request<TenantSummary>("/tenants/me");
  }

  listQueues(): Promise<QueueSummary[]> {
    return this.request<QueueSummary[]>("/tenants/me/queues");
  }

  listEntries(queueId: string, status?: string): Promise<StaffQueueEntrySummary[]> {
    const query = status ? `?status=${encodeURIComponent(status)}` : "";
    return this.request<StaffQueueEntrySummary[]>(`/tenants/me/queues/${queueId}/entries${query}`);
  }

  listJoinableServices(
    queueId: string,
  ): Promise<Array<{ id: string; name: string; durationMinutes: number }>> {
    return this.request(`/tenants/me/queues/${queueId}/joinable-services`);
  }

  addWalkIn(queueId: string, input: JoinQueueInput): Promise<StaffQueueEntrySummary> {
    return this.request(`/tenants/me/queues/${queueId}/entries`, { method: "POST", body: input });
  }

  callNext(queueId: string): Promise<StaffQueueEntrySummary> {
    return this.request(`/tenants/me/queues/${queueId}/call-next`, { method: "POST" });
  }

  startEntry(entryId: string): Promise<StaffQueueEntrySummary> {
    return this.request(`/tenants/me/queue-entries/${entryId}/start`, { method: "POST" });
  }

  completeEntry(entryId: string): Promise<StaffQueueEntrySummary> {
    return this.request(`/tenants/me/queue-entries/${entryId}/complete`, { method: "POST" });
  }

  skipEntry(entryId: string): Promise<StaffQueueEntrySummary> {
    return this.request(`/tenants/me/queue-entries/${entryId}/skip`, { method: "POST" });
  }

  requeueEntry(entryId: string): Promise<StaffQueueEntrySummary> {
    return this.request(`/tenants/me/queue-entries/${entryId}/requeue`, { method: "POST" });
  }

  cancelEntry(entryId: string, reason?: string): Promise<StaffQueueEntrySummary> {
    return this.request(`/tenants/me/queue-entries/${entryId}/cancel`, {
      method: "POST",
      body: { reason },
    });
  }

  noShowEntry(entryId: string): Promise<StaffQueueEntrySummary> {
    return this.request(`/tenants/me/queue-entries/${entryId}/no-show`, { method: "POST" });
  }

  recallEntry(entryId: string): Promise<StaffQueueEntrySummary> {
    return this.request(`/tenants/me/queue-entries/${entryId}/recall`, { method: "POST" });
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

    // A 401 on anything other than the auth endpoints themselves gets one
    // silent refresh-and-retry — the caller never sees the expired-token
    // error unless the refresh token has also expired/been revoked.
    if (response.status === 401 && !isRetry && !path.startsWith("/auth/")) {
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
    return (await response.json()) as T;
  }

  private async applyAuthResponse(response: AuthSuccessResponse): Promise<void> {
    this.accessToken = response.accessToken;
    await this.tokenStorage?.setRefreshToken(response.refreshToken);
  }

  private async refreshAccessToken(): Promise<boolean> {
    if (!this.tokenStorage) {
      return false;
    }
    const refreshToken = await this.tokenStorage.getRefreshToken();
    if (!refreshToken) {
      return false;
    }
    try {
      const response = await this.fetchImpl(`${this.baseUrl}/auth/refresh`, {
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
