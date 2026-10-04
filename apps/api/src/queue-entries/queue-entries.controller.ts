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
import { LocationAccessService } from "../access/location-access.service";

/**
 * Staff-authenticated queue operations. All the fast, primary-action verbs
 * from the staff dashboard (plan §26-28) — no role restriction beyond
 * "is a member of this tenant" (STAFF included), since operating the queue
 * is exactly what STAFF-level accounts exist to do.
 */
@Controller("tenants/me")
export class QueueEntriesController {
  constructor(
    private readonly queueEntriesService: QueueEntriesService,
    private readonly access: LocationAccessService,
  ) {}

  @Get("queues/:queueId/entries")
  async list(
    @CurrentUser() user: RequestUser,
    @Param("queueId") queueId: string,
    @Query(new ZodValidationPipe(listQueueEntriesQuerySchema)) query: ListQueueEntriesQuery,
  ) {
    await this.access.assertQueue(user, queueId);
    return this.queueEntriesService.list(user.tenantId, queueId, query.status);
  }

  @Post("queues/:queueId/call-next")
  async callNext(@CurrentUser() user: RequestUser, @Param("queueId") queueId: string) {
    await this.access.assertQueue(user, queueId);
    return this.queueEntriesService.callNext(user.tenantId, queueId, user.tenantUserId);
  }

  /** Staff manually adding a walk-in from the counter (roadmap Phase 5) — same join logic as the QR-scan path, ownership-checked. */
  @Post("queues/:queueId/entries")
  async addWalkIn(
    @CurrentUser() user: RequestUser,
    @Param("queueId") queueId: string,
    @Body(new ZodValidationPipe(joinQueueSchema)) body: JoinQueueInput,
  ) {
    await this.access.assertQueue(user, queueId);
    return this.queueEntriesService.addWalkIn(user.tenantId, queueId, body);
  }

  /** The physical counter scanner's one call (Phase 10, D-10/D-11) — reads whatever code (guest card or customer identity) it just scanned. */
  @Post("queues/:queueId/scan")
  async scan(
    @CurrentUser() user: RequestUser,
    @Param("queueId") queueId: string,
    @Body(new ZodValidationPipe(scanCodeSchema)) body: ScanCodeInput,
  ) {
    await this.access.assertQueue(user, queueId);
    return this.queueEntriesService.joinByScan(user.tenantId, queueId, body.code);
  }

  /** The live "today" dashboard (Phase 11, G-14). */
  @Get("queues/:queueId/stats/today")
  async getTodayStats(@CurrentUser() user: RequestUser, @Param("queueId") queueId: string) {
    await this.access.assertQueue(user, queueId);
    return this.queueEntriesService.getTodayStats(user.tenantId, queueId);
  }

  @Get("queue-entries/:id")
  async get(@CurrentUser() user: RequestUser, @Param("id") id: string) {
    await this.access.assertQueueEntry(user, id);
    return this.queueEntriesService.getByIdForTenant(user.tenantId, id);
  }

  @Post("queue-entries/:id/start")
  async start(@CurrentUser() user: RequestUser, @Param("id") id: string) {
    await this.access.assertQueueEntry(user, id);
    return this.queueEntriesService.start(user.tenantId, id);
  }

  @Post("queue-entries/:id/complete")
  async complete(@CurrentUser() user: RequestUser, @Param("id") id: string) {
    await this.access.assertQueueEntry(user, id);
    return this.queueEntriesService.complete(user.tenantId, id);
  }

  @Post("queue-entries/:id/skip")
  async skip(@CurrentUser() user: RequestUser, @Param("id") id: string) {
    await this.access.assertQueueEntry(user, id);
    return this.queueEntriesService.skip(user.tenantId, id);
  }

  @Post("queue-entries/:id/requeue")
  async requeue(@CurrentUser() user: RequestUser, @Param("id") id: string) {
    await this.access.assertQueueEntry(user, id);
    return this.queueEntriesService.requeue(user.tenantId, id);
  }

  @Post("queue-entries/:id/cancel")
  async cancel(
    @CurrentUser() user: RequestUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(cancelEntrySchema)) body: CancelEntryInput,
  ) {
    await this.access.assertQueueEntry(user, id);
    return this.queueEntriesService.cancelByStaff(user.tenantId, id, body.reason);
  }

  @Post("queue-entries/:id/no-show")
  async noShow(@CurrentUser() user: RequestUser, @Param("id") id: string) {
    await this.access.assertQueueEntry(user, id);
    return this.queueEntriesService.markNoShow(user.tenantId, id);
  }

  @Post("queue-entries/:id/recall")
  async recall(@CurrentUser() user: RequestUser, @Param("id") id: string) {
    await this.access.assertQueueEntry(user, id);
    return this.queueEntriesService.recall(user.tenantId, id);
  }
}
