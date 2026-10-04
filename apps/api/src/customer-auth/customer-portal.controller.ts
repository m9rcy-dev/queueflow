import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from "@nestjs/common";
import { confirmAuthenticatorSchema, type ConfirmAuthenticatorInput } from "@queueflow/validation";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { AuthenticatorService } from "../authenticator/authenticator.service";
import { CustomerAuthService } from "./customer-auth.service";
import { Public } from "../auth/public.decorator";
import { AppointmentsService } from "../appointments/appointments.service";
import { CustomersService } from "../customers/customers.service";
import { CurrentCustomer } from "./current-customer.decorator";
import { CustomerJwtAuthGuard } from "./customer-jwt-auth.guard";
import type { CustomerRequestUser } from "./customer-request-user.interface";

/**
 * The customer's own portal (Phase 9, G-55) — @Public() opts out of the
 * global staff JwtAuthGuard (which would otherwise reject a customer token
 * outright, since it has no TenantUser membership), and CustomerJwtAuthGuard
 * is applied locally instead: still authenticated, just under a completely
 * separate credential from staff.
 */
@Controller("customers/me")
@Public()
@UseGuards(CustomerJwtAuthGuard)
export class CustomerPortalController {
  constructor(
    private readonly customersService: CustomersService,
    private readonly appointmentsService: AppointmentsService,
    private readonly customerAuthService: CustomerAuthService,
    private readonly authenticator: AuthenticatorService,
  ) {}

  @Get()
  me(@CurrentCustomer() customer: CustomerRequestUser) {
    return this.customersService.getPortalSummary(customer.tenantId, customer.customerId);
  }

  @Get("identity-code")
  async identityCode(@CurrentCustomer() customer: CustomerRequestUser) {
    const publicCode = await this.customersService.getIdentityCode(
      customer.tenantId,
      customer.customerId,
    );
    return { publicCode };
  }

  /** Rotation for a lost/leaked identity code (same precedent as DISPLAY, G-07). */
  @Post("identity-code/regenerate")
  async regenerateIdentityCode(@CurrentCustomer() customer: CustomerRequestUser) {
    const publicCode = await this.customersService.regenerateIdentityCode(
      customer.tenantId,
      customer.customerId,
    );
    return { publicCode };
  }

  @Get("active-entry")
  @HttpCode(HttpStatus.OK)
  activeEntry(@CurrentCustomer() customer: CustomerRequestUser) {
    return this.customersService.getActiveEntry(customer.tenantId, customer.customerId);
  }

  /** Upcoming bookings (Phase 13) — any appointment booked with this customer's phone, whether booked signed-in or not. */
  @Get("appointments")
  appointments(@CurrentCustomer() customer: CustomerRequestUser) {
    return this.appointmentsService.listUpcomingForCustomer(customer.tenantId, customer.customerId);
  }

  // --- Authenticator app login (Phase 15, ADR-014) ---

  @Get("authenticator")
  authenticatorStatus(@CurrentCustomer() customer: CustomerRequestUser) {
    return this.authenticator.getStatus({ customerId: customer.customerId });
  }

  @Post("authenticator/setup")
  beginAuthenticatorSetup(@CurrentCustomer() customer: CustomerRequestUser) {
    return this.customerAuthService.beginAuthenticatorSetup(customer.customerId);
  }

  @Post("authenticator/confirm")
  confirmAuthenticator(
    @CurrentCustomer() customer: CustomerRequestUser,
    @Body(new ZodValidationPipe(confirmAuthenticatorSchema)) body: ConfirmAuthenticatorInput,
  ) {
    return this.authenticator.confirmSetup({ customerId: customer.customerId }, body.code);
  }

  @Delete("authenticator")
  disableAuthenticator(@CurrentCustomer() customer: CustomerRequestUser) {
    return this.authenticator.disable({ customerId: customer.customerId });
  }
}
