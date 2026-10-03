import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import {
  availabilityQuerySchema,
  bookAppointmentSchema,
  type AvailabilityQuery,
  type BookAppointmentInput,
} from "@queueflow/validation";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { Public } from "../auth/public.decorator";
import { AppointmentsService } from "./appointments.service";

/**
 * The anonymous booking path (plan §35) — reached from a QUEUE code's
 * landing page, which supplies the locationId. Booking gets the same
 * per-IP cap as a queue join (G-38: 20/hour); reads ride the global
 * default throttle.
 */
@Controller("public")
@Public()
export class PublicAppointmentsController {
  constructor(private readonly appointmentsService: AppointmentsService) {}

  @Get("locations/:locationId/appointment-availability")
  availability(
    @Param("locationId") locationId: string,
    @Query(new ZodValidationPipe(availabilityQuerySchema)) query: AvailabilityQuery,
  ) {
    return this.appointmentsService.getAvailability(locationId, query.serviceId, query.date);
  }

  @Throttle({ default: { limit: 20, ttl: 3_600_000 } })
  @Post("locations/:locationId/appointments")
  book(
    @Param("locationId") locationId: string,
    @Body(new ZodValidationPipe(bookAppointmentSchema)) body: BookAppointmentInput,
  ) {
    return this.appointmentsService.book(locationId, body);
  }

  @Get("appointments/:token")
  get(@Param("token") token: string) {
    return this.appointmentsService.getByPublicToken(token);
  }

  @Post("appointments/:token/cancel")
  cancel(@Param("token") token: string) {
    return this.appointmentsService.cancelByPublicToken(token);
  }
}
