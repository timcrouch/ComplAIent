# ADR-0003: One Zod source for API contracts

Status: Accepted (2026-11-03)

## Context

The API, the web client and the worker must agree on request and response shapes. Hand-written types, validators and API documentation drift apart.

## Decision

`packages/contracts` holds the single source of truth: Zod 4 schemas, one `RouteDef` per endpoint (method, OpenAPI-style path, permission, recent-auth flag, request and response schemas). `packages/domain` holds framework-free primitives (`DomainError`, `ErrorCode`, `Id`, `Clock`); contracts depends on domain only for `ErrorCode`, never the reverse.

- The API validates every request against the contract, always. It validates responses against the contract in test and dev, so drift fails tests rather than production traffic.
- The web client parses responses with the same schemas.
- The OpenAPI 3.1 document is generated from the route definitions with `@asteasolutions/zod-to-openapi` (`buildOpenApiDocument`). It is snapshot-tested, so any contract change appears as a reviewed diff in CI.
- Every route automatically documents `ErrorResponse` for 400, 401, 403 and 500. Routes with a body add 429. Routes with `recentAuth` document `RECENT_AUTH_REQUIRED` under 403.
- `RouteDef.path` uses OpenAPI style (`/api/v1/risks/{id}`); the API layer converts it to the Nest `:id` style.
- `/api/v1/openapi.json` is served by the API itself and is not a contract route.
- `Role` and `Permission` are Zod enums exported from contracts. Later plans extend them.

## Consequences

- A contract change is one edit in one place, and the generated document and snapshot follow.
- Contracts depend on Zod and the OpenAPI generator, so the web bundle carries Zod; this is accepted because the client parses responses anyway.
- `buildOpenApiDocument` builds a fresh registry per call and never mutates its input.
