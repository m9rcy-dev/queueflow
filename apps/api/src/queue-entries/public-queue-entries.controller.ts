import { Body, Controller, Get, MessageEvent, Param, Post, Sse } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { Observable } from "rxjs";
import {
  cancelEntrySchema,
  joinQueueSchema,
  type CancelEntryInput,
  type JoinQueueInput,
} from "@queueflow/validation";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { Public } from "../auth/public.decorator";
import { QueueEventsService } from "../queue-events/queue-events.service";
import { QueueEntriesService } from "./queue-entries.service";

const SSE_HEARTBEAT_MS = 25_000;

/**
 * The anonymous walk-in path (plan §19/§48) — no tenant token exists here,
 * the queueId/publicToken in the URL carry all the context this needs.
 * `join` is the first genuinely public-unauthenticated write endpoint in
 * the system, so it carries basic rate limiting (G-40) from day one —
 * full numbers-across-every-endpoint hardening and a real bot check
 * (Turnstile) stay Phase 12's job, but this one doesn't ship with zero
 * protection.
 */
@Controller()
export class PublicQueueEntriesController {
  constructor(
    private readonly queueEntriesService: QueueEntriesService,
    private readonly queueEvents: QueueEventsService,
  ) {}

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post("public/queues/:queueId/entries")
  join(
    @Param("queueId") queueId: string,
    @Body(new ZodValidationPipe(joinQueueSchema)) body: JoinQueueInput,
  ) {
    return this.queueEntriesService.join(queueId, body);
  }

  @Public()
  @Get("public/queue-entries/:token")
  get(@Param("token") token: string) {
    return this.queueEntriesService.getByPublicToken(token);
  }

  @Public()
  @Post("public/queue-entries/:token/cancel")
  cancel(
    @Param("token") token: string,
    @Body(new ZodValidationPipe(cancelEntrySchema)) body: CancelEntryInput,
  ) {
    return this.queueEntriesService.cancelByPublicToken(token, body.reason);
  }

  /**
   * Live position/status (Phase 4's "live position via SSE"). Pushes an
   * immediate snapshot on connect, then a fresh snapshot every time
   * anything in this ticket's queue changes — never a diff, always the
   * full current state, since the client must never trust it caught every
   * event (G-27) and a reconnect should just look like any other update.
   */
  @Public()
  @Sse("public/queue-entries/:token/events")
  watch(@Param("token") token: string): Observable<MessageEvent> {
    return new Observable<MessageEvent>((subscriber) => {
      let unsubscribeFromQueue = (): void => undefined;

      const pushCurrentState = async (): Promise<void> => {
        const summary = await this.queueEntriesService.getByPublicToken(token);
        subscriber.next({ data: summary });
      };

      // Fetch once for the initial snapshot, and to learn which queue to
      // subscribe to — every subsequent push re-fetches fresh, but there's
      // no need to fetch twice just to discover the queueId.
      this.queueEntriesService
        .getByPublicToken(token)
        .then((summary) => {
          subscriber.next({ data: summary });
          unsubscribeFromQueue = this.queueEvents.onQueueChanged(summary.queueId, () => {
            void pushCurrentState().catch((err) => subscriber.error(err));
          });
        })
        .catch((err) => subscriber.error(err));

      // Keeps intermediary proxies/load balancers from timing out an
      // otherwise-idle long-lived connection.
      const heartbeat = setInterval(() => {
        subscriber.next({ type: "ping", data: {} });
      }, SSE_HEARTBEAT_MS);

      return () => {
        clearInterval(heartbeat);
        unsubscribeFromQueue();
      };
    });
  }
}
