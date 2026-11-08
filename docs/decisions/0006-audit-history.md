# ADR-0006: Append-only, transactional audit history without secrets

Status: Accepted (2026-11-03)

## Context

ISO 27001 and the customers' regulators expect a reliable record of who changed what, and when. Two things make an audit trail worthless: rows that can be altered afterwards, and changes that happen without a matching row. Audit data is kept for a long time and read by many people, so it must never hold credentials.

## Decision

- **One table, `AuditEvent`.** Each row records the actor (`actorUserId`, or NULL for the system), the action (for example `identity.bootstrap_admin`), the object (`objectType`, `objectId`), and JSON snapshots `beforeRef` and `afterRef`. It also records `requestId` and the OpenTelemetry `traceId`, if one is active, so a row can be correlated with logs and traces. The `requestId` may be supplied by the client through `x-request-id`; it is accepted only if it matches the safe pattern `^[A-Za-z0-9-]{8,64}$`, and is otherwise generated. It is therefore a correlation aid only, never proof of anything: it need not be unique and can be chosen by the caller. The actor and timestamp are the authoritative fields.
- **Append-only through privileges and a trigger** (Task 5 migration):
  - The runtime role `isms_app` has `INSERT` and `SELECT` on `AuditEvent`, but not `UPDATE`, `DELETE` or `TRUNCATE`.
  - A `BEFORE UPDATE OR DELETE ... FOR EACH ROW` trigger raises an error, so the owner role cannot change or remove rows either through ordinary statements.
  - **TRUNCATE (Ruling R3).** Row triggers do not fire on `TRUNCATE`. The owner role can therefore still truncate, and the test reset (`resetTestDatabase`) relies on that against the `_test` database only. The guarantee is against the application role and against row-level changes. Owner credentials are used only by migrations, the test reset, and demo mode: with `DEMO_TOOLS_ENABLED=true` the API's demo module and the `pnpm demo:load` / `pnpm demo:reset` commands truncate a demo instance's database as the owner to reset it or load sample data, which erases the trail by design; it then starts again with `demo.reset` (ADR-0007, `docs/security/architecture.md` §4). A later hardening task may add a statement-level `TRUNCATE` trigger with a test-only bypass.
- **One way to write.** `AuditService.record(event, ctx, tx?)` is the only writer. `auditContextFrom(request)` builds `ctx` from the request: `actor.userId`, the request id, and the active trace id.
- **Transactional writes.** When the caller passes its `Prisma.TransactionClient`, the row is written in the same transaction as the change it describes, and it commits or rolls back with it. A change that must be audited passes `tx`, so it cannot persist without its audit row. Without `tx`, the row is written on its own. The bootstrap administrator grant is written this way: inside the advisory-lock transaction that creates the role assignment.
- **Secrets are removed, not masked.**
  - Before anything is written, `before` and `after` are normalised to plain JSON, so `toJSON` output such as Dates is covered. A cyclic value fails loudly.
  - Every key naming a credential is then **removed**, at any depth and inside arrays. The rule is `isCredentialKey` (`apps/api/src/audit/credential-keys.ts`). It splits a key into lower-case words at camelCase, `_`, `-`, `.` and digit boundaries. A key is a credential when any word is `token(s)`, `secret(s)`, `password`, `passwd`, `passphrase`, `authorization`, `cookie(s)`, `credential(s)` or `apikey`; when two adjacent words are `api key`, `private key`, `secret key`, `access key`, `encryption key` or `signing key`; or when the whole key is `key`.
  - The log scrubber's broader rule (`isSensitiveKey` from `@isms/telemetry`, which also matches any key ending in `key`) is unchanged. It replaces values with `[Redacted]`. Audit snapshots drop the key instead, because a placeholder adds nothing to the history.
  - Domain keys such as `objectKey`, `sortKey`, `frameworkKey` or `keyLast4` are therefore kept in snapshots.
  - Each dropped key is logged at warn level as `{ event: "audit.credential_key_dropped", action, droppedField }`: the key name only, never the value. The field is named `droppedField` so the log scrubber does not redact it.
  - `before` and `after` are typed as `AuditSnapshot` (plain JSON), so a `Date` or `undefined` value no longer type-checks. The runtime JSON normalisation stays as defence in depth.
  - Secrets inside string values are out of scope (Ruling R15). Snapshots should therefore hold domain fields, never raw requests, headers or configuration.

## Consequences

- Snapshots are normalised to a copy; the caller's object is never changed. A snapshot that cannot be serialised (for example a cycle) makes `record` reject, which rolls back the caller's transaction, so the change is not persisted without its audit row.
- Correcting the history means appending a compensating event. Rows are never edited.
- Each new auditable action passes the caller's transaction client. Reviewers check this for every change that must be audited.
- Reading the audit trail (`audit.read`) and retention or export are later work. Retention must respect the append-only design, for example through partitioning and archive procedures run by the owner role and documented separately.
