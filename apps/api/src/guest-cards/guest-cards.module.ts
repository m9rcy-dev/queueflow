import { Module } from "@nestjs/common";
import { LocationsModule } from "../locations/locations.module";
import { CodesModule } from "../codes/codes.module";
import { GuestCardsController } from "./guest-cards.controller";
import { GuestCardsService } from "./guest-cards.service";

@Module({
  imports: [LocationsModule, CodesModule],
  controllers: [GuestCardsController],
  providers: [GuestCardsService],
})
export class GuestCardsModule {}
