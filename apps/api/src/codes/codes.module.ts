import { Module } from "@nestjs/common";
import { QueuesModule } from "../queues/queues.module";
import { PublicCodesController, QueueCodesController } from "./codes.controller";
import { CodesService } from "./codes.service";

@Module({
  imports: [QueuesModule],
  controllers: [QueueCodesController, PublicCodesController],
  providers: [CodesService],
})
export class CodesModule {}
