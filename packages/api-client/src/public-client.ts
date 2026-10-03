import type {
  AppointmentAvailability,
  BookAppointmentResponse,
  CodeResolution,
  JoinQueueResponse,
  PublicAppointmentSummary,
  QueueEntrySummary,
} from "@queueflow/types";
import type { BookAppointmentInput, JoinQueueInput } from "@queueflow/validation";
import { ApiError } from "./errors";

/**
 * The anonymous customer client (Phase 4) — no Bearer token anywhere, the
 * code/queueId/publicToken in each call carry all the context needed. The
 * authenticated staff client (token attachment, refresh-and-retry-once,
 * budget-terry's proven shape) is Phase 5's job, once there's a staff
 * dashboard to call it from.
 */
export interface PublicApiClient {
  resolveCode(code: string): Promise<CodeResolution>;
  joinQueue(queueId: string, input: JoinQueueInput): Promise<JoinQueueResponse>;
  getTicket(token: string): Promise<QueueEntrySummary>;
  cancelTicket(token: string, reason?: string): Promise<QueueEntrySummary>;
  /** Not fetched directly — handed to an EventSource by the caller (browser-only API, so this stays a plain URL rather than a method that opens the connection itself). */
  ticketEventsUrl(token: string): string;
  /** The public TV board's live feed (Phase 6, G-07) — same reasoning as ticketEventsUrl: a plain URL for an EventSource, not a fetch. */
  displayEventsUrl(code: string): string;
  /** Phase 13 — bookable starts for one service on one location-local date (YYYY-MM-DD). */
  getAppointmentAvailability(
    locationId: string,
    serviceId: string,
    date: string,
  ): Promise<AppointmentAvailability>;
  bookAppointment(
    locationId: string,
    input: BookAppointmentInput,
  ): Promise<BookAppointmentResponse>;
  getAppointment(token: string): Promise<PublicAppointmentSummary>;
  cancelAppointment(token: string): Promise<PublicAppointmentSummary>;
}

export function createPublicApiClient(baseUrl: string): PublicApiClient {
  async function request<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...init?.headers },
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new ApiError(
        res.status,
        typeof body.code === "string" ? body.code : "UNKNOWN_ERROR",
        typeof body.message === "string" ? body.message : "Something went wrong. Please try again.",
      );
    }
    if (res.status === 204) {
      return undefined as T;
    }
    return res.json() as Promise<T>;
  }

  return {
    resolveCode: (code) => request(`/public/codes/${encodeURIComponent(code)}`),
    joinQueue: (queueId, input) =>
      request(`/public/queues/${encodeURIComponent(queueId)}/entries`, {
        method: "POST",
        body: JSON.stringify(input),
      }),
    getTicket: (token) => request(`/public/queue-entries/${encodeURIComponent(token)}`),
    cancelTicket: (token, reason) =>
      request(`/public/queue-entries/${encodeURIComponent(token)}/cancel`, {
        method: "POST",
        body: JSON.stringify({ reason }),
      }),
    ticketEventsUrl: (token) =>
      `${baseUrl}/public/queue-entries/${encodeURIComponent(token)}/events`,
    displayEventsUrl: (code) => `${baseUrl}/public/displays/${encodeURIComponent(code)}/events`,
    getAppointmentAvailability: (locationId, serviceId, date) =>
      request(
        `/public/locations/${encodeURIComponent(locationId)}/appointment-availability?${new URLSearchParams({ serviceId, date })}`,
      ),
    bookAppointment: (locationId, input) =>
      request(`/public/locations/${encodeURIComponent(locationId)}/appointments`, {
        method: "POST",
        body: JSON.stringify(input),
      }),
    getAppointment: (token) => request(`/public/appointments/${encodeURIComponent(token)}`),
    cancelAppointment: (token) =>
      request(`/public/appointments/${encodeURIComponent(token)}/cancel`, { method: "POST" }),
  };
}
