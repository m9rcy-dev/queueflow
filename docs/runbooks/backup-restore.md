# Backup & Restore

**Last performed:** 2026-10-03, against the local dev database (real data accumulated across
every phase's manual verification — 6 tenants, 7 customers, 8 queue entries, 29 codes, 6 users).
Satisfies Phase 12's acceptance criterion ("a restore has actually been performed once") — this
is a record of a real exercise, not a design document.

## Why `pg_dump`/`pg_restore`, not a managed snapshot

G-41's resolution punts hosting-level specifics to the actual provider (Render/Vercel, ADR-009),
which isn't provisioned yet. `pg_dump -F c` (custom format) + `pg_restore` is the portable,
provider-agnostic mechanism underneath whatever a managed provider's "automated backups" button
ends up calling — proving this cycle works end to end is the part that doesn't change once a real
host is chosen; only the scheduling/retention wrapper around it does.

## Procedure

Dump, restore into a **separate, newly-created database** (never the live one), verify, tear
down. Restoring into a fresh target instead of overwriting the original proves the same thing a
destructive drop-and-restore would, without the risk — there is no scenario where you'd want to
test this against data you can't afford to lose.

```bash
# 1. Dump the live database (custom format — required by pg_restore, not a plain .sql file)
docker exec queueflow-postgres-1 pg_dump -U queueflow -d queueflow -F c -f /tmp/queueflow_backup.dump
docker cp queueflow-postgres-1:/tmp/queueflow_backup.dump ./queueflow_backup.dump

# 2. Create a fresh, separate target database on the same Postgres instance
docker exec queueflow-postgres-1 psql -U queueflow -d postgres \
  -c "CREATE DATABASE queueflow_restore_test OWNER queueflow;"

# 3. Restore into it
docker exec queueflow-postgres-1 pg_restore -U queueflow -d queueflow_restore_test \
  --no-owner /tmp/queueflow_backup.dump

# 4. Verify — row counts must match the source exactly
docker exec queueflow-postgres-1 psql -U queueflow -d queueflow -c "SELECT count(*) FROM tenants;"
docker exec queueflow-postgres-1 psql -U queueflow -d queueflow_restore_test -c "SELECT count(*) FROM tenants;"

# 5. Verify the restored DB is actually usable, not just populated — Prisma must recognize it
#    as schema-consistent, and there must be no FK rot from a partial restore
DATABASE_URL="postgresql://queueflow:queueflow@localhost:5432/queueflow_restore_test?schema=public" \
  npx prisma migrate status   # run from apps/api

# 6. Tear down the test target — never leave it lying around
docker exec queueflow-postgres-1 psql -U queueflow -d postgres -c "DROP DATABASE queueflow_restore_test;"
```

## What was actually verified on 2026-10-03

- Dump succeeded (68KB, custom format), restore into `queueflow_restore_test` completed with zero
  errors.
- Row counts matched exactly across every table checked (`tenants`, `customers`, `queue_entries`,
  `codes`, `users`) — source and restored target identical.
- A spot-checked row (`tenants` table, oldest row) came back byte-identical between source and
  restored target.
- `npx prisma migrate status` against the restored database reported "Database schema is up to
  date!" — the restore didn't just move bytes, it produced a database Prisma itself considers
  fully consistent with the current schema (10 migrations).
- Zero dangling foreign keys: every `queue_entries.customerId` in the restored database resolves
  to a real row in `customers`.

## Known gaps (not yet real, flagged honestly rather than silently assumed solved)

- **No scheduled/automated backup job exists yet.** This procedure is manual, run on demand. A
  real pilot business needs this on a cron (daily, at minimum) with the dump pushed somewhere
  durable — not left on the same disk as the database it's backing up. Not built: there is no
  hosting provider chosen yet (ADR-009 leaves this open) to decide _where_ that dump lands, and
  building the scheduling machinery before that's settled would likely need redoing.
- **This was exercised against dev data, not a copy of real pilot-business data**, since there is
  no real pilot business yet. The mechanism is proven; re-run this exact procedure once real data
  exists, before calling backup/restore itself "pilot-ready."
- **No retention policy for backups themselves** (distinct from G-37's 90-day _customer PII_
  retention) — how many backups to keep, for how long, is a decision for whenever the hosting
  provider is chosen, since most providers' managed backup features already have an opinion on
  this that's simpler to adopt than to re-decide independently.
