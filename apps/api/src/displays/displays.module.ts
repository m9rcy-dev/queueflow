import { Module } from "@nestjs/common";
import { DisplaysController } from "./displays.controller";
import { DisplaysService } from "./displays.service";

@Module({
  controllers: [DisplaysController],
  providers: [DisplaysService],
})
export class DisplaysModule {}
