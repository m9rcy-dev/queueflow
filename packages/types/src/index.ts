/**
 * Shared domain types, consumed by both apps/api and apps/web via the
 * compiled dist output (not raw source — see AGENTS.md §6 on why build runs
 * first in the quality gate).
 *
 * Phase 0 ships this empty on purpose. Phase 1 adds Tenant/TenantUser/
 * AuthenticatedUser types alongside the Prisma schema they mirror.
 */
export {};
