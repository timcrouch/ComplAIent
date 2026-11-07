# Plan 1 — Platform Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A running, tested, signed-in empty shell of the ISMS: monorepo, contracts, database, NestJS API, worker, Keycloak sign-in, authorization and audit foundations, design system, web app shell, Docker dev environment, observability and CI.

**Architecture:** pnpm monorepo, modular-monolith NestJS API plus a BullMQ worker sharing packages. Zod schemas in `packages/contracts` are the single source for validation, typed clients and the OpenAPI document. The Next.js web app is a backend-for-frontend: it runs the OIDC login, keeps tokens server-side in Redis and calls the API with a bearer token. The API validates the token and enforces all permissions.

**Tech Stack:** Node 26 LTS, TypeScript 6.0 strict, pnpm 10, Next.js 16 (App Router), React, Tailwind CSS 4, shadcn/ui on Base UI, Motion for React, NestJS 12, Zod 4, `@asteasolutions/zod-to-openapi` 9, Prisma 7.10 with `@prisma/adapter-pg`, PostgreSQL 17 with pgvector, BullMQ 5 and Redis 7, MinIO, Keycloak, `openid-client` 6, `jose`, pino, OpenTelemetry, Prometheus, Grafana, Vitest, Playwright, dependency-cruiser, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-11-03-isms-foundation-design.md` (and the binding directives in `docs/directives/`).

**Plan series.** This is Plan 1 of 4. Plan 2 covers the domain model, control library and first-run organisation setup. Plan 3 covers the risk vertical slice, the AI gateway and the admin AI settings. Plan 4 covers production readiness: Terraform, the Entra ID connection, backups and restore, and the ASVS checklist. Each plan is written when the previous one is merged.

## Global Constraints

- Node **26 LTS**, recorded in `.nvmrc` and `engines`. pnpm **10**, pinned through `packageManager`.
- TypeScript **6.0.x** with `strict`, `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`. Do not use TypeScript 7: NestJS decorators and the toolchain are not verified on it. Record this in ADR-0002.
- Prisma **7.10.x stable**. Never use the 8.0 release candidates (`latest` currently points at an rc).
- Pin exact dependency versions (`save-exact=true` in `.npmrc`) and commit `pnpm-lock.yaml`.
- Every source file stays under **500 lines**.
- Tests come first in every task (TDD). Vitest is used in every package, with `unplugin-swc` for NestJS decorators.
- No secrets in code or committed files. Only `.env.example` holds dev-only placeholders. Logs must never contain tokens, cookies, keys or passwords.
- All user-facing text lives in `apps/web/messages/en.json` (next-intl). No inline UI strings.
- All business rules and permission checks live in the API. The web app only hides actions the API reports as unavailable.
- API base path `/api/v1`. Every error uses the contract `{ error: { code, message, requestId, details? } }`.
- No customer-specific names, data or copy anywhere.
- Work on the feature branch `feat/plan-1-foundation`. Commit after each task. Never force-push `main`.

## Review Focus

1. **The identity provider is unreachable, or its signing keys rotate.** A token signed with a new `kid` should trigger one JWKS refetch. If Keycloak is down, the API should return 503 `AUTH_UNAVAILABLE`, not a 500 with a stack trace. *Test: Task 7.*
2. **Malformed or hostile tokens.** Expired tokens, the wrong issuer or audience, `alg: none` and tampered signatures should all give 401 `UNAUTHENTICATED` with no detail about why. *Test: Task 7.*
3. **Missing or invalid configuration at startup.** The process should exit with a readable message that names the variable and never prints its value. *Test: Task 2.*
4. **Secrets in logs.** `authorization`, `cookie`, `set-cookie` and any field named `*token*`, `*secret*`, `*password*`, `apiKey` or `*Key` should be redacted. *Test: Task 6.*
5. **A web session that has expired or been signed out.** The user should be sent to sign-in once, with no redirect loop, and land back on the page they requested. *Test: Task 12.*

---

## File Structure

```text
.nvmrc  .npmrc  package.json  pnpm-workspace.yaml  .dependency-cruiser.cjs  .env.example
packages/tooling/      tsconfig.base.json, eslint.config.js, vitest.base.ts, prettier.config.js
packages/config/src/   load-config.ts, schemas.ts
packages/domain/src/   errors.ts, ids.ts, clock.ts
packages/contracts/src/ errors.ts, route.ts, openapi.ts, permissions.ts, routes/{system,identity}.ts, index.ts
packages/database/     prisma/schema.prisma, prisma/migrations/*, prisma.config.ts, src/client.ts, src/test-db.ts
packages/telemetry/src/ otel.ts, logger.ts
packages/jobs/src/     contracts.ts, queues.ts
packages/ui/src/       tokens/{tokens.css,tokens.ts}, components/*, index.ts
apps/api/src/          main.ts, app.module.ts, platform/{contract-route.ts,zod-pipe.ts,error-filter.ts,request-id.ts},
                       system/{system.module.ts,health.controller.ts},
                       identity/{identity.module.ts,jwt-verifier.ts,auth.guard.ts,user-provisioning.service.ts,me.controller.ts},
                       authorization/{authorization.module.ts,roles.ts,policy.service.ts,require-permission.ts,recent-auth.ts},
                       audit/{audit.module.ts,audit.service.ts}
apps/worker/src/       main.ts, jobs/heartbeat.ts
apps/web/              app/{layout.tsx,(app)/page.tsx,auth/{login,callback,logout}/route.ts}, lib/{session.ts,oidc.ts,api-client.ts},
                       components/shell/*, messages/en.json, middleware.ts
infrastructure/docker/ compose.yaml, keycloak/realm-isms.json, keycloak/seed-users.ts, otel-collector.yaml,
                       prometheus.yml, grafana/provisioning/*, Dockerfile.{api,worker,web}
.github/workflows/ci.yml  .github/dependabot.yml
docs/decisions/0001..0007-*.md  docs/security/architecture.md  docs/operations/local-development.md
```

---

### Task 1: Monorepo skeleton and boundary enforcement

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `.nvmrc`, `.npmrc`, `.dependency-cruiser.cjs`, `packages/tooling/{package.json,tsconfig.base.json,eslint.config.js,prettier.config.js,vitest.base.ts}`
- Create: `docs/decisions/0001-modular-monolith.md`, `docs/decisions/0002-toolchain-versions.md`
- Test: `packages/tooling/test/boundaries.test.ts`

**Interfaces:**
- Produces: root scripts `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test`, `pnpm test:integration`, `pnpm boundaries`. The shared config is used as `extends: "@isms/tooling/tsconfig.base.json"` and as `import { baseConfig } from "@isms/tooling/vitest"`.
- Boundary rules in `.dependency-cruiser.cjs`:
  - `packages/*` must never import `apps/*`.
  - `packages/ui` must not import `database`, `config` or `telemetry`.
  - `apps/web` must not import `@isms/database`.
  - No circular dependencies.
  - Inside `apps/api/src/<module>/`, a module may import another module only through its `index.ts`.

- [ ] **Step 1: Write the failing test.** `boundaries.test.ts` writes a temporary fixture file `packages/ui/src/__fixture__.ts` that does `import "@isms/database"`. It then runs `depcruise` with the repo config and asserts a non-zero exit code and output containing `ui-no-backend`. Afterwards it deletes the fixture and asserts that a clean run exits 0.
- [ ] **Step 2: Run** `pnpm --filter @isms/tooling test`. Expected: FAIL, because the config is missing.
- [ ] **Step 3: Create the workspace files.**
  - `.nvmrc` contains `26`.
  - `packageManager` is `pnpm@10.28.2`.
  - Base tsconfig: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `module: "NodeNext"`, `target: "ES2024"`.
  - ESLint uses a flat config with `typescript-eslint` strict-type-checked and a `max-lines: 500` rule.
  - Write the dependency-cruiser rules named above, with ids `packages-no-apps`, `ui-no-backend`, `web-no-database`, `no-circular` and `api-module-index-only`.
  - Write ADR-0001 (modular monolith; extraction path) and ADR-0002 (pinned versions and why TypeScript 6 and Prisma 7).
- [ ] **Step 4: Run** `nvm use && pnpm install && pnpm --filter @isms/tooling test && pnpm boundaries`. Expected: PASS.
- [ ] **Step 5: Commit** with `chore: monorepo skeleton with tooling and boundary rules`.

### Task 2: Validated configuration

**Files:**
- Create: `packages/config/src/{load-config.ts,schemas.ts,index.ts}`, `.env.example`
- Test: `packages/config/test/load-config.test.ts`

**Interfaces:**
- Produces:
  - `loadConfig<S extends z.ZodObject>(schema: S, env: NodeJS.ProcessEnv = process.env): z.infer<S>`. On failure it throws a `ConfigError` whose message lists each variable name and problem, never values.
  - Exported schemas: `databaseConfig` (`DATABASE_URL`), `redisConfig` (`REDIS_URL`), `oidcConfig` (`OIDC_ISSUER_URL`, `OIDC_AUDIENCE`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`), `webConfig` (`WEB_BASE_URL`, `API_BASE_URL`, `SESSION_SECRET` of at least 32 characters), `telemetryConfig` (`OTEL_EXPORTER_OTLP_ENDPOINT` optional, `LOG_LEVEL` default `info`), `bootstrapConfig` (`BOOTSTRAP_ADMIN_EMAIL` optional email).
  - Exported `formatConfigErrorAndExit(err): never` prints the message to stderr and exits with code 78.

- [ ] **Step 1: Write the failing tests.**

```ts
it("returns typed values", () => {
  expect(loadConfig(redisConfig, { REDIS_URL: "redis://localhost:6379" })).toEqual({ REDIS_URL: "redis://localhost:6379" });
});
it("names missing and invalid variables without printing values", () => {
  const env = { SESSION_SECRET: "short-secret-value", WEB_BASE_URL: "x" };
  const err = (() => { try { loadConfig(webConfig, env); } catch (e) { return e as Error; } })()!;
  expect(err.message).toContain("SESSION_SECRET");
  expect(err.message).toContain("API_BASE_URL");
  expect(err.message).not.toContain("short-secret-value");
});
```

- [ ] **Step 2: Run** `pnpm --filter @isms/config test`. Expected: FAIL, because the module is missing.
- [ ] **Step 3: Implement** `loadConfig`, the schemas and `formatConfigErrorAndExit`. Write `.env.example` with dev-only placeholder values for every variable, plus a comment that it is for local development only.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** with `feat(config): zod-validated configuration loader`.

### Task 3: Domain primitives and API contracts

**Files:**
- Create: `packages/domain/src/{errors.ts,ids.ts,clock.ts,index.ts}`
- Create: `packages/contracts/src/{errors.ts,route.ts,openapi.ts,permissions.ts,routes/system.ts,routes/identity.ts,index.ts}`
- Create: `docs/decisions/0003-contract-strategy.md`
- Test: `packages/domain/test/errors.test.ts`, `packages/contracts/test/openapi.test.ts`

**Interfaces:**
- Produces (domain):
  - `type ErrorCode = "VALIDATION_FAILED" | "UNAUTHENTICATED" | "FORBIDDEN" | "NOT_FOUND" | "CONFLICT" | "RECENT_AUTH_REQUIRED" | "AUTH_UNAVAILABLE" | "RATE_LIMITED" | "INTERNAL"`
  - `class DomainError extends Error { constructor(code: ErrorCode, message: string, details?: ErrorDetail[]) }`
  - `type ErrorDetail = { path: string; message: string }`
  - `interface Clock { now(): Date }` and `systemClock`
  - Branded `type Id<T extends string> = string & { __brand: T }` and `newId<T>(): Id<T>`, which returns a UUIDv7.
- Produces (contracts):
  - `ErrorResponse` (Zod).
  - `defineRoute(def: RouteDef)`, which returns the same object with its types inferred.
  - `type RouteDef = { method: "get"|"post"|"put"|"patch"|"delete"; path: string; summary: string; permission?: Permission; recentAuth?: boolean; request?: { params?: ZodObject; query?: ZodObject; body?: ZodType }; responses: Record<number, ZodType> }`
  - `buildOpenApiDocument(routes: RouteDef[]): OpenAPIObject`, at OpenAPI 3.1 with title `ISMS API` and version `1`.
  - `type Permission = "me.read" | "users.list" | "roles.assign" | "audit.read" | "settings.ai.manage"`. Later plans add to it.
  - Routes: `systemRoutes.health` (`GET /api/v1/health` → 200 `{ status: "ok" }`), `systemRoutes.ready` (`GET /api/v1/ready` → 200 or 503 `{ status, checks: Record<string,"ok"|"fail"> }`), `identityRoutes.me` (`GET /api/v1/me`, permission `me.read`, → 200 `MeResponse`).
  - `MeResponse = { id: string; email: string; displayName: string; roles: RoleAssignmentDto[]; permissions: Permission[]; viewMode: "guided"|"professional"|"executive" }`
  - `RoleAssignmentDto = { role: Role; scope: { type: "organisation"|"site"|"department"; id: string | null } }`
  - `Role = "administrator"|"ciso"|"risk_owner"|"risk_approver"|"contributor"|"viewer"|"auditor"`
  - `allRoutes`, an array of every route.

- [ ] **Step 1: Write the failing tests.** In `errors.test.ts`, check that `new DomainError("FORBIDDEN","x").code === "FORBIDDEN"` and that `newId()` matches the UUIDv7 regex. In `openapi.test.ts`:

```ts
const doc = buildOpenApiDocument(allRoutes);
expect(doc.openapi).toBe("3.1.0");
expect(doc.paths["/api/v1/me"]?.get?.responses?.["200"]).toBeDefined();
expect(doc.paths["/api/v1/me"]?.get?.responses?.["401"]).toBeDefined(); // auto-added ErrorResponse
expect(JSON.stringify(doc)).toMatchSnapshot(); // contract snapshot used by CI
```

- [ ] **Step 2: Run** `pnpm --filter @isms/domain --filter @isms/contracts test`. Expected: FAIL.
- [ ] **Step 3: Implement.** `buildOpenApiDocument` registers every route in an `OpenAPIRegistry`. It adds 400, 401, 403 and 500 `ErrorResponse` responses to each route, adds 429 when the route has a body, and adds 403 `RECENT_AUTH_REQUIRED` documentation when `recentAuth` is set. ADR-0003 records that there is one Zod source, that the API validates requests (always) and responses (in test and dev) against it, that the web client parses responses with it, and that the OpenAPI document is generated from it and snapshot-tested.
- [ ] **Step 4: Run** the same command. Expected: PASS, and the snapshot file is written.
- [ ] **Step 5: Commit** with `feat(contracts): domain errors, route contracts and OpenAPI generation`.

### Task 4: Local Docker environment

**Files:**
- Create: `infrastructure/docker/compose.yaml`, `infrastructure/docker/keycloak/realm-isms.json`, `infrastructure/docker/keycloak/seed-users.ts`, `infrastructure/docker/{otel-collector.yaml,prometheus.yml}`, `infrastructure/docker/grafana/provisioning/{datasources,dashboards}/*`, `infrastructure/docker/postgres/init.sql`, `scripts/wait-for-infra.ts`
- Create: `docs/operations/local-development.md`
- Test: `scripts/wait-for-infra.ts` (it is the check)

**Interfaces:**
- Produces:
  - Services:
    - `postgres` (image `pgvector/pgvector:pg17`, port 5432; databases `isms` and `isms_test`; roles `isms_owner` for migrations and `isms_app` for runtime)
    - `redis` (7, port 6379)
    - `minio` (ports 9000 and 9001; bucket `isms-evidence`)
    - `keycloak` (port 8080; realm `isms`; confidential client `isms-web` with PKCE and redirect `http://localhost:3000/auth/callback`; audience mapper to `isms-api`; `email_verified` in tokens)
    - `otel-collector` (port 4318), `prometheus` (port 9090), `grafana` (port 3001)
  - Root scripts `pnpm infra:up` (compose up, wait, seed users), `pnpm infra:down` and `pnpm infra:reset`.
  - Dev users, created by `seed-users.ts` through the Keycloak admin REST API, with passwords from `DEV_USER_PASSWORD` in `.env`: `admin@example.test`, `ciso@example.test`, `owner@example.test`, `approver@example.test`, `reporter@example.test`, `auditor@example.test`. All have verified emails.

- [ ] **Step 1: Write the check.** `wait-for-infra.ts` polls Postgres (`SELECT 1` as `isms_app`, and `CREATE EXTENSION IF NOT EXISTS vector` succeeding on `isms`), Redis `PING`, the MinIO bucket's existence, Keycloak `/realms/isms/.well-known/openid-configuration`, and Prometheus `/-/ready`. It times out after 120 s, exits non-zero, and names the failing service.
- [ ] **Step 2: Run** `pnpm infra:up`. Expected: FAIL, because the compose file is missing.
- [ ] **Step 3: Write the compose file, realm export, init SQL and seed script.**
  - `init.sql` creates both roles and both databases and grants `isms_app` only `CONNECT`. Table grants come from migrations (Task 5).
  - Credentials come from `.env` through compose variable substitution.
  - `local-development.md` documents the prerequisites, `cp .env.example .env`, `pnpm infra:up` and the dev users.
- [ ] **Step 4: Run** `pnpm infra:up`. Expected: every service reports `ok` and the seeded users are listed.
- [ ] **Step 5: Commit** with `feat(infra): local docker environment with keycloak, postgres, redis, minio, observability`.

### Task 5: Database package, identity tables and append-only audit

**Files:**
- Create: `packages/database/{package.json,prisma.config.ts,prisma/schema.prisma}`, `packages/database/prisma/migrations/<ts>_init/migration.sql`, `packages/database/src/{client.ts,test-db.ts,index.ts}`
- Test: `packages/database/test/audit-append-only.int.test.ts`, `packages/database/test/schema.int.test.ts`

**Interfaces:**
- Produces:
  - `createPrismaClient(databaseUrl: string): PrismaClient`, using `@prisma/adapter-pg`. The generator is `prisma-client`, with output `src/generated`.
  - `resetTestDatabase(): Promise<void>`, which truncates every table except `_prisma_migrations` and is for integration tests only.
  - Models:
    - `Organisation` (single row: `id`, `name`, `createdAt`)
    - `Site` (`id`, `name`, `countryCode` ISO-3166 alpha-2)
    - `Department` (`id`, `name`)
    - `User` (`id`, `idpIssuer`, `idpSubject`, `email`, `displayName`, `viewMode` enum default `guided`, `lastSeenAt`; unique on `(idpIssuer, idpSubject)`)
    - `RoleAssignment` (`id`, `userId`, `role` enum, `scopeType` enum `ORGANISATION|SITE|DEPARTMENT`, `scopeId` nullable, `grantedById`, `createdAt`; unique on `(userId, role, scopeType, scopeId)`; check constraint that `scopeId IS NULL` exactly when `scopeType = 'ORGANISATION'`)
    - `AuditEvent` (`id`, `occurredAt`, `actorUserId` nullable, `action` text, `objectType`, `objectId`, `beforeRef` jsonb nullable, `afterRef` jsonb nullable, `requestId`, `traceId` nullable; index on `(objectType, objectId, occurredAt)`)
  - Migration SQL also includes:
    - `CREATE EXTENSION IF NOT EXISTS vector`
    - `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES` to `isms_app`, then `REVOKE UPDATE, DELETE, TRUNCATE ON "AuditEvent" FROM isms_app`
    - a `BEFORE UPDATE OR DELETE` trigger on `AuditEvent` that raises `audit_event is append-only`
  - Scripts: `pnpm db:migrate` (as `isms_owner` via `DATABASE_OWNER_URL`), `pnpm db:migrate:test` and `pnpm db:validate` (`prisma migrate diff --exit-code` from the migrations to the schema).

- [ ] **Step 1: Write the failing integration tests.**

```ts
it("rejects UPDATE on AuditEvent as the app role", async () => {
  const e = await app.auditEvent.create({ data: { action: "test", objectType: "x", objectId: "1", requestId: "r" } });
  await expect(app.$executeRaw`UPDATE "AuditEvent" SET action='changed' WHERE id=${e.id}`).rejects.toThrow(/permission denied|append-only/);
  await expect(app.$executeRaw`DELETE FROM "AuditEvent" WHERE id=${e.id}`).rejects.toThrow(/permission denied|append-only/);
});
it("rejects UPDATE even as the owner role (trigger)", async () => { /* same via owner client, expect /append-only/ */ });
it("enforces organisation-scope has null scopeId", async () => { /* insert ORGANISATION with scopeId → rejects */ });
it("has the vector extension", async () => { /* SELECT extname FROM pg_extension → contains 'vector' */ });
```

- [ ] **Step 2: Run** `pnpm --filter @isms/database test:integration`. Expected: FAIL.
- [ ] **Step 3: Implement** the schema, the hand-edited migration SQL for the extension, grants, trigger and check constraint, the client factory and the test helper.
- [ ] **Step 4: Run** `pnpm db:migrate:test && pnpm --filter @isms/database test:integration && pnpm db:validate`. Expected: PASS.
- [ ] **Step 5: Commit** with `feat(database): identity schema and append-only audit table`.

### Task 6: API platform — bootstrap, validation, errors, logging, health

**Files:**
- Create: `packages/telemetry/src/{logger.ts,otel.ts,index.ts}`
- Create: `apps/api/src/{main.ts,app.module.ts}`, `apps/api/src/platform/{contract-route.ts,zod-pipe.ts,error-filter.ts,request-id.ts,index.ts}`, `apps/api/src/system/{system.module.ts,health.controller.ts,index.ts}`
- Test: `packages/telemetry/test/logger.test.ts`, `apps/api/test/platform.int.test.ts`

**Interfaces:**
- Consumes: `loadConfig` and the schemas (Task 2), `DomainError` (Task 3), `systemRoutes` (Task 3), `createPrismaClient` (Task 5).
- Produces:
  - `createLogger(opts: { level: string; service: string }): pino.Logger`. Its redact paths are `req.headers.authorization`, `req.headers.cookie`, `res.headers["set-cookie"]`, and `*.token`, `*.accessToken`, `*.refreshToken`, `*.idToken`, `*.secret`, `*.password`, `*.apiKey` at any depth.
  - `startTelemetry(service: string): void`, which sets up the OTel NodeSDK with HTTP, Nest, pg and ioredis auto-instrumentation, the OTLP exporter when an endpoint is configured, and a Prometheus exporter on `METRICS_PORT` (default 9464).
  - `@ContractRoute(route: RouteDef)`, a method decorator that applies the Nest HTTP method and path, the Zod validation of params, query and body (400 `VALIDATION_FAILED` with `details`), response validation outside production, and metadata later read by the auth and permission guards.
  - `GlobalErrorFilter`, which maps `DomainError` codes to statuses (VALIDATION_FAILED 400, UNAUTHENTICATED 401, FORBIDDEN 403, RECENT_AUTH_REQUIRED 403, NOT_FOUND 404, CONFLICT 409, RATE_LIMITED 429, AUTH_UNAVAILABLE 503, INTERNAL 500). Unknown errors become 500 `INTERNAL` with a generic message. Every response includes `requestId`.
  - Request id middleware: it accepts an inbound `x-request-id` only if it matches `^[A-Za-z0-9-]{8,64}$`, otherwise it generates one. It echoes the id in the response header.
  - Global safeguards: helmet, a JSON body limit of 1 MB, and `@nestjs/throttler` at 120 requests per minute per IP by default.
  - `GET /api/v1/health` returns 200 always. `GET /api/v1/ready` checks Postgres and Redis and returns 503 with `checks` when either fails. `GET /api/v1/openapi.json` returns `buildOpenApiDocument(allRoutes)`.

- [ ] **Step 1: Write the failing tests.**

```ts
// logger.test.ts — capture output via a destination stream
log.info({ req: { headers: { authorization: "Bearer abc", cookie: "s=1" } }, nested: { apiKey: "sk-or-1", password: "p" } }, "x");
expect(output).not.toMatch(/Bearer abc|s=1|sk-or-1|"p"/);
expect(output).toContain("[Redacted]");

