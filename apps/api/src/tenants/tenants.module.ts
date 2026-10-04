import { Module } from "@nestjs/common";
import { MailModule } from "../mail/mail.module";
import { TenantsController } from "./tenants.controller";
import { TenantsService } from "./tenants.service";
import { TenantLogoController } from "./tenant-logo.controller";
import { TenantLogoService } from "./tenant-logo.service";

@Module({
  imports: [MailModule],
  controllers: [TenantsController, TenantLogoController],
  providers: [TenantsService, TenantLogoService],
})
export class TenantsModule {}
