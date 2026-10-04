import { Global, Module } from "@nestjs/common";
import { LocationAccessService } from "./location-access.service";

/** Global, like PrismaModule — nearly every staff-facing controller needs it (ADR-015). */
@Global()
@Module({
  providers: [LocationAccessService],
  exports: [LocationAccessService],
})
export class LocationAccessModule {}
