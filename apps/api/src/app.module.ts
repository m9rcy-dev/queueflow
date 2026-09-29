import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { APP_GUARD } from "@nestjs/core";
import { ThrottlerModule } from "@nestjs/throttler";
import { AuthModule } from "./auth/auth.module";
import { JwtAuthGuard } from "./auth/jwt-auth.guard";
import { RolesGuard } from "./auth/roles.guard";
import { AppThrottlerGuard } from "./common/app-throttler.guard";
import { CodesModule } from "./codes/codes.module";
import { CustomerAuthModule } from "./customer-auth/customer-auth.module";
import { CustomersModule } from "./customers/customers.module";
import { DisplaysModule } from "./displays/displays.module";
import { HealthModule } from "./health/health.module";
import { LocationsModule } from "./locations/locations.module";
import { PrismaModule } from "./prisma/prisma.module";
import { QueueEntriesModule } from "./queue-entries/queue-entries.module";
import { QueueEventsModule } from "./queue-events/queue-events.module";
import { QueuesModule } from "./queues/queues.module";
import { ServicesModule } from "./services/services.module";
import { TenantsModule } from "./tenants/tenants.module";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    // In-memory throttling (single instance, D-06) — a generous default
    // baseline for authenticated routes, overridden per-route with
    // @Throttle(...) where a tighter limit actually matters (the public
    // join endpoint, G-40). Redis-backed storage is the documented swap
    // for whenever a second instance exists (ADR-002/ADR-007).
    ThrottlerModule.forRoot([{ name: "default", ttl: 60_000, limit: 100 }]),
    PrismaModule,
    QueueEventsModule,
    HealthModule,
    AuthModule,
    TenantsModule,
    LocationsModule,
    ServicesModule,
    QueuesModule,
    QueueEntriesModule,
    CodesModule,
    DisplaysModule,
    CustomersModule,
    CustomerAuthModule,
  ],
  providers: [
    // Every route is protected by default (AGENTS.md §2) — @Public() opts
    // out. RolesGuard runs after and is a no-op unless @Roles(...) is set.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: AppThrottlerGuard },
  ],
})
export class AppModule {}
