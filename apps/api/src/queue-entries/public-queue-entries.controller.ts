import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import {
  cancelEntrySchema,
  joinQueueSchema,
  type CancelEntryInput,
  type JoinQueueInput,
} from "@queueflow/validation";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { Public } from "../auth/public.decorator";
import { QueueEntriesService } from "./queue-entries.service";

/**
 * The anonymous walk-in path (plan §19/§48) — no tenant token exists here,
 * the queueId/publicToken in the URL carry all the context this needs.
 * Real rate limiting (G-40) is Phase 12's job; these routes are the ones
 * that will need it most.
 */
@Controller()
export class PublicQueueEntriesController {
  constructor(private readonly queueEntriesService: QueueEntriesService) {}

  @Public()
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
}
