import { Module } from "@nestjs/common";
import { CodesModule } from "../codes/codes.module";
import { QueueEntriesModule } from "../queue-entries/queue-entries.module";
import { CustomersController } from "./customers.controller";
import { CustomersService } from "./customers.service";

@Module({
  imports: [CodesModule, QueueEntriesModule],
  controllers: [CustomersController],
  providers: [CustomersService],
  exports: [CustomersService],
})
export class CustomersModule {}
