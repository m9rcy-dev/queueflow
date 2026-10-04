import { Body, Controller, Get, Param, Patch, Post, Query } from "@nestjs/common";
import {
  createServiceSchema,
  listServicesQuerySchema,
  updateServiceSchema,
  type CreateServiceInput,
  type ListServicesQuery,
  type UpdateServiceInput,
} from "@queueflow/validation";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { CurrentUser } from "../auth/current-user.decorator";
import { Roles } from "../auth/roles.decorator";
import type { RequestUser } from "../auth/request-user.interface";
import { ServicesService } from "./services.service";
import { LocationAccessService } from "../access/location-access.service";

@Controller("tenants/me/services")
export class ServicesController {
  constructor(
    private readonly servicesService: ServicesService,
    private readonly access: LocationAccessService,
  ) {}

  @Post()
  @Roles("TENANT_OWNER", "TENANT_ADMIN")
  create(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(createServiceSchema)) body: CreateServiceInput,
  ) {
    return this.servicesService.create(user.tenantId, body);
  }

  @Get()
  list(
    @CurrentUser() user: RequestUser,
    @Query(new ZodValidationPipe(listServicesQuerySchema)) query: ListServicesQuery,
  ) {
    return this.servicesService.list(
      user.tenantId,
      this.access.listLocation(user, query.locationId),
    );
  }

  @Get(":id")
  async get(@CurrentUser() user: RequestUser, @Param("id") id: string) {
    await this.access.assertService(user, id);
    return this.servicesService.get(user.tenantId, id);
  }

  @Patch(":id")
  @Roles("TENANT_OWNER", "TENANT_ADMIN")
  update(
    @CurrentUser() user: RequestUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateServiceSchema)) body: UpdateServiceInput,
  ) {
    return this.servicesService.update(user.tenantId, id, body);
  }
}
