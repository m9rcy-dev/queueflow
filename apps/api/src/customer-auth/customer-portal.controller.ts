import { Controller, Get, HttpCode, HttpStatus, Post, UseGuards } from "@nestjs/common";
import { Public } from "../auth/public.decorator";
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
  constructor(private readonly customersService: CustomersService) {}

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
}
