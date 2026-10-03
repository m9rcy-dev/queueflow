import { Module } from "@nestjs/common";
import { NotificationsModule } from "../notifications/notifications.module";
import { QueuesModule } from "../queues/queues.module";
import { PublicQueueEntriesController } from "./public-queue-entries.controller";
import { QueueEntriesController } from "./queue-entries.controller";
import { QueueEntriesService } from "./queue-entries.service";
import { JoinPhoneThrottleGuard } from "./join-phone-throttle.guard";
import { TicketTokenThrottleGuard } from "./ticket-token-throttle.guard";

@Module({
  imports: [QueuesModule, NotificationsModule],
  controllers: [QueueEntriesController, PublicQueueEntriesController],
  // JoinPhoneThrottleGuard/TicketTokenThrottleGuard MUST be registered
  // providers, not just classes referenced via @UseGuards() — a class Nest
  // never saw as a provider gets instantiated fresh on every single
  // request instead of resolved as the module's singleton, silently
  // resetting each guard's in-memory counter every time (found the hard
  // way: the integration test for both limits passed every single request
  // with no persisted count at all, Phase 12's G-38 work).
  providers: [QueueEntriesService, JoinPhoneThrottleGuard, TicketTokenThrottleGuard],
  exports: [QueueEntriesService],
})
export class QueueEntriesModule {}