// platform.int.test.ts (Nest testing module + supertest; Redis/Postgres from compose)
it("health is ok", ...);                               // 200 { status: "ok" }
it("ready reports failed dependency with 503", ...);  // override Redis provider with a failing ping → 503, checks.redis === "fail"
it("rejects invalid body with VALIDATION_FAILED and details", ...); // test-only route defined in the test with body z.object({ n: z.number() })
it("unknown error becomes INTERNAL without stack", ...); // body.error.code === "INTERNAL"; JSON has no "at "
it("echoes a valid x-request-id and replaces an invalid one", ...);
it("serves the OpenAPI document", ...);               // GET /api/v1/openapi.json → openapi === "3.1.0"
```

- [ ] **Step 2: Run** `pnpm --filter @isms/telemetry --filter @isms/api test`. Expected: FAIL.
- [ ] **Step 3: Implement** the logger, telemetry, platform pieces, system module and `main.ts`. `main.ts` calls `startTelemetry("isms-api")` before anything else, loads the config (on failure, `formatConfigErrorAndExit`), does **not** call `setGlobalPrefix`, because every contract declares its full path starting with `/api/v1`, and uses nestjs-pino with `createLogger`.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** with `feat(api): platform bootstrap with contract routes, errors, logging, health`.

### Task 7: Identity — token verification, user provisioning, `/me`

**Files:**
- Create: `apps/api/src/identity/{identity.module.ts,jwt-verifier.ts,auth.guard.ts,user-provisioning.service.ts,me.controller.ts,index.ts}`
- Create: `docs/decisions/0004-authentication-bff.md`
- Test: `apps/api/test/identity/jwt-verifier.test.ts`, `apps/api/test/identity/me.int.test.ts`

**Interfaces:**
- Consumes: `oidcConfig`, `bootstrapConfig` (Task 2); `identityRoutes.me` (Task 3); Prisma `User` and `RoleAssignment` (Task 5); `@ContractRoute` (Task 6).
- Produces:
  - `type VerifiedToken = { issuer: string; subject: string; email: string; emailVerified: boolean; name: string; authTime: number /* epoch seconds */ }`
  - `class JwtVerifier { verify(token: string): Promise<VerifiedToken> }`. It uses `jose` `createRemoteJWKSet`, allows only `RS256` and `ES256`, checks issuer and audience, and allows 30 s of clock skew. A network failure fetching the JWKS throws `DomainError("AUTH_UNAVAILABLE")`. Any other failure throws `DomainError("UNAUTHENTICATED", "Sign-in required")`.
  - `AuthGuard`, a global guard. Every route requires a bearer token unless the route has no `permission` and its path starts with `/api/v1/health`, `/api/v1/ready` or `/api/v1/openapi.json`. It attaches `request.actor: Actor`.
  - `type Actor = { userId: string; email: string; authTime: number; roles: RoleAssignmentDto[] }`
  - `UserProvisioningService.resolve(token: VerifiedToken): Promise<Actor>` upserts on `(issuer, subject)` and refreshes `email`, `displayName` and `lastSeenAt`. **Bootstrap rule:** when no `administrator` assignment exists, `BOOTSTRAP_ADMIN_EMAIL` is set, and the token's `emailVerified` is true and its email matches case-insensitively, the service grants `administrator` with organisation scope and writes the audit action `identity.bootstrap_admin`. It never does so in any other case.
  - `GET /api/v1/me` returns `MeResponse`. `permissions` comes from `PolicyService.permissionsFor(actor)`. Until Task 8 lands, this is stubbed to `["me.read"]`, and Task 8 replaces the stub.

- [ ] **Step 1: Write the failing tests.** `jwt-verifier.test.ts` uses a local JWKS served by an in-test HTTP server with keys from `jose.generateKeyPair`.

```ts
it("accepts a valid token", ...);                       // returns subject/email/authTime
it.each([
  ["expired", { exp: past }], ["wrong issuer", { iss: "https://evil" }],
  ["wrong audience", { aud: "other" }], ["tampered", "flip-signature"], ["alg none", "unsigned"],
])("rejects %s with UNAUTHENTICATED", ...);
it("refetches JWKS once for an unknown kid (key rotation)", ...); // rotate server keys, sign with new key → accepted; server hit count === 2
it("maps JWKS network failure to AUTH_UNAVAILABLE", ...);        // stop server → code AUTH_UNAVAILABLE
```

`me.int.test.ts` covers the following. A missing token gives 401 with code `UNAUTHENTICATED`. A valid token gives 200 and creates the user. A second call updates `lastSeenAt` but creates no duplicate. Bootstrap grants admin only when the email is verified and matches; it does nothing if the email is unverified, and does nothing if an admin already exists. Each bootstrap writes exactly one `identity.bootstrap_admin` audit row. The audit service lands in Task 8, so this test is enabled at the end of Task 8.

- [ ] **Step 2: Run** `pnpm --filter @isms/api test -- identity`. Expected: FAIL.
- [ ] **Step 3: Implement** the verifier, guard, provisioning service and controller. ADR-0004 records the BFF decision: tokens are held server-side by the web app, the API is a pure resource server, roles are assigned in the app, and IdP group mapping is deferred to Plan 4.
- [ ] **Step 4: Run** the same command. Expected: PASS, except the audit assertion, which is marked `it.todo` until Task 8.
- [ ] **Step 5: Commit** with `feat(api): OIDC token verification, user provisioning, /me`.

### Task 8: Authorization policy, recent-auth check and audit service

**Files:**
- Create: `apps/api/src/authorization/{authorization.module.ts,roles.ts,policy.service.ts,require-permission.ts,recent-auth.ts,index.ts}`, `apps/api/src/audit/{audit.module.ts,audit.service.ts,index.ts}`
- Create: `docs/decisions/0005-authorization-model.md`, `docs/decisions/0006-audit-history.md`
- Test: `apps/api/test/authorization/policy.test.ts`, `apps/api/test/authorization/guards.int.test.ts`, `apps/api/test/audit/audit.int.test.ts`

**Interfaces:**
- Consumes: `Actor` (Task 7); `Permission`, `Role` and `RouteDef.permission` / `RouteDef.recentAuth` (Task 3); Prisma `AuditEvent` (Task 5).
- Produces:
  - `ROLE_PERMISSIONS: Record<Role, readonly Permission[]>`, with the initial values below. Later plans extend these.
    - administrator: `me.read`, `users.list`, `roles.assign`, `audit.read`, `settings.ai.manage`
    - ciso: `me.read`, `users.list`, `audit.read`
    - auditor: `me.read`, `audit.read`
    - risk_owner, risk_approver, contributor, viewer: `me.read`
  - `type ResourceScope = { siteId?: string; departmentId?: string }`
  - `PolicyService.can(actor: Actor, permission: Permission, resource?: ResourceScope): boolean`. An organisation-scoped assignment matches any resource. A site-scoped assignment matches only when `resource.siteId` equals it, and likewise for departments. Calling with no resource matches organisation-scoped assignments only.
  - `PolicyService.permissionsFor(actor: Actor): Permission[]`, the union across assignments with no duplicates.
  - `PermissionGuard`, global and after `AuthGuard`. It reads `route.permission` and, when `can` is false, throws `DomainError("FORBIDDEN","You don't have access to this")`. When `route.recentAuth` is set and `now - actor.authTime > 300` seconds, it throws `DomainError("RECENT_AUTH_REQUIRED","Please sign in again to continue")`.
  - `AuditService.record(e: { action: string; objectType: string; objectId: string; before?: unknown; after?: unknown }, ctx: { actorUserId: string | null; requestId: string; traceId?: string }, tx?: Prisma.TransactionClient): Promise<void>`. It strips keys matching `/token|secret|password|apikey/i` from `before` and `after` at any depth before writing.

- [ ] **Step 1: Write the failing tests.**

```ts
// policy.test.ts — table-driven
it.each([
  ["org admin, no resource", [adminOrg], "users.list", undefined, true],
  ["contributor cannot list users", [contribOrg], "users.list", undefined, false],
  ["site-scoped ciso matches own site", [cisoSiteA], "audit.read", { siteId: "A" }, true],
  ["site-scoped ciso denied other site", [cisoSiteA], "audit.read", { siteId: "B" }, false],
  ["site-scoped ciso denied org-level", [cisoSiteA], "audit.read", undefined, false],
])("%s", (_n, roles, perm, res, expected) => expect(policy.can(actor(roles), perm, res)).toBe(expected));
it("permissionsFor unions without duplicates", ...);

