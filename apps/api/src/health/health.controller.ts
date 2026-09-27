import { Controller, Get } from "@nestjs/common";

/**
 * Liveness/readiness endpoint for Phase 0's acceptance criteria ("API health
 * endpoint works"). Deliberately dependency-free for now — once Prisma has
 * real models (Phase 1+), extend this to verify a DB round-trip rather than
 * just process liveness.
 */
@Controller("health")
export class HealthController {
  @Get()
  check(): { status: "ok"; timestamp: string } {
    return { status: "ok", timestamp: new Date().toISOString() };
  }
}
