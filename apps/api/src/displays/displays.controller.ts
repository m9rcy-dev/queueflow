import {
  Controller,
  HttpException,
  HttpStatus,
  MessageEvent,
  Param,
  Req,
  Sse,
} from "@nestjs/common";
import type { Request } from "express";
import { Observable } from "rxjs";
import { Public } from "../auth/public.decorator";
import { SseConnectionLimiterService } from "../common/sse-connection-limiter.service";
import { QueueEventsService } from "../queue-events/queue-events.service";
import { DisplaysService } from "./displays.service";

const SSE_HEARTBEAT_MS = 25_000;

/**
 * The public TV board's live feed (Phase 6, G-07) — no auth, the display
 * identifies itself purely via the DISPLAY-context code in the URL.
 * Mirrors PublicQueueEntriesController's SSE handler exactly: an initial
 * snapshot on connect, then a fresh full snapshot on every queue change
 * (never a diff — G-27), a heartbeat to keep the connection alive through
 * proxies over the hours a screen typically stays open, and the same
 * concurrent-connections-per-IP cap (G-38, Phase 12).
 */
@Controller()
export class DisplaysController {
  constructor(
    private readonly displaysService: DisplaysService,
    private readonly queueEvents: QueueEventsService,
    private readonly sseConnectionLimiter: SseConnectionLimiterService,
  ) {}

  @Public()
  @Sse("public/displays/:code/events")
  watch(@Param("code") code: string, @Req() req: Request): Observable<MessageEvent> {
    const ip = req.ip ?? "unknown";
    if (!this.sseConnectionLimiter.tryAcquire(ip)) {
      throw new HttpException(
        { code: "TOO_MANY_CONNECTIONS", message: "Too many open connections from this network." },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return new Observable<MessageEvent>((subscriber) => {
      let unsubscribeFromQueue = (): void => undefined;

      const pushSnapshot = async (queueId: string): Promise<void> => {
        const snapshot = await this.displaysService.getSnapshot(queueId);
        subscriber.next({ data: snapshot });
      };

      this.displaysService
        .resolveQueueId(code)
        .then(async (queueId) => {
          await pushSnapshot(queueId);
          unsubscribeFromQueue = this.queueEvents.onQueueChanged(queueId, () => {
            void pushSnapshot(queueId).catch((err) => subscriber.error(err));
          });
        })
        .catch((err) => subscriber.error(err));

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
