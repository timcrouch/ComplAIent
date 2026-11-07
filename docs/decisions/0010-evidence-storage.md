# ADR-0010: Evidence storage

Status: Accepted (2026-11-05)

## Context

Reviewers attach evidence files (screenshots, exports, reports) to the controls accepted on a risk, or ask a colleague to provide one through a task. An auditor must be able to trust that a file is the one that was uploaded, unchanged, and see who added it and when. Files can be large and binary, so they do not belong in Postgres. The plan's ruling P3-R12 fixes the rules; this record says how they are built.

## Decision

- **P3-R12, as built.**
  - Evidence is **additive in any risk state**: adding it does not bump `Risk.version` and writes no `RiskVersion`. It needs `risks.review` in the risk's scope (or, for a task upload, being the task's assignee).
  - Each file links to 1–10 controls that are **accepted** on that risk; anything else is `409 controlNotAccepted`. Removing a control that has evidence is already refused (Task 9).
  - Allowed types: PDF, PNG, JPEG, WebP, plain text, CSV, DOCX, XLSX and PPTX. The declared MIME type, the file extension and the file's magic bytes must agree (`detectEvidenceType`, `@isms/domain`). Text must be valid UTF-8 with no NUL byte; the API checks the whole file, not only its head. A refusal is `400 VALIDATION_FAILED` at `file` (`evidenceTypeNotAllowed`, or `empty` for 0 bytes).
  - The stored name is cleaned (`cleanFileName`): base name only, no control or bidi characters, whitespace collapsed, at most 200 characters with the extension kept, `"evidence"` when nothing is left.
- **Transport.** Browser → BFF route handler (Origin check plus session) → API as `application/octet-stream`, with the metadata in the query string. The body is read only after authentication, the permission guard and the service's own checks (scope, accepted controls, the task being the caller's and open): on routes whose contract declares `upload`, `ContractRoute` hands the handler a `RawUpload` that reads nothing until the service asks for the file. A declared `Content-Length` over `EVIDENCE_MAX_BYTES` (25 MiB by default) is `413 PAYLOAD_TOO_LARGE` at once; a body that grows past it is `413` as soon as it does, and reading stops. Any refusal of a request whose body was not read to the end answers with `Connection: close`, so the API never drains an unwanted upload. Every other route never reads an octet-stream body.
- **Hash verification.**
  - The API computes the SHA-256 of the buffered file and sends it as `ChecksumSHA256` with the `PutObject`. The store recomputes it and refuses a mismatch; the API then answers `409 evidenceHashMismatch` and nothing is stored. The integration tests prove MinIO refuses a wrong checksum.
  - The hex digest is kept in `Evidence.sha256` (a check constraint allows only 64 lowercase hex characters) and in the `evidence.added` audit row.
  - Downloads hash the bytes as they stream to the client and hold back the last chunk until the whole file is hashed. If the digest differs from `Evidence.sha256`, the response is destroyed short of its `Content-Length`, so the client sees an incomplete transfer, never a complete wrong file, and the API logs `evidence.integrity_failure` with the evidence id only. The SDK also checks the store's own checksum (`ChecksumMode: ENABLED`). The stored digest is sent as `X-Evidence-SHA256`, which is also the client's own check of the file it saved.
  - A row whose object is missing at the store is `404 NOT_FOUND`, logged as `evidence.object_missing` with the evidence id only.
- **Immutability.**
  - Database: the app role `isms_app` has no `UPDATE`, `DELETE` or `TRUNCATE` on `Evidence` or `EvidenceControl` (Task 3's migration); the integration tests prove it. There is no API to change or delete evidence.
  - Store: each file is written once under a new key, `evidence/<uuid v7>` (the same id as the row), with `If-None-Match: *`, so an existing object is never overwritten. The same file name uploaded twice is two objects.
- **Order of writes.** The object is written first. Then one transaction locks the risk `FOR SHARE` (so a control cannot be removed meanwhile), re-checks the controls (and, for a task, locks the task and checks it is still open), inserts `Evidence` and `EvidenceControl`, and records `evidence.added` (and `task.completed`). If that transaction fails, the API deletes the object (best effort) and logs `evidence.orphan_cleanup` with the key only. A failed delete is logged as `evidence.orphan_cleanup_failed`; such an object has no row and cannot be reached through the API.
- **Downloads.** `GET /api/v1/evidence/{id}/content` declares `me.read` (ruling PF4): a viewer of the risk (it is visible to them and they hold `risks.read` in its scope) or the assignee of the task the evidence completed may download it; anyone else gets 404. The response is always `Content-Disposition: attachment; filename*=UTF-8''…`, with `X-Content-Type-Options: nosniff` and `Cache-Control: private, no-store`, so a file is never rendered in the application's origin.
- **Evidence requests.** A request is a `Task` (`evidence_request`) for one accepted control, assigned to any person. The assignee sees it under `GET /api/v1/me/tasks` with the risk's reference only, never the risk record. Uploading against the task links its control, sets it `done` and records the assignee as `completedById`; a second upload is `409 taskClosed`. Only an `evidence_request` completes by upload: any other task kind is `409 invalidTransition` (a treatment action completes with its note through `POST /api/v1/tasks/{id}/complete`).
- **Configuration and readiness.** The API requires `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` and `S3_FORCE_PATH_STYLE` (P3-R15), and `/api/v1/ready` reports `storage` (a `HeadBucket`, cancelled after the 2 s check timeout). Locally this is the compose stack's MinIO; the integration tests and e2e derive the values from the MinIO settings, and the integration tests keep their objects in their own bucket (`isms-evidence-test`).

## Consequences

- An evidence file can only be corrected by uploading a new one; the wrong one stays, visible and audited.
- The API buffers each upload in memory (at most `EVIDENCE_MAX_BYTES` per request) before hashing it, but only for an authenticated caller allowed to add that evidence.
- **Production storage moves to Plan 4.** This slice runs on MinIO in the local stack. Plan 4 chooses the production store (an EU-hosted S3-compatible service or MinIO operated with the installation), its bucket policy, server-side encryption, object lock / retention for immutability at the store, versioning, backup, and the deletion of orphaned objects.
