# ADR-0001: Modular monolith with enforced boundaries

Status: Accepted (2026-11-03)

## Context

The ISMS product needs a web app, an API and a background worker that share domain rules, contracts and persistence. A small team ships it. Distributed services would add operational cost before any scaling need exists.

## Decision

Build a pnpm monorepo deployed as three processes: `apps/web` (Next.js), `apps/api` (NestJS) and `apps/worker` (BullMQ). Shared code lives in `packages/{tooling,config,domain,contracts,database,telemetry,jobs,ui}`. The API is a modular monolith: each module under `apps/api/src/<module>/` exposes a public surface only through its `index.ts`.

Boundaries are enforced in CI by dependency-cruiser (`.dependency-cruiser.cjs`, run via `pnpm boundaries`):

- `packages-no-apps`: packages never import apps.
- `ui-no-backend`: `packages/ui` never imports database, config or telemetry.
- `web-no-database`: the web app never imports `@isms/database`; it talks to the API only.
- `no-circular`: no circular dependencies.
- `api-module-index-only`: API modules import each other only via `index.ts`.

All business rules and permission checks live in the API.

## Extraction path

Because modules interact only through `index.ts` and contracts, a module can later be extracted into its own service. Replace the in-process import with a client generated from `packages/contracts`, move the module's tables behind its own database schema, and move its jobs to a dedicated queue in `packages/jobs`. The boundary rules guarantee no hidden coupling has to be untangled first.

## Consequences

- One deployable codebase, simple local development and refactoring.
- Boundary violations fail the build rather than relying on review.
- Extraction is possible but is not free; it is deferred until a measured need appears.
