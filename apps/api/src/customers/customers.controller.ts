import { Body, Controller, Post } from "@nestjs/common";
import { staffCreateCustomerSchema, type StaffCreateCustomerInput } from "@queueflow/validation";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { CurrentUser } from "../auth/current-user.decorator";
import type { RequestUser } from "../auth/request-user.interface";
import { CustomersService } from "./customers.service";

/** Staff-initiated in-person signup (Phase 9, G-56) — any authenticated staff member, same access level as adding a walk-in (queue-entries.controller.ts's addWalkIn). */
@Controller("tenants/me/customers")
export class CustomersController {
  constructor(private readonly customersService: CustomersService) {}

  @Post()
  create(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(staffCreateCustomerSchema)) body: StaffCreateCustomerInput,
  ) {
    return this.customersService.createByStaff(user.tenantId, body);
  }
}
