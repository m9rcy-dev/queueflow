import { Module } from "@nestjs/common";
import { MockNotificationProvider } from "./mock-notification.provider";
import { NotificationProvider } from "./notification-provider";
import { NotificationsService } from "./notifications.service";

@Module({
  providers: [
    NotificationsService,
    { provide: NotificationProvider, useClass: MockNotificationProvider },
  ],
  exports: [NotificationsService],
})
export class NotificationsModule {}
