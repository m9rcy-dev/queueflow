import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { APP_GUARD } from "@nestjs/core";
import { AuthModule } from "./auth/auth.module";
import { JwtAuthGuard } from "./auth/jwt-auth.guard";
import { RolesGuard } from "./auth/roles.guard";
import { HealthModule } from "./health/health.module";
import { LocationsModule } from "./locations/locations.module";
import { PrismaModule } from "./prisma/prisma.module";
import { ServicesModule } from "./services/services.module";
import { TenantsModule } from "./tenants/tenants.module";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    HealthModule,
    AuthModule,
    TenantsModule,
    LocationsModule,
    ServicesModule,
  ],
  providers: [
    // Every route is protected by default (AGENTS.md §2) — @Public() opts
    // out. RolesGuard runs after and is a no-op unless @Roles(...) is set.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
