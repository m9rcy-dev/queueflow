import { Controller, Get, NotFoundException, Param, Res } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Response } from "express";
import * as QRCode from "qrcode";
import { Public } from "../auth/public.decorator";
import { PrismaService } from "../prisma/prisma.service";
import { ticketUrl } from "../appointments/appointment-links";

/**
 * QR codes as images for emails (Phase 19) — email can't run the web app's
 * QR drawing, so the API draws them. Each is reached only through the
 * ticket's or booking's secret token (the same token as its own page link),
 * so an image reveals nothing the email's link didn't already.
 * - a ticket's QR opens the live ticket (as on the ticket page);
 * - a booking's QR is its check-in code, for the counter scanner — only
 *   while it can still be used.
 */
@Public()
@Controller("public")
export class QrImagesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  @Get("queue-entries/:token/qr.png")
  async ticket(@Param("token") token: string, @Res() res: Response): Promise<void> {
    const entry = await this.prisma.queueEntry.findUnique({
      where: { publicToken: token },
      select: { publicToken: true },
    });
    if (!entry) {
      throw new NotFoundException({ code: "QUEUE_ENTRY_NOT_FOUND", message: "Ticket not found." });
    }
    await sendPng(res, ticketUrl(this.config, entry.publicToken));
  }

  @Get("appointments/:token/check-in-qr.png")
  async checkIn(@Param("token") token: string, @Res() res: Response): Promise<void> {
    const appointment = await this.prisma.appointment.findUnique({
      where: { publicToken: token },
      select: { status: true, ticketCode: { select: { publicCode: true, active: true } } },
    });
    if (!appointment || appointment.status !== "BOOKED" || !appointment.ticketCode?.active) {
      throw new NotFoundException({
        code: "APPOINTMENT_NOT_FOUND",
        message: "No check-in code for this booking.",
      });
    }
    await sendPng(res, appointment.ticketCode.publicCode);
  }
}

async function sendPng(res: Response, data: string): Promise<void> {
  // Margin 4 is the QR standard's quiet zone; 480px stays sharp at 240px on high-density screens.
  const png = await QRCode.toBuffer(data, { type: "png", margin: 4, width: 480 });
  res
    .set({
      "Content-Type": "image/png",
      // Email clients and their image proxies fetch these; nothing to cache for long.
      "Cache-Control": "private, max-age=300",
      "Cross-Origin-Resource-Policy": "cross-origin",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    })
    .send(png);
}
