import type { CodeResolution, JoinQueueResponse, QueueEntrySummary } from "@queueflow/types";
import type { JoinQueueInput } from "@queueflow/validation";
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
  };
}
