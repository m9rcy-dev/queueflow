import { Controller, Get } from "@nestjs/common";
import { Public } from "../auth/public.decorator";

/**
 * Liveness/readiness endpoint for Phase 0's acceptance criteria ("API health
 * endpoint works"). Deliberately dependency-free for now — once Prisma has
 * real models (Phase 1+), extend this to verify a DB round-trip rather than
 * just process liveness. @Public() since a health check must work with no
 * credentials at all, now that Phase 1 protects every route by default.
 */
@Controller("health")
export class HealthController {
  @Public()
  @Get()
  check(): { status: "ok"; timestamp: string } {
    return { status: "ok", timestamp: new Date().toISOString() };
  }
}
