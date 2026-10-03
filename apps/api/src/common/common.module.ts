import { Global, Module } from "@nestjs/common";
import { SseConnectionLimiterService } from "./sse-connection-limiter.service";

/**
 * Global (same pattern as PrismaModule) — `SseConnectionLimiterService`
 * must be ONE shared singleton across every SSE controller (ticket watch,
 * display board), so one IP's concurrent-connection count (G-38) is
 * tracked app-wide, not per-module.
 */
@Global()
@Module({
  providers: [SseConnectionLimiterService],
  exports: [SseConnectionLimiterService],
})
export class CommonModule {}
