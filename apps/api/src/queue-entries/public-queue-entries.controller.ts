import {
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  MessageEvent,
  Param,
  Post,
  Req,
  Sse,
  UseGuards,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import type { Request } from "express";
import { Observable } from "rxjs";
import {
  cancelEntrySchema,
  joinQueueSchema,
  type CancelEntryInput,
  type JoinQueueInput,
} from "@queueflow/validation";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { Public } from "../auth/public.decorator";
import { SseConnectionLimiterService } from "../common/sse-connection-limiter.service";
import { QueueEventsService } from "../queue-events/queue-events.service";
import { QueueEntriesService } from "./queue-entries.service";
import { JoinPhoneThrottleGuard } from "./join-phone-throttle.guard";
import { TicketTokenThrottleGuard } from "./ticket-token-throttle.guard";

const SSE_HEARTBEAT_MS = 25_000;

/**
 * The anonymous walk-in path (plan §19/§48) — no tenant token exists here,
 * the queueId/publicToken in the URL carry all the context this needs.
 * Concrete rate-limit numbers throughout (G-38, Phase 12): join is capped
 * both per-IP (`@Throttle`, below) and per-phone (`JoinPhoneThrottleGuard`
 * — a shared IP shouldn't block a different customer's phone, and the same
 * phone through multiple IPs shouldn't bypass its own cap either); ticket
 * reads are capped per-token (`TicketTokenThrottleGuard`); the SSE watch
 * below caps concurrent connections per IP (`SseConnectionLimiterService`
 * — a different shape than request-rate throttling, since it's a long-lived
 * connection count, not a request count).
 */
@Controller()
export class PublicQueueEntriesController {
  constructor(
    private readonly queueEntriesService: QueueEntriesService,
    private readonly queueEvents: QueueEventsService,
    private readonly sseConnectionLimiter: SseConnectionLimiterService,
  ) {}

  @Public()
  @UseGuards(JoinPhoneThrottleGuard)
  @Throttle({ default: { limit: 20, ttl: 3_600_000 } }) // G-38: 20/hour per IP
  @Post("public/queues/:queueId/entries")
  join(
    @Param("queueId") queueId: string,
    @Body(new ZodValidationPipe(joinQueueSchema)) body: JoinQueueInput,
  ) {
    return this.queueEntriesService.join(queueId, body);
  }

  @Public()
  @UseGuards(TicketTokenThrottleGuard)
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
  watch(@Param("token") token: string, @Req() req: Request): Observable<MessageEvent> {
    const ip = req.ip ?? "unknown";
    if (!this.sseConnectionLimiter.tryAcquire(ip)) {
      throw new HttpException(
        { code: "TOO_MANY_CONNECTIONS", message: "Too many open connections from this network." },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

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
        this.sseConnectionLimiter.release(ip);
      };
    });
  }
}
