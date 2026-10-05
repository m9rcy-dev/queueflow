import { Module } from "@nestjs/common";
import { QrImagesController } from "./qr-images.controller";

@Module({ controllers: [QrImagesController] })
export class QrImagesModule {}
