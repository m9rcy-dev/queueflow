import { Global, Module } from "@nestjs/common";
import { QueueEventsService } from "./queue-events.service";

// Global: both QueueEntriesModule (emits) and the SSE controller (listens)
// need it, and it's stateless-except-for-the-emitter, so there's no reason
// to make every consumer import it explicitly.
@Global()
@Module({
  providers: [QueueEventsService],
  exports: [QueueEventsService],
})
export class QueueEventsModule {}
