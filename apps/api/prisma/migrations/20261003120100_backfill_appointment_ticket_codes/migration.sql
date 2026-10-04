-- Phase 14 (D-12): every appointment gets an APPOINTMENT_TICKET code at
-- booking time from now on; this mints one for each appointment booked
-- before that (Phase 13). Separate from the migration that adds the enum
-- value, because Postgres won't use a new enum value inside the
-- transaction that created it.
--
-- publicCode: two gen_random_uuid() values (Postgres 13+ built-in, 122
-- random bits each) with dashes stripped — 64 hex chars, comfortably over
-- G-39's 128-bit floor, same strength class as generateSecurePublicToken.
INSERT INTO "codes" ("id", "tenantId", "publicCode", "contextType", "appointmentId", "active", "createdAt", "updatedAt")
SELECT
  gen_random_uuid()::text,
  a."tenantId",
  replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  'APPOINTMENT_TICKET',
  a."id",
  true,
  NOW(),
  NOW()
FROM "appointments" a
WHERE NOT EXISTS (SELECT 1 FROM "codes" c WHERE c."appointmentId" = a."id");
