import { Body, Controller, Get, Param, Patch, Post, Put } from "@nestjs/common";
import {
  createLocationSchema,
  replaceBusinessHoursSchema,
  updateLocationSchema,
  type CreateLocationInput,
  type ReplaceBusinessHoursInput,
  type UpdateLocationInput,
} from "@queueflow/validation";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { CurrentUser } from "../auth/current-user.decorator";
import { Roles } from "../auth/roles.decorator";
import type { RequestUser } from "../auth/request-user.interface";
import { LocationsService } from "./locations.service";

/** Every route operates on "my tenant's locations" — tenantId always comes from the token, never the URL/body. */
@Controller("tenants/me/locations")
export class LocationsController {
  constructor(private readonly locationsService: LocationsService) {}

  @Post()
  @Roles("TENANT_OWNER", "TENANT_ADMIN")
  create(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(createLocationSchema)) body: CreateLocationInput,
  ) {
    return this.locationsService.create(user.tenantId, body);
  }

  @Get()
  list(@CurrentUser() user: RequestUser) {
    return this.locationsService.list(user.tenantId);
  }

  @Get(":id")
  get(@CurrentUser() user: RequestUser, @Param("id") id: string) {
    return this.locationsService.get(user.tenantId, id);
  }

  @Patch(":id")
  @Roles("TENANT_OWNER", "TENANT_ADMIN")
  update(
    @CurrentUser() user: RequestUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateLocationSchema)) body: UpdateLocationInput,
  ) {
    return this.locationsService.update(user.tenantId, id, body);
  }

  @Get(":id/business-hours")
  getBusinessHours(@CurrentUser() user: RequestUser, @Param("id") id: string) {
    return this.locationsService.getBusinessHours(user.tenantId, id);
  }

  @Put(":id/business-hours")
  @Roles("TENANT_OWNER", "TENANT_ADMIN")
  replaceBusinessHours(
    @CurrentUser() user: RequestUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(replaceBusinessHoursSchema)) body: ReplaceBusinessHoursInput,
  ) {
    return this.locationsService.replaceBusinessHours(user.tenantId, id, body);
  }
}
