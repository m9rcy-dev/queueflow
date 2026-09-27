import { Module } from "@nestjs/common";
import { LocationsModule } from "../locations/locations.module";
import { QueuesController } from "./queues.controller";
import { QueuesService } from "./queues.service";

@Module({
  imports: [LocationsModule],
  controllers: [QueuesController],
  providers: [QueuesService],
  exports: [QueuesService],
})
export class QueuesModule {}
