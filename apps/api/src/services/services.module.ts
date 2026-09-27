import { Module } from "@nestjs/common";
import { LocationsModule } from "../locations/locations.module";
import { ServicesController } from "./services.controller";
import { ServicesService } from "./services.service";

@Module({
  imports: [LocationsModule],
  controllers: [ServicesController],
  providers: [ServicesService],
})
export class ServicesModule {}
