import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import {
  cancelEntrySchema,
  joinQueueSchema,
  listQueueEntriesQuerySchema,
  scanCodeSchema,
  type CancelEntryInput,
  type JoinQueueInput,
  type ListQueueEntriesQuery,
  type ScanCodeInput,
} from "@queueflow/validation";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { CurrentUser } from "../auth/current-user.decorator";
import type { RequestUser } from "../auth/request-user.interface";
import { QueueEntriesService } from "./queue-entries.service";

/**
 * Staff-authenticated queue operations. All the fast, primary-action verbs
 * from the staff dashboard (plan §26-28) — no role restriction beyond
 * "is a member of this tenant" (STAFF included), since operating the queue
 * is exactly what STAFF-level accounts exist to do.
 */
@Controller("tenants/me")
export class QueueEntriesController {
  constructor(private readonly queueEntriesService: QueueEntriesService) {}

  @Get("queues/:queueId/entries")
  list(
    @CurrentUser() user: RequestUser,
    @Param("queueId") queueId: string,
    @Query(new ZodValidationPipe(listQueueEntriesQuerySchema)) query: ListQueueEntriesQuery,
  ) {
    return this.queueEntriesService.list(user.tenantId, queueId, query.status);
  }

  @Post("queues/:queueId/call-next")
  callNext(@CurrentUser() user: RequestUser, @Param("queueId") queueId: string) {
    return this.queueEntriesService.callNext(user.tenantId, queueId, user.tenantUserId);
  }

  /** Staff manually adding a walk-in from the counter (roadmap Phase 5) — same join logic as the QR-scan path, ownership-checked. */
  @Post("queues/:queueId/entries")
  addWalkIn(
    @CurrentUser() user: RequestUser,
    @Param("queueId") queueId: string,
    @Body(new ZodValidationPipe(joinQueueSchema)) body: JoinQueueInput,
  ) {
    return this.queueEntriesService.addWalkIn(user.tenantId, queueId, body);
  }

  /** The physical counter scanner's one call (Phase 10, D-10/D-11) — reads whatever code (guest card or customer identity) it just scanned. */
  @Post("queues/:queueId/scan")
  scan(
    @CurrentUser() user: RequestUser,
    @Param("queueId") queueId: string,
    @Body(new ZodValidationPipe(scanCodeSchema)) body: ScanCodeInput,
  ) {
    return this.queueEntriesService.joinByScan(user.tenantId, queueId, body.code);
  }

  @Get("queue-entries/:id")
  get(@CurrentUser() user: RequestUser, @Param("id") id: string) {
    return this.queueEntriesService.getByIdForTenant(user.tenantId, id);
  }

  @Post("queue-entries/:id/start")
  start(@CurrentUser() user: RequestUser, @Param("id") id: string) {
    return this.queueEntriesService.start(user.tenantId, id);
  }

  @Post("queue-entries/:id/complete")
  complete(@CurrentUser() user: RequestUser, @Param("id") id: string) {
    return this.queueEntriesService.complete(user.tenantId, id);
  }

  @Post("queue-entries/:id/skip")
  skip(@CurrentUser() user: RequestUser, @Param("id") id: string) {
    return this.queueEntriesService.skip(user.tenantId, id);
  }

  @Post("queue-entries/:id/requeue")
  requeue(@CurrentUser() user: RequestUser, @Param("id") id: string) {
    return this.queueEntriesService.requeue(user.tenantId, id);
  }

  @Post("queue-entries/:id/cancel")
  cancel(
    @CurrentUser() user: RequestUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(cancelEntrySchema)) body: CancelEntryInput,
  ) {
    return this.queueEntriesService.cancelByStaff(user.tenantId, id, body.reason);
  }

  @Post("queue-entries/:id/no-show")
  noShow(@CurrentUser() user: RequestUser, @Param("id") id: string) {
    return this.queueEntriesService.markNoShow(user.tenantId, id);
  }

  @Post("queue-entries/:id/recall")
  recall(@CurrentUser() user: RequestUser, @Param("id") id: string) {
    return this.queueEntriesService.recall(user.tenantId, id);
  }
}
