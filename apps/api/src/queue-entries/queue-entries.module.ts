import { Module } from "@nestjs/common";
import { QueuesModule } from "../queues/queues.module";
import { PublicQueueEntriesController } from "./public-queue-entries.controller";
import { QueueEntriesController } from "./queue-entries.controller";
import { QueueEntriesService } from "./queue-entries.service";

@Module({
  imports: [QueuesModule],
  controllers: [QueueEntriesController, PublicQueueEntriesController],
  providers: [QueueEntriesService],
})
export class QueueEntriesModule {}
