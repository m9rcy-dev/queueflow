import { Module } from "@nestjs/common";
import { LocationsModule } from "../locations/locations.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { QueueEntriesModule } from "../queue-entries/queue-entries.module";
import { AppointmentJobsService } from "./appointment-jobs.service";
import { AppointmentsController } from "./appointments.controller";
import { AppointmentsService } from "./appointments.service";
import { PublicAppointmentsController } from "./public-appointments.controller";

@Module({
  imports: [LocationsModule, NotificationsModule, QueueEntriesModule],
  controllers: [AppointmentsController, PublicAppointmentsController],
  providers: [AppointmentsService, AppointmentJobsService],
  exports: [AppointmentsService, AppointmentJobsService],
})
export class AppointmentsModule {}