// guards.int.test.ts — test-only routes with permission "users.list" and recentAuth: true
it("403 FORBIDDEN for contributor", ...);
it("403 RECENT_AUTH_REQUIRED when authTime is 301s old; 200 when 299s", ...); // inject Clock

// audit.int.test.ts
it("strips secret-like keys", async () => {
  await audit.record({ action: "t", objectType: "x", objectId: "1", after: { apiKey: "k", nested: { refreshToken: "r" }, ok: 1 } }, ctx);
  const row = await db.auditEvent.findFirstOrThrow();
  expect(row.afterRef).toEqual({ nested: {}, ok: 1 });
});
it("writes inside the caller's transaction and rolls back with it", ...);
```

- [ ] **Step 2: Run** `pnpm --filter @isms/api test -- authorization audit`. Expected: FAIL.
- [ ] **Step 3: Implement** the policy, guards, audit service and both ADRs. Replace the `permissionsFor` stub from Task 7 and turn the Task 7 bootstrap audit `it.todo` into a real test.
- [ ] **Step 4: Run** `pnpm --filter @isms/api test && pnpm --filter @isms/api test:integration`. Expected: PASS.
- [ ] **Step 5: Commit** with `feat(api): role and scope policy, recent-auth guard, audit service`.

### Task 9: Background worker

**Files:**
- Create: `apps/worker/src/{main.ts,jobs/heartbeat.ts}`, `packages/jobs/src/{contracts.ts,queues.ts,index.ts}`
- Test: `packages/jobs/test/queues.int.test.ts`

**Interfaces:**
- Consumes: `redisConfig` (Task 2); `createLogger` and `startTelemetry` (Task 6).
- Produces:
  - `packages/jobs` (`@isms/jobs`) owns job contracts and queue helpers. `apps/api` imports only `enqueue`. `apps/worker` imports `registerProcessor`.
  - `JobContracts` in `packages/jobs/src/contracts.ts`: `{ "system.heartbeat": z.object({ at: z.string().datetime() }) }`. `type JobName = keyof typeof JobContracts`.
  - `enqueue<N extends JobName>(name: N, payload: z.infer<(typeof JobContracts)[N]>, opts: { idempotencyKey: string }): Promise<void>`. It validates the payload, uses `jobId = name + ":" + idempotencyKey`, and defaults to `attempts: 5` with `backoff: { type: "exponential", delay: 2000 }`, `removeOnComplete: 1000` and `removeOnFail: false`.
  - `registerProcessor<N extends JobName>(name: N, handler: (payload) => Promise<void>): Worker`. After the final failed attempt, it copies the job to the queue `dead-letter` with `{ originalQueue, jobId, failedReason, payload }` and logs at `error` level.
  - The worker exposes `GET :9465/healthz` and Prometheus metrics for job counts by state.

- [ ] **Step 1: Write the failing tests.** These are integration tests against Redis, using the queue prefix `test-<random>`.

```ts
it("deduplicates by idempotency key", ...);           // enqueue twice same key → queue count 1
it("rejects invalid payload before enqueue", ...);    // at: "nope" → throws VALIDATION_FAILED
it("moves exhausted job to dead-letter", ...);        // handler always throws, attempts overridden to 2 in test → dead-letter has 1 entry with failedReason
it("processes heartbeat", ...);                       // handler called with parsed payload
```

- [ ] **Step 2: Run** `pnpm --filter @isms/jobs test:integration`. Expected: FAIL.
- [ ] **Step 3: Implement** `packages/jobs`, the heartbeat job and `apps/worker/src/main.ts`. `main.ts` loads the config, starts telemetry, registers processors and shuts down gracefully on SIGTERM by calling `worker.close()`.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** with `feat(worker): BullMQ queues with idempotency, retries and dead-letter`.

### Task 10: Design system — Clear Glass tokens and core components

**Files:**
- Create: `packages/ui/src/tokens/{tokens.css,tokens.ts}`, `packages/ui/src/components/{button.tsx,card.tsx,status-badge.tsx,chip.tsx,input.tsx,dialog.tsx,command-palette.tsx,ai-badge.tsx}`, `packages/ui/src/index.ts`, `packages/ui/components.json`
- Test: `packages/ui/test/contrast.test.ts`, `packages/ui/test/components.test.tsx`

**Interfaces:**
- Produces:
  - `tokens.ts` exports `tokens: { light: ThemeTokens; dark: ThemeTokens }` with semantic keys `bg`, `bgGradientFrom`, `bgGradientTo`, `surface`, `surfaceBorder`, `text`, `textMuted`, `accent`, `accentText`, `accentSoft`, `ok`, `okSoft`, `attention`, `attentionSoft`, `critical`, `criticalSoft`, `info`, `infoSoft` and `focusRing`, plus `radius: { sm: 8, md: 12, lg: 16 }`, two-step `shadow` values and `motion: { fast: 120, base: 200, slow: 320 }` in ms with easing `cubic-bezier(0.2, 0.8, 0.2, 1)`.
  - Starting light values from the approved mockup: bg `#F3F5FB`, gradient to `#F4F1FA`, text `#141A2E`, textMuted `#5B6380`, accent `#4F3FD9`, ok `#167A4C`, attention `#A15C07`, info `#4F3FD9`. Design dark as cool slate surfaces, not an inversion.
  - `tokens.css` defines the same values as CSS variables under `:root` and `[data-theme="dark"]`, with `@media (prefers-color-scheme: dark)` as the default and an `@theme` block for Tailwind 4. Under `prefers-reduced-motion`, all `--motion-*` values become 0ms.
  - `StatusBadge({ status: "ok"|"attention"|"critical"|"info"|"unknown"; label: string })` always renders an icon and the label, and accepts no icon-only mode.
  - `AiBadge({ state: "suggested"|"draft" })` shows "Suggested by AI" or "AI draft".
  - The other components are shadcn/ui components generated on Base UI primitives and restyled with tokens: Button (variants `primary|secondary|ghost`), Card, Chip (`selected`), Input, Dialog, CommandPalette (shell: open on ⌘K/Ctrl+K, list of `{ id, label, onSelect }`).
  - The font is Plus Jakarta Sans via `next/font` in the web app. `packages/ui` refers only to the CSS variable `--font-sans`.

