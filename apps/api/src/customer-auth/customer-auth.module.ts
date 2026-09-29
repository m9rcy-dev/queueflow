import { Module } from "@nestjs/common";
import { PassportModule } from "@nestjs/passport";
import { AuthModule } from "../auth/auth.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { CustomersModule } from "../customers/customers.module";
import { CustomerAuthController } from "./customer-auth.controller";
import { CustomerAuthService } from "./customer-auth.service";
import { CustomerJwtStrategy } from "./customer-jwt.strategy";
import { CustomerJwtAuthGuard } from "./customer-jwt-auth.guard";
import { CustomerPortalController } from "./customer-portal.controller";

/**
 * Customer-facing auth + portal (Phase 9, D-09) — the portal controller
 * lives here rather than in CustomersModule specifically because it needs
 * CustomerJwtAuthGuard, which is a customer-auth concern; this keeps the
 * dependency one-directional (this module depends on CustomersModule for
 * CustomersService, never the reverse).
 */
@Module({
  imports: [PassportModule, AuthModule, NotificationsModule, CustomersModule],
  controllers: [CustomerAuthController, CustomerPortalController],
  providers: [CustomerAuthService, CustomerJwtStrategy, CustomerJwtAuthGuard],
})
export class CustomerAuthModule {}
