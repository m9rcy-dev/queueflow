import type {
  AppointmentCalendarDay,
  AppointmentSettings,
  AuthenticatorSetup,
  AuthenticatorStatus,
  AuthSuccessResponse,
  BookAppointmentResponse,
  CreateClosureResponse,
  LocationClosureSummary,
  StaffAppointmentSummary,
  BusinessHoursEntry,
  CodeContextType,
  CodeSummary,
  DeviceContextResponse,
  GuestCardSummary,
  InviteSummary,
  LocationSummary,
  LoginVerifyResponse,
  QueueSummary,
  QueueTodayStats,
  ServiceSummary,
  StaffQueueEntrySummary,
  TenantMemberSummary,
  TenantRole,
  TenantSummary,
  TrustDeviceResponse,
} from "@queueflow/types";
import type {
  BookAppointmentInput,
  CreateClosureInput,
  CreateInviteInput,
  CreateLocationInput,
  CreateQueueInput,
  CreateServiceInput,
  JoinQueueInput,
  ReplaceBusinessHoursInput,
  StaffCancelAppointmentInput,
  UpdateAppointmentSettingsInput,
  UpdateCapabilitiesInput,
  UpdateLocationInput,
  UpdateQueueConfigInput,
  UpdateServiceInput,
} from "@queueflow/validation";
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
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
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

  /** `forceEmail` = "Email me a code instead" — sends one even when the account uses an authenticator app (Phase 15). */
  async requestLoginCode(email: string, forceEmail = false): Promise<void> {
    await this.request<void>("/auth/login/request", {
      method: "POST",
      body: forceEmail ? { email, forceEmail } : { email },
    });
  }

  // --- Authenticator app login (Phase 15) ---

  getAuthenticatorStatus(): Promise<AuthenticatorStatus> {
    return this.request("/auth/me/authenticator");
  }

  beginAuthenticatorSetup(): Promise<AuthenticatorSetup> {
    return this.request("/auth/me/authenticator/setup", { method: "POST" });
  }

  confirmAuthenticator(code: string): Promise<AuthenticatorStatus> {
    return this.request("/auth/me/authenticator/confirm", { method: "POST", body: { code } });
  }

  disableAuthenticator(): Promise<AuthenticatorStatus> {
    return this.request("/auth/me/authenticator", { method: "DELETE" });
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

  updateCapabilities(input: UpdateCapabilitiesInput): Promise<TenantSummary> {
    return this.request("/tenants/me/capabilities", { method: "PATCH", body: input });
  }

  listStaff(): Promise<TenantMemberSummary[]> {
    return this.request("/tenants/me/staff");
  }

  createInvite(input: CreateInviteInput): Promise<InviteSummary> {
    return this.request("/tenants/me/invites", { method: "POST", body: input });
  }

  listInvites(): Promise<InviteSummary[]> {
    return this.request("/tenants/me/invites");
  }

  revokeInvite(inviteId: string): Promise<void> {
    return this.request(`/tenants/me/invites/${inviteId}`, { method: "DELETE" });
  }

  createLocation(input: CreateLocationInput): Promise<LocationSummary> {
    return this.request("/tenants/me/locations", { method: "POST", body: input });
  }

  listLocations(): Promise<LocationSummary[]> {
    return this.request("/tenants/me/locations");
  }

  getLocation(locationId: string): Promise<LocationSummary> {
    return this.request(`/tenants/me/locations/${locationId}`);
  }

  updateLocation(locationId: string, input: UpdateLocationInput): Promise<LocationSummary> {
    return this.request(`/tenants/me/locations/${locationId}`, { method: "PATCH", body: input });
  }

  getBusinessHours(locationId: string): Promise<BusinessHoursEntry[]> {
    return this.request(`/tenants/me/locations/${locationId}/business-hours`);
  }

  replaceBusinessHours(
    locationId: string,
    input: ReplaceBusinessHoursInput,
  ): Promise<BusinessHoursEntry[]> {
    return this.request(`/tenants/me/locations/${locationId}/business-hours`, {
      method: "PUT",
      body: input,
    });
  }

  createService(input: CreateServiceInput): Promise<ServiceSummary> {
    return this.request("/tenants/me/services", { method: "POST", body: input });
  }

  listServices(locationId?: string): Promise<ServiceSummary[]> {
    const query = locationId ? `?locationId=${encodeURIComponent(locationId)}` : "";
    return this.request(`/tenants/me/services${query}`);
  }

  updateService(serviceId: string, input: UpdateServiceInput): Promise<ServiceSummary> {
    return this.request(`/tenants/me/services/${serviceId}`, { method: "PATCH", body: input });
  }

  createQueue(input: CreateQueueInput): Promise<QueueSummary> {
    return this.request("/tenants/me/queues", { method: "POST", body: input });
  }

  listQueues(): Promise<QueueSummary[]> {
    return this.request<QueueSummary[]>("/tenants/me/queues");
  }

  getQueue(queueId: string): Promise<QueueSummary> {
    return this.request<QueueSummary>(`/tenants/me/queues/${queueId}`);
  }

  updateQueueConfig(queueId: string, input: UpdateQueueConfigInput): Promise<QueueSummary> {
    return this.request(`/tenants/me/queues/${queueId}`, { method: "PATCH", body: input });
  }

  updateQueueStatus(queueId: string, status: QueueSummary["status"]): Promise<QueueSummary> {
    return this.request(`/tenants/me/queues/${queueId}/status`, {
      method: "PATCH",
      body: { status },
    });
  }

  attachService(queueId: string, serviceId: string): Promise<{ message: string }> {
    return this.request(`/tenants/me/queues/${queueId}/services`, {
      method: "POST",
      body: { serviceId },
    });
  }

  listAttachedServiceIds(queueId: string): Promise<string[]> {
    return this.request(`/tenants/me/queues/${queueId}/services`);
  }

  getTodayStats(queueId: string): Promise<QueueTodayStats> {
    return this.request(`/tenants/me/queues/${queueId}/stats/today`);
  }

  /** QUEUE/DISPLAY codes only — the tenant-level GENERAL "sign up here" poster uses createGeneralCode/listGeneralCodes/deactivateGeneralCode instead (not queue-scoped). */
  createCode(queueId: string, contextType?: CodeContextType): Promise<CodeSummary> {
    return this.request(`/tenants/me/queues/${queueId}/codes`, {
      method: "POST",
      body: contextType ? { contextType } : {},
    });
  }

  listCodes(queueId: string): Promise<CodeSummary[]> {
    return this.request(`/tenants/me/queues/${queueId}/codes`);
  }

  deactivateCode(queueId: string, codeId: string): Promise<void> {
    return this.request(`/tenants/me/queues/${queueId}/codes/${codeId}/deactivate`, {
      method: "POST",
    });
  }

  createGeneralCode(): Promise<CodeSummary> {
    return this.request("/tenants/me/codes", { method: "POST", body: { contextType: "GENERAL" } });
  }

  listGeneralCodes(): Promise<CodeSummary[]> {
    return this.request("/tenants/me/codes");
  }

  regenerateGeneralCode(): Promise<CodeSummary> {
    return this.request("/tenants/me/codes/regenerate", { method: "POST" });
  }

  deactivateGeneralCode(codeId: string): Promise<void> {
    return this.request(`/tenants/me/codes/${codeId}/deactivate`, { method: "POST" });
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

  /** The physical counter scanner's one call (Phase 10, D-10/D-11) — whatever a guest card or a customer's own identity code scanned to. */
  scan(queueId: string, code: string): Promise<StaffQueueEntrySummary> {
    return this.request(`/tenants/me/queues/${queueId}/scan`, { method: "POST", body: { code } });
  }

  listGuestCards(locationId: string): Promise<GuestCardSummary[]> {
    return this.request(`/tenants/me/locations/${locationId}/guest-cards`);
  }

  resizeGuestCardPool(locationId: string, poolSize: number): Promise<GuestCardSummary[]> {
    return this.request(`/tenants/me/locations/${locationId}/guest-cards`, {
      method: "PUT",
      body: { poolSize },
    });
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

  // --- Appointments (Phase 13, ADR-012) ---

  getAppointmentSettings(): Promise<AppointmentSettings> {
    return this.request("/tenants/me/appointment-settings");
  }

  updateAppointmentSettings(input: UpdateAppointmentSettingsInput): Promise<AppointmentSettings> {
    return this.request("/tenants/me/appointment-settings", { method: "PATCH", body: input });
  }

  listClosures(locationId: string): Promise<LocationClosureSummary[]> {
    return this.request(`/tenants/me/locations/${locationId}/closures`);
  }

  createClosure(locationId: string, input: CreateClosureInput): Promise<CreateClosureResponse> {
    return this.request(`/tenants/me/locations/${locationId}/closures`, {
      method: "POST",
      body: input,
    });
  }

  deleteClosure(locationId: string, closureId: string): Promise<void> {
    return this.request(`/tenants/me/locations/${locationId}/closures/${closureId}`, {
      method: "DELETE",
    });
  }

  getAppointmentCalendar(locationId: string, month: string): Promise<AppointmentCalendarDay[]> {
    return this.request(
      `/tenants/me/locations/${locationId}/appointments/calendar?month=${encodeURIComponent(month)}`,
    );
  }

  listAppointmentsForDay(locationId: string, date: string): Promise<StaffAppointmentSummary[]> {
    return this.request(
      `/tenants/me/locations/${locationId}/appointments?date=${encodeURIComponent(date)}`,
    );
  }

  bookAppointmentForCustomer(
    locationId: string,
    input: BookAppointmentInput,
  ): Promise<BookAppointmentResponse> {
    return this.request(`/tenants/me/locations/${locationId}/appointments`, {
      method: "POST",
      body: input,
    });
  }

  /** Phase 14 — check a booked customer in; they join the queue (the location's, unless queueId is given). */
  checkInAppointment(appointmentId: string, queueId?: string): Promise<StaffQueueEntrySummary> {
    return this.request(`/tenants/me/appointments/${appointmentId}/check-in`, {
      method: "POST",
      body: queueId ? { queueId } : {},
    });
  }

  /** Undo a no-show, same day only. */
  restoreAppointment(appointmentId: string): Promise<StaffAppointmentSummary> {
    return this.request(`/tenants/me/appointments/${appointmentId}/restore`, { method: "POST" });
  }

  cancelAppointment(
    appointmentId: string,
    input: StaffCancelAppointmentInput,
  ): Promise<StaffAppointmentSummary> {
    return this.request(`/tenants/me/appointments/${appointmentId}/cancel`, {
      method: "POST",
      body: input,
    });
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
