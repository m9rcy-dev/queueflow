import { Module } from "@nestjs/common";
import { MailModule } from "../mail/mail.module";
import { TenantsController } from "./tenants.controller";
import { TenantsService } from "./tenants.service";

@Module({
  imports: [MailModule],
  controllers: [TenantsController],
  providers: [TenantsService],
})
export class TenantsModule {}
