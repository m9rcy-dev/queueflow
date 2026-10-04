import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import {
  appointmentCalendarQuerySchema,
  appointmentDayQuerySchema,
  bookAppointmentSchema,
  createClosureSchema,
  listClosuresQuerySchema,
  staffCancelAppointmentSchema,
  staffCheckInSchema,
  updateAppointmentSettingsSchema,
  type AppointmentCalendarQuery,
  type AppointmentDayQuery,
  type BookAppointmentInput,
  type CreateClosureInput,
  type ListClosuresQuery,
  type StaffCancelAppointmentInput,
  type StaffCheckInInput,
  type UpdateAppointmentSettingsInput,
} from "@queueflow/validation";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { CurrentUser } from "../auth/current-user.decorator";
import { Roles } from "../auth/roles.decorator";
import type { RequestUser } from "../auth/request-user.interface";
import { LocationsService } from "../locations/locations.service";
import { QueueEntriesService } from "../queue-entries/queue-entries.service";
import { AppointmentsService } from "./appointments.service";
import { LocationAccessService } from "../access/location-access.service";

/**
 * Staff side of the appointment engine (Phase 13). Configuration (settings,
 * closures) is owner/admin only, like business hours; the calendar,
 * booking on a customer's behalf, and cancelling are open to every staff
 * member, since running the day's bookings is front-desk work.
 */
@Controller("tenants/me")
export class AppointmentsController {
  constructor(
    private readonly appointmentsService: AppointmentsService,
    private readonly locationsService: LocationsService,
    private readonly queueEntriesService: QueueEntriesService,
    private readonly access: LocationAccessService,
  ) {}

  @Get("appointment-settings")
  getSettings(@CurrentUser() user: RequestUser) {
    return this.appointmentsService.getSettings(user.tenantId);
  }

  @Patch("appointment-settings")
  @Roles("TENANT_OWNER", "TENANT_ADMIN")
  updateSettings(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(updateAppointmentSettingsSchema))
    body: UpdateAppointmentSettingsInput,
  ) {
    return this.appointmentsService.updateSettings(user.tenantId, body);
  }

  @Get("locations/:locationId/closures")
  listClosures(
    @CurrentUser() user: RequestUser,
    @Param("locationId") locationId: string,
    @Query(new ZodValidationPipe(listClosuresQuerySchema)) query: ListClosuresQuery,
  ) {
    this.access.assertLocation(user, locationId);
    return this.appointmentsService.listClosures(user.tenantId, locationId, query.from);
  }

  @Post("locations/:locationId/closures")
  @Roles("TENANT_OWNER", "TENANT_ADMIN")
  createClosure(
    @CurrentUser() user: RequestUser,
    @Param("locationId") locationId: string,
    @Body(new ZodValidationPipe(createClosureSchema)) body: CreateClosureInput,
  ) {
    this.access.assertLocation(user, locationId);
    return this.appointmentsService.createClosure(user.tenantId, locationId, body);
  }

  @Delete("locations/:locationId/closures/:closureId")
  @Roles("TENANT_OWNER", "TENANT_ADMIN")
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteClosure(
    @CurrentUser() user: RequestUser,
    @Param("locationId") locationId: string,
    @Param("closureId") closureId: string,
  ): Promise<void> {
    this.access.assertLocation(user, locationId);
    await this.appointmentsService.deleteClosure(user.tenantId, locationId, closureId);
  }

  @Get("locations/:locationId/appointments/calendar")
  calendar(
    @CurrentUser() user: RequestUser,
    @Param("locationId") locationId: string,
    @Query(new ZodValidationPipe(appointmentCalendarQuerySchema)) query: AppointmentCalendarQuery,
  ) {
    this.access.assertLocation(user, locationId);
    return this.appointmentsService.getCalendar(user.tenantId, locationId, query.month);
  }

  @Get("locations/:locationId/appointments")
  listDay(
    @CurrentUser() user: RequestUser,
    @Param("locationId") locationId: string,
    @Query(new ZodValidationPipe(appointmentDayQuerySchema)) query: AppointmentDayQuery,
  ) {
    this.access.assertLocation(user, locationId);
    return this.appointmentsService.listDay(user.tenantId, locationId, query.date);
  }

  /** A phone booking — same slot rules as the public path, recorded as staff-booked. */
  @Post("locations/:locationId/appointments")
  async book(
    @CurrentUser() user: RequestUser,
    @Param("locationId") locationId: string,
    @Body(new ZodValidationPipe(bookAppointmentSchema)) body: BookAppointmentInput,
  ) {
    this.access.assertLocation(user, locationId);
    await this.locationsService.findOwnedLocation(user.tenantId, locationId);
    return this.appointmentsService.book(locationId, body, user.tenantUserId);
  }

  @Post("appointments/:id/cancel")
  async cancel(
    @CurrentUser() user: RequestUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(staffCancelAppointmentSchema)) body: StaffCancelAppointmentInput,
  ) {
    await this.access.assertAppointment(user, id);
    return this.appointmentsService.cancelByStaff(user.tenantId, user.tenantUserId, id, body);
  }

  /** Phase 14 — check a booked customer in from the day list; they join the queue (§36). */
  @Post("appointments/:id/check-in")
  async checkIn(
    @CurrentUser() user: RequestUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(staffCheckInSchema)) body: StaffCheckInInput,
  ) {
    await this.access.assertAppointment(user, id);
    return this.queueEntriesService.checkInAppointmentByStaff(user.tenantId, id, body.queueId);
  }

  /** Undo a no-show, same day only (ADR-013). */
  @Post("appointments/:id/restore")
  async restore(@CurrentUser() user: RequestUser, @Param("id") id: string) {
    await this.access.assertAppointment(user, id);
    return this.appointmentsService.restoreNoShow(user.tenantId, id);
  }
}