- [ ] **Step 1: Write the failing tests.**

```ts
// contrast.test.ts — WCAG relative luminance
for (const theme of ["light", "dark"] as const) {
  const t = tokens[theme];
  it(`${theme}: body text ≥ 4.5`, () => expect(contrast(t.text, t.surface)).toBeGreaterThanOrEqual(4.5));
  it(`${theme}: muted text ≥ 4.5`, () => expect(contrast(t.textMuted, t.surface)).toBeGreaterThanOrEqual(4.5));
  it(`${theme}: accentText on accent ≥ 4.5`, ...);
  it.each(["ok","attention","critical","info"])(`${theme}: %s text on its soft bg ≥ 4.5`, ...);
  it(`${theme}: focus ring vs bg ≥ 3`, ...);
}
// components.test.tsx — Testing Library + vitest-axe
it("StatusBadge renders icon and text", ...);          // getByText(label); svg has aria-hidden
it("no axe violations for each component in both themes", ...);
it("CommandPalette opens with Ctrl+K and runs onSelect with Enter", ...);
```

- [ ] **Step 2: Run** `pnpm --filter @isms/ui test`. Expected: FAIL.
- [ ] **Step 3: Implement** the tokens, the CSS, and the components through `pnpm dlx shadcn@latest add` with the Base UI registry, then restyle them. Adjust any token value that fails a contrast test, stay as close to the mockup as possible, and note every change in a comment in `tokens.ts`.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** with `feat(ui): Clear Glass design tokens and core accessible components`.

