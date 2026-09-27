# QueueFlow

A multi-tenant digital queue and appointment platform — replacing physical queue numbers with
QR-based digital queues, appointment check-in, and live public displays.

**Start here:** [`AGENTS.md`](./AGENTS.md) — canonical instructions for any AI coding session or
developer working on this repo. Read it before making changes.

## Documentation map

- [`docs/QueueFlow_Detailed_Plan.md`](./docs/QueueFlow_Detailed_Plan.md) — the frozen product/architecture baseline.
- [`docs/QueueFlow_Visual_Prototype_and_Screen_Flows.md`](./docs/QueueFlow_Visual_Prototype_and_Screen_Flows.md) — visual direction.
- [`docs/plan-review.md`](./docs/plan-review.md) — the **living decisions log**. Every gap, contradiction,
  and open question from the plan review, with resolutions. This overrides the plan document where
  they conflict.
- [`docs/adr/`](./docs/adr/) — formal Architecture Decision Records for the major choices.
- [`PROJECT_STATUS.md`](./PROJECT_STATUS.md) — current phase, current task, known issues. Read this every session.

## Stack

NestJS + Prisma + PostgreSQL (API), Next.js (web), pnpm workspaces. Redis (Upstash) for realtime
fan-out and rate limiting. See ADR-001 through ADR-010 for why.

## Local development

```bash
cp .env.example .env          # then fill in real values where noted
docker compose up -d          # local Postgres + Redis
pnpm install
pnpm --filter @queueflow/api run db:migrate
pnpm dev                      # starts both apps/api and apps/web
```

- API: http://localhost:4001 (health check at `/health`)
- Web: http://localhost:4000

## Quality gate

```bash
pnpm quality
# = build && format:check && lint && typecheck && test && test:integration
```

Must pass before any task is considered done — see `AGENTS.md` §6–7.

## Repository structure

```text
queueflow/
├── apps/
│   ├── api/       NestJS + Prisma
│   └── web/       Next.js
├── packages/
│   ├── types/         shared TS types
│   ├── validation/    shared Zod schemas
│   ├── api-client/    typed fetch client
│   └── ui/            shared design-system components
├── docs/
│   ├── adr/           architecture decision records
│   └── status/         per-phase detail (linked from PROJECT_STATUS.md)
├── AGENTS.md
├── PROJECT_STATUS.md
└── docker-compose.yml  local Postgres + Redis
```
