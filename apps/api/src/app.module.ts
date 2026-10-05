import { type MiddlewareConsumer, Module, type NestModule, RequestMethod } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { APP_GUARD } from "@nestjs/core";
import { ScheduleModule } from "@nestjs/schedule";
import { ThrottlerModule } from "@nestjs/throttler";
import { LocationAccessModule } from "./access/location-access.module";
import { AppointmentsModule } from "./appointments/appointments.module";
import { AuthModule } from "./auth/auth.module";
import { JwtAuthGuard } from "./auth/jwt-auth.guard";
import { RolesGuard } from "./auth/roles.guard";
import { AppThrottlerGuard } from "./common/app-throttler.guard";
import { CommonModule } from "./common/common.module";
import { CodesModule } from "./codes/codes.module";
import { CustomerAuthModule } from "./customer-auth/customer-auth.module";
import { CustomersModule } from "./customers/customers.module";
import { DisplaysModule } from "./displays/displays.module";
import { GuestCardsModule } from "./guest-cards/guest-cards.module";
import { HealthModule } from "./health/health.module";
import { LocationsModule } from "./locations/locations.module";
import { PrismaModule } from "./prisma/prisma.module";
import { QueueEntriesModule } from "./queue-entries/queue-entries.module";
import { QueueEventsModule } from "./queue-events/queue-events.module";
import { QueuesModule } from "./queues/queues.module";
import { RetentionModule } from "./retention/retention.module";
import { ServicesModule } from "./services/services.module";
import { TenantsModule } from "./tenants/tenants.module";
import { ShiftsModule } from "./shifts/shifts.module";
import { PlatformModule } from "./platform/platform.module";
import { QrImagesModule } from "./qr-images/qr-images.module";
import { RawImageBodyMiddleware } from "./tenants/raw-image-body.middleware";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    // In-memory throttling (single instance, D-06) — a generous default
    // baseline for authenticated routes, overridden per-route with
    // @Throttle(...) where G-38's concrete numbers call for something
    // tighter (join, auth). Phone-/token-keyed limits (also G-38) and
    // SSE's concurrent-connections-per-IP cap live outside this module
    // entirely, in CommonModule/JoinPhoneThrottleGuard/
    // TicketTokenThrottleGuard — @nestjs/throttler only tracks by IP.
    // Redis-backed storage is the documented swap for whenever a second
    // instance exists (ADR-002/ADR-007).
    ThrottlerModule.forRoot([{ name: "default", ttl: 60_000, limit: 100 }]),
    PrismaModule,
    CommonModule,
    LocationAccessModule,
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
    GuestCardsModule,
    AppointmentsModule,
    ShiftsModule,
    PlatformModule,
    QrImagesModule,
    RetentionModule,
  ],
  providers: [
    // Every route is protected by default (AGENTS.md §2) — @Public() opts
    // out. RolesGuard runs after and is a no-op unless @Roles(...) is set.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: AppThrottlerGuard },
  ],
})
export class AppModule implements NestModule {
  /** The logo upload is a raw image body, not JSON (Phase 16). */
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(RawImageBodyMiddleware)
      .forRoutes({ path: "tenants/me/logo", method: RequestMethod.PUT });
  }
}