### Task 11: Web app — sign-in, session, typed API client

**Files:**
- Create: `apps/web/{package.json,next.config.ts,middleware.ts}`, `apps/web/lib/{oidc.ts,session.ts,api-client.ts}`, `apps/web/app/auth/{login,callback,logout}/route.ts`
- Test: `apps/web/test/session.test.ts`, `apps/web/test/api-client.test.ts`

**Interfaces:**
- Consumes: `webConfig`, `oidcConfig` and `redisConfig` (Task 2); `identityRoutes` and `ErrorResponse` (Task 3).
- Produces:
  - `oidc.ts`: `buildAuthorizationUrl(returnTo: string)` returns `{ url, state, codeVerifier }`, using `openid-client` 6 with PKCE S256, scope `openid profile email`, and an optional `max_age` for step-up. `handleCallback(params, stored)` returns tokens. `refresh(refreshToken)` returns tokens.
  - `session.ts`:
    - `createSession(tokens): Promise<string /* sessionId */>`, `getSession(sessionId): Promise<Session | null>`, `destroySession(sessionId)`.
    - Sessions are stored in Redis under the key `sess:<id>` with a TTL equal to the refresh token lifetime. The id is 32 random bytes in base64url.
    - The cookie `isms_session` is set with `HttpOnly; Secure` (except on localhost); `SameSite=Lax`; `Path=/`.
    - `getAccessToken(sessionId)` refreshes when fewer than 30 s remain and returns `null` if the refresh fails.
  - `safeReturnTo(value: string | null): string` allows only relative paths starting with `/` and not `//`. Anything else becomes `/`.
  - `middleware.ts`: when there is no valid session on an app route, it redirects once to `/auth/login?returnTo=<path>`. It never redirects from `/auth/*`.
  - `api-client.ts`: `apiCall<R extends RouteDef>(route: R, input: RouteInput<R>, accessToken: string): Promise<RouteOutput<R>>`. It parses 2xx responses with the route's schema. Non-2xx responses become `ApiError { status, code, message, requestId }`, parsed with `ErrorResponse`.

