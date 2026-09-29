import { Module } from "@nestjs/common";
import { NotificationsModule } from "../notifications/notifications.module";
import { QueuesModule } from "../queues/queues.module";
import { PublicQueueEntriesController } from "./public-queue-entries.controller";
import { QueueEntriesController } from "./queue-entries.controller";
import { QueueEntriesService } from "./queue-entries.service";

@Module({
  imports: [QueuesModule, NotificationsModule],
  controllers: [QueueEntriesController, PublicQueueEntriesController],
  providers: [QueueEntriesService],
  exports: [QueueEntriesService],
})
export class QueueEntriesModule {}
