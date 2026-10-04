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
import { LocationAccessService } from "../access/location-access.service";

/** Every route operates on "my tenant's locations" — tenantId always comes from the token, never the URL/body. */
@Controller("tenants/me/locations")
export class LocationsController {
  constructor(
    private readonly locationsService: LocationsService,
    private readonly access: LocationAccessService,
  ) {}

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
    return this.locationsService.list(user.tenantId, this.access.locationFilter(user));
  }

  @Get(":id")
  get(@CurrentUser() user: RequestUser, @Param("id") id: string) {
    this.access.assertLocation(user, id);
    return this.locationsService.get(user.tenantId, id);
  }

  @Patch(":id")
  @Roles("TENANT_OWNER", "TENANT_ADMIN", "MANAGER")
  update(
    @CurrentUser() user: RequestUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateLocationSchema)) body: UpdateLocationInput,
  ) {
    this.access.assertLocation(user, id);
    return this.locationsService.update(user.tenantId, id, body);
  }

  /** Phase 17 — who can serve here (for handing a customer over); any member of this location. */
  @Get(":id/team")
  team(@CurrentUser() user: RequestUser, @Param("id") id: string) {
    this.access.assertLocation(user, id);
    return this.locationsService.listTeam(user.tenantId, id);
  }

  @Get(":id/business-hours")
  getBusinessHours(@CurrentUser() user: RequestUser, @Param("id") id: string) {
    this.access.assertLocation(user, id);
    return this.locationsService.getBusinessHours(user.tenantId, id);
  }

  @Put(":id/business-hours")
  @Roles("TENANT_OWNER", "TENANT_ADMIN", "MANAGER")
  replaceBusinessHours(
    @CurrentUser() user: RequestUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(replaceBusinessHoursSchema)) body: ReplaceBusinessHoursInput,
  ) {
    this.access.assertLocation(user, id);
    return this.locationsService.replaceBusinessHours(user.tenantId, id, body);
  }
}