- [ ] **Step 1: Write the failing tests.**

```ts
it.each([["/risks", "/risks"], ["//evil.com", "/"], ["https://evil.com", "/"], [null, "/"], ["/a?b=1", "/a?b=1"]])
  ("safeReturnTo(%s) → %s", (i, o) => expect(safeReturnTo(i)).toBe(o));
it("getAccessToken refreshes near expiry", ...);          // mock oidc.refresh; token with 10s left → refreshed, session updated
it("getAccessToken returns null and destroys session when refresh fails", ...);
it("apiCall parses success with contract schema", ...);   // mock fetch → MeResponse
it("apiCall throws ApiError with code from ErrorResponse", ...);
it("apiCall rejects a response that violates the schema", ...);
```

- [ ] **Step 2: Run** `pnpm --filter @isms/web test`. Expected: FAIL.
- [ ] **Step 3: Implement.** The route handlers work as follows:
  - `login` stores `{ state, codeVerifier, returnTo }` in a short-lived (10 min) Redis entry keyed by `state`, then redirects to the IdP.
  - `callback` validates `state`, exchanges the code, creates the session, sets the cookie and redirects to `returnTo`.
  - `logout` destroys the session, clears the cookie and redirects to the IdP's end-session endpoint.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** with `feat(web): OIDC BFF sign-in with server-side sessions and typed API client`.

