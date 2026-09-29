import { Module } from "@nestjs/common";
import { QueuesModule } from "../queues/queues.module";
import {
  PublicCodesController,
  QueueCodesController,
  TenantCodesController,
} from "./codes.controller";
import { CodesService } from "./codes.service";

@Module({
  imports: [QueuesModule],
  controllers: [QueueCodesController, TenantCodesController, PublicCodesController],
  providers: [CodesService],
  exports: [CodesService],
})
export class CodesModule {}
