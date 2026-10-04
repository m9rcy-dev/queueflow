import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post } from "@nestjs/common";
import { clockInSchema, type ClockInInput } from "@queueflow/validation";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { CurrentUser } from "../auth/current-user.decorator";
import type { RequestUser } from "../auth/request-user.interface";
import { LocationAccessService } from "../access/location-access.service";
import { ShiftsService } from "./shifts.service";

/** Clock in / clock out and who's on shift (Phase 18, ADR-017) — every member, for themselves. */
@Controller("tenants/me")
export class ShiftsController {
  constructor(
    private readonly shifts: ShiftsService,
    private readonly access: LocationAccessService,
  ) {}

  @Get("shifts/me")
  async mine(@CurrentUser() user: RequestUser) {
    return { shift: await this.shifts.current(user) };
  }

  @Post("shifts/clock-in")
  clockIn(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(clockInSchema)) body: ClockInInput,
  ) {
    return this.shifts.clockIn(user, body.locationId);
  }

  @Post("shifts/clock-out")
  @HttpCode(HttpStatus.NO_CONTENT)
  async clockOut(@CurrentUser() user: RequestUser): Promise<void> {
    await this.shifts.clockOut(user);
  }

  @Get("locations/:locationId/on-shift")
  onShift(@CurrentUser() user: RequestUser, @Param("locationId") locationId: string) {
    this.access.assertLocation(user, locationId);
    return this.shifts.onShift(locationId);
  }
}
