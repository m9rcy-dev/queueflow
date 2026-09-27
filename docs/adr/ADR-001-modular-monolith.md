# ADR-001: Modular Monolith

**Status:** Accepted
**Date:** 2026-09-27

## Context

The plan's core principle (§3.5): don't start with microservices. QueueFlow needs clear domain
boundaries (tenant, location, service, queue, customer, notification, auth, QR/code) but not
independent deployability at this scale — one hobby-phase deployment, one small team (one person).

## Decision

Single NestJS application with explicit domain modules. No Kafka. No service extraction until a
real scaling need demonstrates it's required — not speculatively.

## Alternatives

- Microservices per domain — rejected, massive premature operational overhead for the actual scale.
- Serverless functions per endpoint — rejected, SSE (ADR-007) wants a long-lived process.

## Consequences

- Module boundaries are enforced by convention and code review, not deployment boundaries — controllers
  must not reach into another module's repository/persistence layer directly.
- Extraction into services later is possible because module boundaries are already explicit, but is
  not a goal of this decision.
