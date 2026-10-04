import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import {
  clockInSchema,
  hoursReportQuerySchema,
  updateShiftSchema,
  type ClockInInput,
  type HoursReportQuery,
  type UpdateShiftInput,
} from "@queueflow/validation";
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

  /** Phase 19 — the hours report (scoped by role in the service). */
  @Get("shifts")
  report(
    @CurrentUser() user: RequestUser,
    @Query(new ZodValidationPipe(hoursReportQuerySchema)) query: HoursReportQuery,
  ) {
    return this.shifts.report(user, query);
  }

  /** Phase 19 — correct a shift's times (owner/admin, or a Manager at their location; never your own). */
  @Patch("shifts/:id")
  @HttpCode(HttpStatus.NO_CONTENT)
  async update(
    @CurrentUser() user: RequestUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateShiftSchema)) body: UpdateShiftInput,
  ): Promise<void> {
    await this.shifts.update(user, id, body);
  }

  @Get("locations/:locationId/on-shift")
  onShift(@CurrentUser() user: RequestUser, @Param("locationId") locationId: string) {
    this.access.assertLocation(user, locationId);
    return this.shifts.onShift(locationId);
  }
}
