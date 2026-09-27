import { SetMetadata } from "@nestjs/common";

export const IS_PUBLIC_KEY = "isPublic";

/**
 * Opts a route out of the global JwtAuthGuard (AGENTS.md §2 — every route
 * protected by default). Use sparingly and deliberately: signup, login,
 * invite-accept, and health are the expected uses in Phase 1.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
