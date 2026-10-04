import { Body, Controller, Get, Param, Patch, Post, Query } from "@nestjs/common";
import {
  attachServiceSchema,
  createQueueSchema,
  updateQueueConfigSchema,
  updateQueueStatusSchema,
  type AttachServiceInput,
  type CreateQueueInput,
  type UpdateQueueConfigInput,
  type UpdateQueueStatusInput,
} from "@queueflow/validation";
import { z } from "zod";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { CurrentUser } from "../auth/current-user.decorator";
import { Roles } from "../auth/roles.decorator";
import type { RequestUser } from "../auth/request-user.interface";
import { QueuesService } from "./queues.service";
import { LocationAccessService } from "../access/location-access.service";

const listQuerySchema = z.object({ locationId: z.string().uuid().optional() });

@Controller("tenants/me/queues")
export class QueuesController {
  constructor(
    private readonly queuesService: QueuesService,
    private readonly access: LocationAccessService,
  ) {}

  @Post()
  @Roles("TENANT_OWNER", "TENANT_ADMIN")
  create(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(createQueueSchema)) body: CreateQueueInput,
  ) {
    return this.queuesService.create(user.tenantId, body);
  }

  @Get()
  list(
    @CurrentUser() user: RequestUser,
    @Query(new ZodValidationPipe(listQuerySchema)) query: { locationId?: string },
  ) {
    return this.queuesService.list(user.tenantId, this.access.listLocation(user, query.locationId));
  }

  @Get(":id")
  async get(@CurrentUser() user: RequestUser, @Param("id") id: string) {
    await this.access.assertQueue(user, id);
    return this.queuesService.get(user.tenantId, id);
  }

  @Patch(":id")
  @Roles("TENANT_OWNER", "TENANT_ADMIN")
  updateConfig(
    @CurrentUser() user: RequestUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateQueueConfigSchema)) body: UpdateQueueConfigInput,
  ) {
    return this.queuesService.updateConfig(user.tenantId, id, body);
  }

  @Patch(":id/status")
  @Roles("TENANT_OWNER", "TENANT_ADMIN", "MANAGER", "STAFF")
  async updateStatus(
    @CurrentUser() user: RequestUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateQueueStatusSchema)) body: UpdateQueueStatusInput,
  ) {
    await this.access.assertQueue(user, id);
    return this.queuesService.updateStatus(user.tenantId, id, body);
  }

  @Post(":id/services")
  @Roles("TENANT_OWNER", "TENANT_ADMIN")
  async attachService(
    @CurrentUser() user: RequestUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(attachServiceSchema)) body: AttachServiceInput,
  ): Promise<{ message: string }> {
    await this.queuesService.attachService(user.tenantId, id, body);
    return { message: "Service attached." };
  }

  @Get(":id/services")
  async listServices(@CurrentUser() user: RequestUser, @Param("id") id: string) {
    await this.access.assertQueue(user, id);
    return this.queuesService.listServiceIds(user.tenantId, id);
  }

  /** For the staff walk-in form's service picker — same joinable-now filter as the public QR landing page. */
  @Get(":id/joinable-services")
  async listJoinableServices(@CurrentUser() user: RequestUser, @Param("id") id: string) {
    await this.access.assertQueue(user, id);
    return this.queuesService.listJoinableServices(user.tenantId, id);
  }
}