### Task 12: Web app shell and home empty state, with end-to-end tests

**Files:**
- Create: `apps/web/app/layout.tsx`, `apps/web/app/(app)/{layout.tsx,page.tsx}`, `apps/web/components/shell/{app-shell.tsx,primary-nav.tsx,theme-toggle.tsx,view-mode-switch.tsx,command-palette-host.tsx}`, `apps/web/messages/en.json`, `apps/web/i18n.ts`
- Create: `e2e/{playwright.config.ts,auth.setup.ts,login.spec.ts,shell.spec.ts}`
- Test: the `e2e/*.spec.ts` files and `apps/web/test/shell.test.tsx`

**Interfaces:**
- Consumes: `apiCall` and the session helpers (Task 11); UI components (Task 10); `MeResponse` (Task 3).
- Produces:
  - The `(app)` layout fetches `/me` server-side and renders `AppShell`. `AppShell` has a persistent primary nav with Home only for now and other items added by later plans, the user menu with sign-out, a theme toggle (light / dark / system, stored in a cookie), and a view-mode switch (Guided / Professional / Executive). The view mode is display-only in this plan; persisting it is added with its endpoint in Plan 2.
  - The ⌘K palette has the actions "Go to Home", "Switch theme" and "Sign out".
  - The home page greets by time of day and first name ("Good morning, Anna."). It shows a designed empty state with the copy key `home.empty.title`: "Your security workspace is ready." The body is "Once your organisation is set up, this is where you'll see how secure you are and what needs your attention." The empty state shows no metrics and no placeholder numbers.
  - Every string comes from `en.json`.
  - Page transitions use Motion with the token durations. Under reduced motion there are no transitions.

