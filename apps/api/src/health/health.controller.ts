import { Controller, Get, Req, ServiceUnavailableException } from "@nestjs/common";
import type { Request } from "express";
import { Public } from "../auth/public.decorator";
import { PrismaService } from "../prisma/prisma.service";

/**
 * Health check — Render polls it, and only routes traffic to (and keeps) an
 * instance that answers 200. Phase 20: it also asks the database, so a new
 * deploy that can't reach Postgres never goes live. @Public(): no
 * credentials needed.
 */
@Controller("health")
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Get()
  async check(): Promise<{ status: "ok"; timestamp: string }> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      throw new ServiceUnavailableException({
        code: "DATABASE_UNAVAILABLE",
        message: "Database unavailable.",
      });
    }
    return { status: "ok", timestamp: new Date().toISOString() };
  }

  /**
   * The caller's IP as the API sees it (Phase 20) — for checking after a
   * deploy that rate limits see each visitor, not the proxy (TRUST_PROXY_HOPS).
   * Only ever echoes the caller's own address back to them.
   */
  @Public()
  @Get("ip")
  ip(@Req() req: Request): { ip: string | undefined } {
    return { ip: req.ip };
  }
}
