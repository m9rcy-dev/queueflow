import { Body, Controller, Get, Param, Put } from "@nestjs/common";
import { resizeGuestCardPoolSchema, type ResizeGuestCardPoolInput } from "@queueflow/validation";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { CurrentUser } from "../auth/current-user.decorator";
import { Roles } from "../auth/roles.decorator";
import type { RequestUser } from "../auth/request-user.interface";
import { GuestCardsService } from "./guest-cards.service";

/** A location's guest-card pool admin (Phase 10, D-14). */
@Controller("tenants/me/locations/:locationId/guest-cards")
export class GuestCardsController {
  constructor(private readonly guestCardsService: GuestCardsService) {}

  @Get()
  list(@CurrentUser() user: RequestUser, @Param("locationId") locationId: string) {
    return this.guestCardsService.list(user.tenantId, locationId);
  }

  @Put()
  @Roles("TENANT_OWNER", "TENANT_ADMIN")
  resize(
    @CurrentUser() user: RequestUser,
    @Param("locationId") locationId: string,
    @Body(new ZodValidationPipe(resizeGuestCardPoolSchema)) body: ResizeGuestCardPoolInput,
  ) {
    return this.guestCardsService.resize(user.tenantId, locationId, body.poolSize);
  }
}