- [ ] **Step 1: Write the failing tests.**

```ts
// login.spec.ts (against compose stack + `pnpm dev`)
test("unauthenticated visit redirects to Keycloak once, then back to requested page", async ({ page }) => {
  await page.goto("/");                                   // → keycloak login
  await page.fill("#username", "reporter@example.test"); await page.fill("#password", process.env.DEV_USER_PASSWORD!);
  await page.click("#kc-login");
  await expect(page).toHaveURL("http://localhost:3000/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(/Good (morning|afternoon|evening)/);
});
test("expired session sends user to sign-in exactly once and returns to the page", ...); // delete sess:* in Redis, reload → one redirect (count via page.on("request")) and lands back
test("sign-out ends session", ...);                     // after logout, GET / → redirected to Keycloak
// shell.spec.ts
test("Ctrl+K opens palette and 'Switch theme' toggles data-theme", ...);
test("home empty state shows no numbers", ...);         // main region text has no /\d+%|\d+ (risks|controls)/
test("axe: no violations on home in light and dark", ...); // @axe-core/playwright
test("keyboard only: Tab reaches nav, palette, user menu with visible focus", ...);
```

- [ ] **Step 2: Run** `pnpm infra:up && pnpm dev & pnpm e2e`. Expected: FAIL.
- [ ] **Step 3: Implement** the shell, home page and messages, using next-intl with only `en`. The `(app)` layout catches `ApiError` 401 and redirects through `/auth/login` with `returnTo`.
- [ ] **Step 4: Run** `pnpm e2e`. Expected: PASS in Chromium. Also run the `webkit` project for the login spec.
- [ ] **Step 5: Commit** with `feat(web): app shell, command palette, home empty state with e2e coverage`.

### Task 13: Containers, CI pipeline and security documentation

**Files:**
- Create: `infrastructure/docker/Dockerfile.{api,worker,web}`, `.dockerignore`, `.github/workflows/ci.yml`, `.github/dependabot.yml`, `.gitleaks.toml`
- Create: `docs/decisions/0007-per-organisation-deployment.md`, `docs/security/architecture.md`
- Test: the CI workflow run on the pull request

**Interfaces:**
- Consumes: every script from Tasks 1 to 12.
- Produces:
  - **Images.** Multi-stage builds on `node:26-alpine` produce three images: `isms-api`, `isms-worker` and `isms-web`.
    - Each runs as a non-root user (uid 10001) and keeps only production dependencies (`pnpm deploy --prod`).
    - Each has a `HEALTHCHECK`: `/api/v1/health` for the API, `:9465/healthz` for the worker and `/` for web.
    - Web uses the Next.js `standalone` output.
  - **CI.** `ci.yml` runs on PRs and on pushes to `main`. Its jobs are:
    1. `quality`: install with a frozen lockfile, `typecheck`, `lint`, `format:check`, `boundaries`.
    2. `unit`: `pnpm test`.
    3. `integration`: service containers `pgvector/pgvector:pg17` and `redis:7`, then `db:migrate:test`, `db:validate` and `test:integration`.
    4. `contract`: the contracts OpenAPI snapshot test. It fails on a diff unless the snapshot is updated in the same PR.
    5. `e2e`: the compose stack, then Playwright. Reports are uploaded as artifacts.
    6. `build`: the three Docker images.
    7. `security`: `gitleaks` over the full history, `pnpm audit --audit-level high`, `trivy image` with `--severity HIGH,CRITICAL --exit-code 1` on the three images, and `osv-scanner` on the lockfile.
  - **Dependabot.** Weekly updates for npm, Docker and github-actions.
  - **ADR-0007.** One installation per organisation: the deployment shape is portable (plain Docker host, any EU cloud, on-premises), and Terraform comes in Plan 4.
  - **`docs/security/architecture.md`.** It covers:
    - trust boundaries: browser, web BFF, API, worker, Postgres, Redis, object storage, IdP, AI provider (Plan 3);
    - how tokens and sessions flow;
    - authorization layers;
    - audit immutability;
    - the secrets inventory and where each secret lives;
    - logging and redaction rules;
    - a threat list for this foundation, mapped to OWASP ASVS L2 chapter headings: V2 Authentication, V3 Session, V4 Access Control, V5 Validation, V7 Logging, V8 Data Protection, V14 Configuration.

- [ ] **Step 1: Push the branch and open a draft PR** with `ci.yml` in place. Expected: the jobs run, and any job whose prerequisites are missing fails. Record which jobs failed.
- [ ] **Step 2: Add the Dockerfiles and fix each failing job** until all seven are green.
- [ ] **Step 3: Verify the images locally** with `docker build -f infrastructure/docker/Dockerfile.api -t isms-api . && docker run --rm isms-api id -u`. Expected: `10001`.
- [ ] **Step 4: Write ADR-0007 and the security architecture document.**
- [ ] **Step 5: Commit** with `ci: pipeline with quality, tests, contract, e2e, image build and security scans`. CI must be green on the PR.

---

## Definition of done for Plan 1

- `pnpm install && pnpm infra:up && pnpm db:migrate && pnpm dev` from a clean clone gives a working sign-in at `http://localhost:3000` as any dev user, and the home empty state appears.
- Every CI job is green on the PR into `main`.
- ADRs 0001 to 0007 and `docs/security/architecture.md` exist, along with `docs/operations/local-development.md`.
- The Review Focus tests exist and pass: JWKS rotation and outage, hostile tokens, config errors without values, log redaction, and the expired session with a single redirect.
