# Plan 2 — Domain Model, Control Library and Organisation Setup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An administrator can sign in to a fresh installation and set up the organisation in a guided Clear Glass flow, and Professional users can browse, search, review and export a seeded in-house control library mapped to ISO 27001:2022 Annex A, GDPR and NIS2.

**Architecture:** New Prisma models and hand-reviewed migrations in `packages/database`. The control library is a new package, `@isms/control-library`, holding versioned JSON content, a Zod schema, validation and an idempotent sync that runs as the owner role (`pnpm db:seed`). The API gains a `library` and an `organisation` module, user and role endpoints in `identity`, and scoped permission evaluation in `authorization`. The web BFF gains one server-side call path (`callApi`) used by pages and server actions, the setup flow under `/setup`, and the library browser under `/library`.

**Tech Stack:** As in Plan 1 (Node 26, TypeScript 6.0 strict, NestJS 12, Next.js 16.4.3 with `--webpack`, Zod 4, Prisma 7.10 with `@prisma/adapter-pg`, PostgreSQL 17, Vitest, Playwright with `@axe-core/playwright`). No new runtime dependencies except the workspace package `@isms/control-library`.

**Spec:** `docs/superpowers/specs/2026-11-03-isms-foundation-design.md`. Plan 2 owns §8.0, §9 (except the behaviour of Risk, RiskVersion, RiskControl, RiskAsset, Evidence, Task, Approval and AiInteraction, which is Plan 3) and the role and scope foundations of §10. The binding directives are in `docs/directives/`. Plan 1 (`docs/superpowers/plans/2026-11-03-plan-1-platform-foundation.md`) and its ledger (`.superpowers/sdd/2026-11-03-plan-1-platform-foundation/`) define the interfaces this plan builds on.

**Plan series.** This is Plan 2 of 4. Plan 3: the risk slice, AI gateway (including `suggestFrameworks`), admin AI settings. Plan 4: Terraform, Entra ID, backups and restore, ASVS checklist.

## Scope rulings (controller, binding)

- **In Plan 2:**
  - (a) Domain model and migrations:
    - Organisation (single row), Site, Department.
    - Site and department scopes on RoleAssignment.
    - Framework → FrameworkVersion → Requirement.
    - Control ↔ ControlRequirementMapping with review status (unreviewed, or reviewed by name and date).
    - OrganisationFramework (suggested/confirmed, reasoning, unverified until confirmed).
    - Asset (minimal).
    - RiskScale: a default 5×5 with plain-language labels and a default appetite threshold.
    - A persisted view-mode preference, defaulted by role.
  - (b) The control library:
    - In-house plain-language controls covering what ISO 27001:2022 Annex A addresses, plus GDPR Art. 5, 24, 25, 28, 30 and 32–35, and NIS2 Art. 21(2).
    - Mapped by reference ID only.
    - Versioned seed files validated by Zod and tests.
    - An ADR on provenance.
  - (c) First-run setup (§8.0), admin only, guided and audited: profile, sites, headcount, manual framework choice, risk appetite, and role assignment for users who have signed in.
  - (d) A Professional-view library browser: search, mapping review status, CISO review (audited), CSV export.
  - (e) Plan 1 carry-overs:
    - audit key-stripping redesign and lastSeenAt throttling (R30);
    - scoped permission evaluation in services (R19);
    - view-mode persistence;
    - the deferred minors listed below.
- **AI framework suggestion is not in Plan 2.**
  - The admin chooses frameworks manually, and they are stored as `confirmed`, `source: manual`.
  - `OrganisationFramework.status = suggested`, `source = ai` and `reasoning` are the seam for Plan 3's `suggestFrameworks`.
  - There are no rule-based or fake "AI" hints anywhere.
- **Not in Plan 2:**
  - risk workflow, evidence, approvals, AI gateway, admin AI settings (Plan 3);
  - Terraform, Entra, backups, ASVS (Plan 4);
  - in-app creation or editing of controls;
  - an asset API.
  - npm dependency updates: Dependabot's npm updater supports Node 24 only and fails on `engines.node >=26`. Docker and GitHub Actions updates still work. Moving npm updates to Renovate needs the owner to install the Renovate GitHub app, so it is an owner decision, not a Plan 2 task. Until then, npm versions are bumped by hand at the start of each plan.

## Plan-level rulings (this plan's author; each with its cost if wrong)

- **P2-R1:** `RoleAssignment.scopeId` is replaced by `siteId` and `departmentId`, nullable, each a foreign key with `ON DELETE RESTRICT`. A check constraint ties the scope type to the columns. The DTO keeps `scope: { type, id }`. *Cost if wrong:* one migration back to a polymorphic id, enforced by triggers.
- **P2-R2:** The app role may only read library tables. The one exception is `UPDATE` on `ControlRequirementMapping("reviewedById","reviewedAt")`. Content is written only by `pnpm db:seed`, running as `isms_owner`. *Cost if wrong:* in-app control editing (a later plan) needs a grant migration.
- **P2-R3:** No requirement ships `fullText`, including GDPR and NIS2. Every title is our own paraphrase in sentence form. *Cost if wrong:* official EU text, which may be reused, could be added later as plain content.
- **P2-R4:** Risk-scale labels are installation data in the database, in English, like the control library. They are not in `en.json`. *Cost if wrong:* moving the default labels into message files for translation.
- **P2-R5:** Granting and revoking roles are `recentAuth` routes (ADR-0005 names role assignment as sensitive). The web handles step-up with `max_age=0`. *Cost if wrong:* admins re-enter their password during setup after 5 minutes. To undo, drop the flag.
- **P2-R6:** e2e runs against `isms_test`. The API's `DATABASE_URL` is set to `DATABASE_TEST_URL`. The `setup` project resets that database and seeds the shipped library. A guard fails the run if the API is still on the dev database (for example, a reused local `pnpm dev`). *Cost if wrong:* developers must stop `pnpm dev` before `pnpm e2e`.
- **P2-R7:** `User.viewMode` NULL means "not chosen". The default is `professional` for administrator, ciso, risk_owner, risk_approver and auditor, and `guided` otherwise. *Cost if wrong:* a one-line table change.
- **P2-R8:** A `409 CONFLICT` carries machine reasons as `details[].path = "<reason>"` or `"<reason>.<item>"`, from `ConflictReasonSchema`. The web maps reasons to `en.json` and never shows API message text. *Cost if wrong:* a contract field change.
- **P2-R9:** Risk score = likelihood × impact. "Above appetite" means `score > appetiteThreshold`. The default threshold is 9. The UI presets are cautious 4, balanced 9 and bold 14. The API accepts 1–24. These pure functions live in `@isms/domain`. The web uses them only for a preview, and the API is authoritative. *Cost if wrong:* changing constants plus Plan 3 approval routing.
- **P2-R10:** Scoped evaluation is per permission, through a `SCOPED_PERMISSIONS` set, which is empty in Plan 2; Plan 3 adds risk permissions. For a scoped permission, the route guard accepts it held at any scope, the service checks the resource, and `permissionsFor` reports it. This keeps R21: `/me` equals what the guard grants. *Cost if wrong:* a guard refactor in Plan 3.
- **P2-R11:** Library sync never deletes anything. Existing mappings keep their review. A change in a control's meaning needs a new control code. *Cost if wrong:* stale reviews after content edits (ADR-0008 records the rule).
- **P2-R12:** CSV is produced by the web BFF from a JSON export contract. *Cost if wrong:* moving `toCsv` behind the API.
- **P2-R13:** `lastSeenAt` is written at most every 5 minutes per user. A change to email or display name is written at once. *Cost if wrong:* a constant.
- **P2-R14:** The baseline permissions (every authenticated user) become `me.read`, `me.update` and `organisation.read`. Organisation name, sites and setup status are not secret from members. *Cost if wrong:* moving `organisation.read` into `ROLE_PERMISSIONS`.

## Global Constraints

- Node **26 LTS**, pnpm **10.28.2**, TypeScript **6.0.x** (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`), Prisma **7.10.x** stable (never 8.0 release candidates), exact pinned versions, committed `pnpm-lock.yaml`.
- Every source file and every content JSON file stays under **500 lines**, including `apps/web/messages/en.json`.
- TDD in every task: write the failing test, see it fail (RED), implement, see it pass (GREEN). Vitest everywhere, with `unplugin-swc` for NestJS.
- No secrets in code or committed files. Logs never contain tokens, cookies, keys or passwords.
- All user-facing text lives in `apps/web/messages/en.json` (next-intl). No inline UI strings. Every `@isms/ui` label is passed from `en.json` (R25).
- All business rules and permission checks live in the API. The web hides only what `/me` permissions or API results say is unavailable.
- API base path `/api/v1`. Every error uses `{ error: { code, message, requestId, details? } }`. Every new contract route declares a `permission`. The OpenAPI snapshot is updated intentionally (`vitest -u`) in the task that changes routes or permissions.
- Dates cross the API as ISO-8601 strings (`z.iso.datetime()`). Services convert `Date` values with `toISOString()`.
- Every state-changing endpoint writes its audit row in the same transaction as the change, passing `tx` (ADR-0006). Snapshots are built from explicit domain fields (`AuditSnapshot`, Task 1), never from raw request bodies or Prisma rows.
- **No ISO text anywhere in the repository.** That covers code, content, tests, fixtures, comments, ADRs and commit messages. ISO/IEC 27001 is referenced by name and reference number only (`A.5.1`). Annex A titles are never reproduced, even short ones.
- **No AI in Plan 2.** No AI calls. Nothing is labelled as suggested or recommended by a machine.
- WCAG 2.2 AA:
  - Every new page passes `@axe-core/playwright` with tags `wcag2a, wcag2aa, wcag21a, wcag21aa, wcag22aa, best-practice`, in light and dark.
  - Status is always an icon plus words, never colour alone.
  - Interactive targets are at least 24×24 px, with visible focus.
  - Errors are identified in text and linked with `aria-invalid` and `aria-describedby`.
  - Async results are announced in a `role="status"` region.
  - Reduced motion is respected.
- No customer-specific names, data or copy anywhere.
- Migrations are hand-reviewed, one per schema task, and `pnpm db:migrate:test && pnpm db:validate` reports no difference. The default privileges give `isms_app` full DML on every new table. Any table that needs less gets explicit `REVOKE`/`GRANT` statements in its migration, and a test.
- Branch `feat/plan-2-domain-and-setup` from `main`. Commit after each task. Never force-push `main`. Rulings R1–R33 in `.superpowers/sdd/2026-11-03-plan-1-platform-foundation/progress.md` still bind (notably R3, R10, R11, R19, R21, R22, R25, R26).

## Review Focus

1. **Double submit, or two administrators editing setup at once.** Expect exactly one Organisation row, no duplicate sites, and no half-applied site list. Setup writes are serialised by an advisory lock, and the single row is enforced by the database. *Test: Task 11, "two concurrent profile saves leave exactly one organisation row" and "two concurrent site saves leave one consistent list".*
2. **Removing the last administrator.** This covers self-demotion, and two administrators revoking each other at the same moment. Expect a plain refusal, and exactly one administrator left. *Test: Task 9, "two administrators revoking each other at once leave exactly one".*
3. **Removing a site or department that a role assignment still uses.** Expect a plain message on that row, and nothing applied from the same save. *Test: Task 11, "refuses to remove a site a role assignment uses, and changes nothing".*
4. **Hostile or odd search input.** This covers `%`, `_`, `\`, quotes, tsquery operators (`& | ! :* ( )`), and 201 characters. Expect no 500, no match-everything, and a 400 only for an over-long query. *Test: Task 10, "treats wildcards and tsquery syntax as plain text".*
5. **Re-running `pnpm db:seed` after a CISO has reviewed mappings.** Reviews, and any installation-imported `fullText`, must survive. *Test: Task 2, "keeps a mapping's review and a requirement's fullText when synced again".*

## Plan 1 deferred minors picked up

| Minor (ledger) | Where |
|---|---|
| Audit key-stripping over-removes (`key$`) — R30 | Task 1 |
| lastSeenAt written on every request — R30 | Task 1 |
| Scoped checks in services — R19 | Task 9 |
| View mode display-only — Plan 1 Task 12 note | Task 8 |
| T5: default privileges make append-only opt-out for new tables (document) | Task 2 (ADR-0008 and migration comment), Task 7 (RiskScale grants) |
| T5: schema comment on `@@unique` must point at the NULLS NOT DISTINCT migration | Task 7 (the index is recreated; the comment is re-pointed) |
| T12: aria-disabled setup button keeps hover/press styles | Task 13 (the button becomes a real link) |
| T12: `ASSET_EXTENSIONS` rewrite can hide dynamic routes (comment needed) | Task 14 (comment; the export route has no extension) |
| T11: `apiCall` has no response size limit | Task 14 (5 MB cap, before the export) |

Not picked up, because Plan 2 does not touch the code: T1, T2, T3, T4, T6 (the log scrubber stays as it is, because over-redaction in logs fails safe), T7, T9, T10, T13, and the rest of T11/T12.

---

## File Structure

```text
packages/database/prisma/schema.prisma                      + library, organisation, risk scale, asset models
packages/database/prisma/migrations/20261104000000_control_library/
packages/database/prisma/migrations/20261104000100_organisation_setup/
packages/database/prisma/migrations/20261104000200_view_mode_default/
packages/control-library/  content/{manifest.json, frameworks/*.json, controls/*.json}
                           src/{schema.ts, load.ts, validate.ts, references.ts, themes.ts, sync.ts, testing.ts, index.ts, cli/seed.ts}
packages/domain/src/       risk-scale.ts, countries.ts
packages/contracts/src/    conflicts.ts, routes/{identity,people,library,organisation}.ts, permissions.ts
apps/api/src/audit/        credential-keys.ts, audit.service.ts
apps/api/src/identity/     view-mode.ts, role-scope.ts, users.controller.ts, role-assignment.service.ts
apps/api/src/authorization/ policy.service.ts, scoped-permissions.ts
apps/api/src/library/      library.module.ts, library.controller.ts, control-query.service.ts, control-search.ts,
                           mapping-review.service.ts, framework-catalog.service.ts, mappers.ts, index.ts
apps/api/src/organisation/ organisation.module.ts, organisation.controller.ts, organisation.service.ts,
                           organisation-units.service.ts, organisation-frameworks.service.ts,
                           risk-scale.service.ts, default-risk-scale.ts, setup-lock.ts, index.ts
apps/web/lib/              server-api.ts, page-result.tsx, csv.ts, actions/{view-mode,setup,roles,library}.ts
apps/web/app/(app)/setup/  page.tsx, {organisation,sites,frameworks,risk-appetite,people,review}/page.tsx
apps/web/app/(app)/library/ page.tsx, [code]/page.tsx, export/route.ts
apps/web/components/setup/ setup-frame.tsx, steps.ts, profile-form.tsx, units-form.tsx, frameworks-form.tsx,
                           appetite-form.tsx, appetite-grid.tsx, people-list.tsx, role-dialog.tsx, review-summary.tsx
apps/web/components/library/ control-list.tsx, control-filters.tsx, control-detail.tsx, mapping-row.tsx
apps/web/components/shell/ nav-items.ts (+ primary-nav, command-palette-host, view-mode-switch changes)
packages/ui/src/components/ field.tsx, textarea.tsx, select.tsx
e2e/                       db.ts, org-setup.spec.ts, library.spec.ts (+ auth.setup.ts, playwright.config.ts changes)
docs/decisions/0008-control-library-provenance.md (+ updates to 0004, 0005, 0006)
```

---

### Task 1: Audit snapshots that keep domain keys, and throttled lastSeenAt writes

**Files:**
- Create: `apps/api/src/audit/credential-keys.ts`
- Modify: `apps/api/src/audit/audit.service.ts`, `apps/api/src/audit/index.ts`, `apps/api/src/identity/user-provisioning.service.ts`
- Modify: `docs/decisions/0006-audit-history.md` (the "Secrets are removed" section), `docs/decisions/0004-authentication-bff.md` (the provisioning bullet and the consequence about the per-request upsert)
- Test: `apps/api/test/audit/credential-keys.test.ts` (new), `apps/api/test/audit/audit.int.test.ts`, `apps/api/test/identity/me.int.test.ts`

**Interfaces:**
- Consumes: `AuditService.record(e, ctx, tx?)` and `UserProvisioningService.resolve` (Plan 1).
- Produces:
  - `isCredentialKey(key: string): boolean`. The key is split into lower-case words at camelCase, `_`, `-`, `.` and digit boundaries. It is a credential when:
    - any word is in `{token, tokens, secret, secrets, password, passwd, passphrase, authorization, cookie, cookies, credential, credentials, apikey}`; or
    - two adjacent words are `api key`, `private key`, `secret key`, `access key`, `encryption key` or `signing key`; or
    - the whole key is the single word `key`.
  - `type AuditJson = string | number | boolean | null | readonly AuditJson[] | AuditSnapshot` and `type AuditSnapshot = { readonly [key: string]: AuditJson }`. `AuditEventInput.before` and `after` become `AuditSnapshot | undefined`.
  - `AuditService.record` removes credential keys at any depth. For each key it removes, it logs `warn { event: "audit.credential_key_dropped", action, key }` (the key name only, never the value).
  - `LAST_SEEN_WRITE_INTERVAL_MS = 300_000`, exported from `user-provisioning.service.ts`.

- [ ] **Step 1: Write the failing tests.**

```ts
// credential-keys.test.ts
it.each(["apiKey", "api_key", "API-KEY", "apikey", "refreshToken", "accessToken", "idToken", "clientSecret",
  "password", "newPassword", "passwd", "authorization", "Cookie", "privateKey", "encryptionKey", "secretKey",
  "aiSecretsKey", "key", "credentials"])("treats %s as a credential", (k) => expect(isCredentialKey(k)).toBe(true));
it.each(["objectKey", "sortKey", "riskKey", "frameworkKey", "primaryKey", "publicKey", "keyLast4", "monkey",
  "keyboard", "tokenizerVersion", "requirementRef"])("keeps %s", (k) => expect(isCredentialKey(k)).toBe(false));

// audit.int.test.ts (add; keep "strips secret-like keys" → still { nested: {}, ok: 1 })
it("keeps domain keys that merely end in 'key'", async () => {
  await audit.record({ action: "t", objectType: "x", objectId: "1",
    after: { objectKey: "evidence/1", sortKey: 3, frameworkKey: "iso27001", keyLast4: "abcd" } }, ctx);
  expect((await db.auditEvent.findFirstOrThrow()).afterRef)
    .toEqual({ objectKey: "evidence/1", sortKey: 3, frameworkKey: "iso27001", keyLast4: "abcd" });
});
it("logs the name, never the value, of each dropped key", async () => {
  const warn = vi.spyOn(Logger.prototype, "warn");
  await audit.record({ action: "t", objectType: "x", objectId: "1", after: { clientSecret: "s3cr3t" } }, ctx);
  expect(warn).toHaveBeenCalledWith(expect.objectContaining({ event: "audit.credential_key_dropped", key: "clientSecret" }));
  expect(JSON.stringify(warn.mock.calls)).not.toContain("s3cr3t");
});

// me.int.test.ts — app built with a controllable clock (IdentityOptions.clock); tokens signed with exp now+3600
it("does not write lastSeenAt again within 5 minutes", ...);     // call at t0, t0+299s → lastSeenAt === t0
it("writes lastSeenAt again after 5 minutes", ...);              // t0+300s → lastSeenAt === t0+300s
it("writes a changed email or name at once and refreshes lastSeenAt", ...); // t0+60s with new email → email updated, lastSeenAt === t0+60s
```

Replace the Plan 1 test "a second call updates lastSeenAt, email and name without a duplicate" with the last of these. Remove the audit test that passes a `Date`, because the type now forbids it. The runtime JSON normalisation stays as defence in depth.

- [ ] **Step 2: Run** `pnpm --filter @isms/api test -- credential-keys && pnpm --filter @isms/api test:integration -- audit me`. Expected: FAIL. `isCredentialKey` is missing, the `objectKey` and `sortKey` values are stripped, and `lastSeenAt` changes on every call.
- [ ] **Step 3: Implement.**
  - `stripSecrets` uses `isCredentialKey` instead of telemetry's `isSensitiveKey`.
  - `upsertUser` becomes find-then-write:
    - `findUnique` on `idpIssuer_idpSubject`, selecting `id`, `email`, `displayName` and `lastSeenAt`.
    - If there is no row, `create`. On P2002, read the row again and continue with the update rule below.
    - Otherwise `update` only when the email or display name differs, `lastSeenAt` is null, or `now - lastSeenAt >= LAST_SEEN_WRITE_INTERVAL_MS`.
  - Update ADR-0006: the audit rule is now `isCredentialKey`, the log scrubber's broader rule is unchanged, and dropped keys are logged by name. Update ADR-0004: `lastSeenAt` is written at most every 5 minutes, and profile changes are written at once.
- [ ] **Step 4: Run** the same commands, then `pnpm --filter @isms/api test:integration`. Expected: PASS.
- [ ] **Step 5: Commit** with `fix(api): audit keeps domain keys ending in key; throttle lastSeenAt writes`.

### Task 2: Library data model and the `@isms/control-library` package

**Files:**
- Modify: `packages/database/prisma/schema.prisma`
- Create: `packages/database/prisma/migrations/20261104000000_control_library/migration.sql`
- Create: `packages/control-library/{package.json,tsconfig.json,eslint.config.js,vitest.config.ts,vitest.integration.config.ts}`
- Create: `packages/control-library/src/{schema.ts,load.ts,validate.ts,references.ts,sync.ts,testing.ts,index.ts,cli/seed.ts}`, `packages/control-library/content/manifest.json`
- Modify: root `package.json` (scripts `db:seed`, `db:seed:test`)
- Create: `docs/decisions/0008-control-library-provenance.md`
- Test: `packages/control-library/test/{schema.test.ts,validate.test.ts,load.test.ts,sync.int.test.ts}`, `packages/database/test/library-grants.int.test.ts`

**Interfaces:**
- Consumes: `createPrismaClient`, `PrismaClient` and `resetTestDatabase` (`@isms/database`, `@isms/database/testing`); `databaseOwnerConfig` and `databaseTestConfig` (`@isms/config`).
- Produces (Prisma):
  - `enum ControlCategory { governance privacy suppliers assets access people physical operations resilience incidents development }`
  - `Framework { id, key @unique, name, publisher, summary }`
  - `FrameworkVersion { id, frameworkId, key @unique, label }`
  - `Requirement { id, frameworkVersionId, ref, title, fullText String?, sortOrder Int; @@unique([frameworkVersionId, ref]) }`
  - `Control { id, code @unique, title, description, guidance String[], category ControlCategory, libraryVersion }`
  - `ControlRequirementMapping { id, controlId, requirementId, reviewedById String? (→ User), reviewedAt DateTime?, createdAt; @@unique([controlId, requirementId]) }`
  - Every foreign key is `ON DELETE RESTRICT`. There is no `@updatedAt` on the mapping.
- Produces (migration SQL, in addition to the generated DDL):
  - `CHECK (("reviewedById" IS NULL) = ("reviewedAt" IS NULL))`
  - `REVOKE INSERT, UPDATE, DELETE, TRUNCATE` on `Framework`, `FrameworkVersion`, `Requirement`, `Control` and `ControlRequirementMapping` `FROM isms_app`
  - `GRANT UPDATE ("reviewedById", "reviewedAt") ON "ControlRequirementMapping" TO isms_app`
  - A comment: new tables get full DML from the default privileges; restrict them explicitly here.
- Produces (package `@isms/control-library`; exports `.` and `./testing`; `files: ["dist", "content"]`):
  - Schemas:
    - `ManifestSchema = { libraryVersion: /^\d{4}\.\d{2}\.\d+$/, frameworks: string[], controls: string[] }`
    - `FrameworkFileSchema = { framework: { key, name, publisher, summary }, version: { key, label }, requirements: { ref, title }[] (min 1) }`
    - `ControlFileSchema = { controls: ControlEntry[] }`
    - `ControlEntry = { code: /^(GOV|PRV|SUP|AST|ACC|PPL|PHY|OPS|RES|INC|DEV)-\d{2}$/, title, description, guidance: string[], category: ControlCategory, mappings: { framework: string /* version key */, ref: string }[] (min 1) }`
    - All `.strict()`. There is no `fullText` field anywhere in content.
  - `type LibraryContent = { libraryVersion: string; frameworks: FrameworkFile[]; controls: ControlEntry[] }`
  - `loadLibrary(contentDir?: URL): LibraryContent`. The default is `new URL("../content/", import.meta.url)`. It reads synchronously, and on failure throws `LibraryError` with a message `<file>: <path>: <problem>`.
  - `validateLibrary(lib: LibraryContent): LibraryIssue[]`, with `LibraryIssue = { rule: LibraryRule; message: string }`. `LibraryRule` is one of:
    - `"duplicate-framework-version"`
    - `"duplicate-requirement-ref"`
    - `"duplicate-control-code"`
    - `"code-category-mismatch"` (the prefix map is GOV→governance, PRV→privacy, SUP→suppliers, AST→assets, ACC→access, PPL→people, PHY→physical, OPS→operations, RES→resilience, INC→incidents, DEV→development)
    - `"unknown-framework-version"`
    - `"unknown-requirement"`
    - `"duplicate-mapping"`
  - `coverageGaps(lib: LibraryContent): { framework: string; ref: string }[]` lists the requirements no control maps to.
  - `references.ts`:
    - `ANNEX_A_2022_REFS`: `A.5.1`…`A.5.37`, `A.6.1`…`A.6.8`, `A.7.1`…`A.7.14`, `A.8.1`…`A.8.34` (93, generated from those counts).
    - `GDPR_REFS = ["Art. 5(1)(a)","Art. 5(1)(b)","Art. 5(1)(c)","Art. 5(1)(d)","Art. 5(1)(e)","Art. 5(1)(f)","Art. 5(2)","Art. 24","Art. 25(1)","Art. 25(2)","Art. 28","Art. 30","Art. 32","Art. 33","Art. 34","Art. 35"]`
    - `NIS2_REFS = ["Art. 21(2)(a)", …, "Art. 21(2)(j)"]` (10).
    - `isoRange(from: string, to: string): string[]`, inclusive, within one clause.
  - `syncControlLibrary(db: PrismaClient, lib: LibraryContent): Promise<SyncSummary>` runs in one transaction:
    - upserts `Framework` by `key`, `FrameworkVersion` by `key`, and `Requirement` by `(version, ref)` (updating `title` and `sortOrder` from the array index, and never touching `fullText`);
    - upserts `Control` by `code`;
    - creates missing mappings, left unreviewed;
    - never deletes.
  - `SyncSummary = { libraryVersion; frameworks: number; requirements: number; controls: number; mappingsCreated: number; orphanedMappings: number }`
  - `FIXTURE_LIBRARY: LibraryContent` (`./testing`), exactly:
    - Frameworks:
      - `iso27001-2022` (framework `iso27001`, name `ISO/IEC 27001`), requirements `A.5.1` "Leadership sets and approves the organisation's security rules." and `A.8.13` "Important information is copied regularly and can be restored when needed."
      - `gdpr-2016-679` (framework `gdpr`, name `GDPR`), requirement `Art. 32` "Personal data is protected by security measures that suit the risk."
    - Controls:
      - `GOV-01` "Agree and publish your security rules" (governance) → A.5.1
      - `RES-01` "Back up important data and test restores" (resilience; the description mentions "backups") → A.8.13 and Art. 32
      - `ACC-01` "Give people only the access they need" (access) → Art. 32
    - `libraryVersion` is `"2026.11.0-test"`.
  - CLI `src/cli/seed.ts`:
    - It uses `DATABASE_OWNER_URL`, or `DATABASE_OWNER_TEST_URL` with `--test`.
    - It loads and validates. On any issue it exits 1 and lists the issues.
    - Otherwise it syncs, prints the summary, and prints coverage gaps as warnings.
    - Package scripts: `seed` = `tsx --env-file=../../.env src/cli/seed.ts`, and `seed:test` adds `--test`.
  - Root scripts: `db:seed` = `pnpm --filter @isms/control-library seed`, and `db:seed:test` likewise.
  - The content manifest starts as `{ "libraryVersion": "2026.11.0", "frameworks": [], "controls": [] }`.

- [ ] **Step 1: Write the failing tests.**

```ts
// validate.test.ts — each case mutates a structuredClone(FIXTURE_LIBRARY)
it("accepts the fixture library", () => expect(validateLibrary(FIXTURE_LIBRARY)).toEqual([]));
it.each([
  ["duplicate-control-code", (l) => l.controls.push({ ...l.controls[0]! })],
  ["code-category-mismatch", (l) => { l.controls[0]!.category = "privacy"; }],
  ["unknown-framework-version", (l) => { l.controls[0]!.mappings[0]!.framework = "iso27001-2013"; }],
  ["unknown-requirement", (l) => { l.controls[0]!.mappings[0]!.ref = "A.9.9"; }],
  ["duplicate-mapping", (l) => l.controls[0]!.mappings.push({ ...l.controls[0]!.mappings[0]! })],
  ["duplicate-requirement-ref", (l) => l.frameworks[0]!.requirements.push({ ...l.frameworks[0]!.requirements[0]! })],
  ["duplicate-framework-version", (l) => l.frameworks.push(structuredClone(l.frameworks[0]!))],
])("reports %s", (rule, mutate) => { /* expect issues.map(i => i.rule) toContain rule */ });
it("names the control and the reference in unknown-requirement", ...); // message contains "GOV-01" and "iso27001-2022 A.9.9"
it("coverageGaps lists unmapped requirements", ...);                   // drop GOV-01 → [{ framework: "iso27001-2022", ref: "A.5.1" }]
it("ANNEX_A_2022_REFS has 93 entries from A.5.1 to A.8.34", ...);     // length 93, [0] "A.5.1", at(-1) "A.8.34", includes "A.6.8", "A.7.14"
// schema.test.ts
it("rejects a fullText field in a framework file", ...);              // strict → error
it("rejects a control without mappings", ...);
// load.test.ts — temp dir content
it("names the file and the path of a schema error", ...);             // LibraryError message matches /controls\/bad\.json: controls\.0\.code/
// sync.int.test.ts (owner client on isms_test; resetTestDatabase in beforeEach)
it("creates frameworks, requirements, controls and unreviewed mappings", ...); // counts 2/3/3/4, all reviewedAt null
it("is idempotent", ...);                                              // second summary.mappingsCreated === 0, counts unchanged
it("keeps a mapping's review and a requirement's fullText when synced again", ...);
it("updates control text from the content", ...);                     // change RES-01 title → row title updated
it("never deletes; reports mappings missing from the content", ...);  // remove ACC-01's mapping → summary.orphanedMappings === 1, row still there
// library-grants.int.test.ts (app role vs owner)
it("the app role reads the library but cannot change content", ...);  // UPDATE "Control" SET title → /permission denied/
it("the app role can record a review and nothing else on a mapping", ...); // UPDATE reviewedById+reviewedAt OK; UPDATE "createdAt" → /permission denied/
it("a review needs both reviewer and date", ...);                     // owner sets reviewedAt only → check violation
```

- [ ] **Step 2: Run** `pnpm --filter @isms/control-library test`, then `pnpm db:migrate:test && pnpm --filter @isms/control-library --filter @isms/database test:integration`. Expected: FAIL, because the package and tables are missing.
- [ ] **Step 3: Implement** the schema, the migration and the package.
  - Follow the existing package pattern: tooling base config and the `isms-dist` export condition.
  - ADR-0008, *Control library provenance and licensing*, records:
    - The content is authored in-house, with AI assistance, from general knowledge of the topics each reference point addresses. The standard's text was not used.
    - ISO is referenced by number only. Requirement titles are our own sentence-form paraphrases. No `fullText` ships (P2-R3).
    - GDPR and NIS2 are EU law, reusable under Commission Decision 2011/833/EU, but we ship paraphrases for consistency.
    - Installations may later import their licensed text into `Requirement.fullText` through an owner-run import.
    - Mappings ship unreviewed and are reviewed in-app or through a CSV review.
    - The version scheme is `YYYY.MM.patch`.
    - Sync semantics follow P2-R11. The app-role grants follow P2-R2. The default-privileges note is the deferred T5 minor.
- [ ] **Step 4: Run** the same commands plus `pnpm db:validate && pnpm boundaries`. Expected: PASS, and "No difference detected."
- [ ] **Step 5: Commit** with `feat(library): control library schema, content package, validation and owner-run sync`.

### Task 3: Framework requirement content (ISO 27001:2022 Annex A, GDPR, NIS2)

**Files:**
- Create: `packages/control-library/content/frameworks/{iso27001-2022.json,gdpr-2016-679.json,nis2-2022-2555.json}`
- Modify: `packages/control-library/content/manifest.json`
- Test: `packages/control-library/test/content.test.ts` (new)

**Interfaces:**
- Consumes: `loadLibrary`, `validateLibrary`, `ANNEX_A_2022_REFS`, `GDPR_REFS`, `NIS2_REFS` (Task 2).
- Produces (later tasks map to exactly these keys and refs):

| Version key | Framework key / name / publisher | Version label | Refs |
|---|---|---|---|
| `iso27001-2022` | `iso27001` / `ISO/IEC 27001` / `ISO/IEC` | `2022` | `ANNEX_A_2022_REFS` in order |
| `gdpr-2016-679` | `gdpr` / `GDPR` / `European Union` | `Regulation (EU) 2016/679` | `GDPR_REFS` in order |
| `nis2-2022-2555` | `nis2` / `NIS2` / `European Union` | `Directive (EU) 2022/2555` | `NIS2_REFS` in order |

- **Title rule (enforced by test):**
  - One English sentence in our own words that states the intended outcome. Start with an upper-case letter, end with `.`, and use 5–16 words.
  - Never the standard's noun-phrase title, and never copied wording.
  - Write it as what good looks like, for example "People can report security events quickly and know how." Do not write it as a heading.
- **Summaries** are plain-language "what it is and when it applies", at most 300 characters. They are shown in setup. For example, for NIS2: "EU law on cybersecurity for essential and important organisations in sectors such as manufacturing, digital services and energy. Check whether it applies to you."

- [ ] **Step 1: Write the failing tests** in `content.test.ts`. `refsOf` and `allRequirements` are small helpers local to the test:

```ts
const lib = loadLibrary();
it("the shipped library loads and passes validation", () => expect(validateLibrary(lib)).toEqual([]));
it("ISO 27001:2022 lists exactly the 93 Annex A reference points", () =>
  expect(refsOf(lib, "iso27001-2022")).toEqual([...ANNEX_A_2022_REFS]));
it("GDPR lists the pinned articles", () => expect(refsOf(lib, "gdpr-2016-679")).toEqual([...GDPR_REFS]));
it("NIS2 lists Art. 21(2)(a) to (j)", () => expect(refsOf(lib, "nis2-2022-2555")).toEqual([...NIS2_REFS]));
it("requirement titles are own-words sentences", () => {
  for (const r of allRequirements(lib)) {
    expect(r.title).toMatch(/^[A-Z].*\.$/);
    expect(r.title.split(/\s+/).length).toBeGreaterThanOrEqual(5);
    expect(r.title.split(/\s+/).length).toBeLessThanOrEqual(16);
  }
});
it("framework summaries are at most 300 characters", ...);
it("every content file stays under 500 lines", ...); // walk content/ recursively
```

- [ ] **Step 2: Run** `pnpm --filter @isms/control-library test -- content`. Expected: FAIL, because the frameworks are missing.
- [ ] **Step 3: Author** the three files and list them in the manifest. Write requirement entries one per line (`{ "ref": "A.5.1", "title": "…" }`) to keep the files short. Self-check each title against the rule above before committing.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** with `feat(library): ISO 27001:2022 Annex A, GDPR and NIS2 reference points with own-words titles`.

### Task 4: Controls I — governance, compliance, personal data and suppliers

**Files:**
- Create: `packages/control-library/content/controls/{governance.json,privacy.json,suppliers.json}`, `packages/control-library/src/themes.ts`
- Modify: `packages/control-library/content/manifest.json`, `packages/control-library/src/index.ts`
- Test: `packages/control-library/test/themes.test.ts` (new)

**Interfaces:**
- Consumes: Task 2 schema and validation; Task 3 keys and refs.
- Produces:
  - `type Theme = { key: string; files: string[]; iso: string[]; gdpr: string[]; nis2: string[] }`
  - `THEMES: Theme[]`. Tasks 5 and 6 append to it.
  - This task's entry is `{ key: "governance-privacy-suppliers", files: ["controls/governance.json","controls/privacy.json","controls/suppliers.json"] }`, with:
    - `iso`: `isoRange("A.5.1","A.5.8")`, `isoRange("A.5.19","A.5.23")` and `isoRange("A.5.31","A.5.37")`
    - `gdpr`: `Art. 5(1)(a)`–`(f)`, `Art. 5(2)`, `Art. 24`, `Art. 25(1)`, `Art. 25(2)`, `Art. 28`, `Art. 30`, `Art. 35`
    - `nis2`: `Art. 21(2)(a)`, `(d)`, `(f)`
  - Category prefixes: GOV, PRV, SUP.
- **Authoring rules for Tasks 4–6, enforced by tests where marked (T):**
  - `title`: 3–12 words (T), no trailing period (T), and a plain verb-led instruction a non-specialist understands, for example "Keep a list of the information and equipment you rely on". Never an ISO title or paraphrase-by-substitution. Start from the problem the control solves.
  - `description`: 1–3 sentences, at most 400 characters (T). It says what good looks like and why it matters.
  - `guidance`: 2–6 items (T), each at most 200 characters (T). Each is a concrete step a mid-sized organisation can take. Use no product or company names.
  - `mappings`:
    - Map a control only to reference points whose intent it genuinely addresses, usually 1–4 ISO refs plus any GDPR or NIS2 refs.
    - Never add a mapping only to reach coverage.
    - A reviewer will check every mapping against their own licensed copy of the standard.
    - Wrong mappings are a credibility risk; when unsure, map less.
  - Codes are numbered from `01` per prefix, without gaps.

- [ ] **Step 1: Write the failing tests** in `themes.test.ts`. `mappedRefs` is a helper local to the test:

```ts
it.each(THEMES.map((t) => [t.key, t] as const))("theme %s covers its assigned references", (_k, theme) => {
  const mapped = mappedRefs(lib, theme.files);           // Set of "<versionKey> <ref>" from that theme's files only
  for (const ref of theme.iso) expect(mapped).toContain(`iso27001-2022 ${ref}`);
  for (const ref of theme.gdpr) expect(mapped).toContain(`gdpr-2016-679 ${ref}`);
  for (const ref of theme.nis2) expect(mapped).toContain(`nis2-2022-2555 ${ref}`);
});
it("control text follows the authoring rules", ...);    // all controls: title words 3–12, no trailing ".", description ≤ 400, guidance 2–6 items ≤ 200
it("control codes are numbered from 01 without gaps per prefix", ...);
```

- [ ] **Step 2: Run** `pnpm --filter @isms/control-library test`. Expected: FAIL, because the theme files are missing.
- [ ] **Step 3: Author** the three files, about 18–24 controls in total. Add them to the manifest and add the theme entry.
- [ ] **Step 4: Run** the same command. Expected: PASS. `content.test.ts` still passes.
- [ ] **Step 5: Commit** with `feat(library): governance, personal data and supplier controls`.

### Task 5: Controls II — assets, information handling, identity and access, people, physical

**Files:**
- Create: `packages/control-library/content/controls/{assets.json,access.json,people.json,physical.json}`
- Modify: `packages/control-library/content/manifest.json`, `packages/control-library/src/themes.ts`
- Test: `packages/control-library/test/themes.test.ts` (the new theme runs through `it.each`)

**Interfaces:**
- Consumes: Task 4 rules and `THEMES`.
- Produces: the theme `{ key: "assets-access-people-physical", files: [the four files] }`, with:
  - `iso`: `isoRange("A.5.9","A.5.18")`, `isoRange("A.6.1","A.6.8")`, `isoRange("A.7.1","A.7.14")`, `isoRange("A.8.2","A.8.5")` and `["A.8.18"]`
  - `gdpr`: `[]`
  - `nis2`: `Art. 21(2)(g)`, `(i)`, `(j)`
  - Prefixes: AST, ACC, PPL, PHY.

- [ ] **Step 1: Add the theme entry first.** The `it.each` case for it fails.
- [ ] **Step 2: Run** `pnpm --filter @isms/control-library test`. Expected: FAIL, naming the first uncovered ref.
- [ ] **Step 3: Author** the four files, about 24–30 controls, following Task 4's rules. Add them to the manifest.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** with `feat(library): asset, access, people and physical controls`.

### Task 6: Controls III — operations, resilience, incidents and secure development; full coverage

**Files:**
- Create: `packages/control-library/content/controls/{operations.json,resilience.json,incidents.json,development.json}`
- Modify: `packages/control-library/content/manifest.json`, `packages/control-library/src/themes.ts`, root `package.json` (`setup` = `pnpm infra:up && pnpm db:migrate && pnpm db:seed`), `docs/operations/local-development.md` (the seed step, and that `pnpm db:seed` is safe to re-run)
- Test: `packages/control-library/test/themes.test.ts`, `packages/control-library/test/content.test.ts`

**Interfaces:**
- Consumes: Task 4 rules and `THEMES`.
- Produces: the theme `{ key: "operations-resilience-incidents-development", files: [the four files] }`, with:
  - `iso`: `isoRange("A.5.24","A.5.30")`, `["A.8.1"]`, `isoRange("A.8.6","A.8.17")` and `isoRange("A.8.19","A.8.34")`
  - `gdpr`: `Art. 32`, `Art. 33`, `Art. 34`
  - `nis2`: `Art. 21(2)(b)`, `(c)`, `(e)`, `(h)`
  - Prefixes: OPS, RES, INC, DEV.
  - The shipped library now has no coverage gaps.

- [ ] **Step 1: Write the failing tests.** Add the theme entry. Add to `content.test.ts`:

```ts
it("every Annex A reference point A.5.1–A.8.34 is mapped at least once", () =>
  expect(coverageGaps(lib).filter((g) => g.framework === "iso27001-2022")).toEqual([]));
it("every requirement of every shipped framework is mapped at least once", () => expect(coverageGaps(lib)).toEqual([]));
it("the themes partition Annex A: each reference point is assigned to exactly one theme", ...);
```

- [ ] **Step 2: Run** `pnpm --filter @isms/control-library test`. Expected: FAIL.
- [ ] **Step 3: Author** the four files, about 26–34 controls, and wire `setup`.
- [ ] **Step 4: Run** `pnpm --filter @isms/control-library test && pnpm db:seed:test`. Expected: PASS. The CLI prints a summary with `mappingsCreated > 0` and no coverage warnings.
- [ ] **Step 5: Commit** with `feat(library): operations, resilience, incident and development controls; full coverage`.

### Task 7: Organisation domain schema — profile, sites, departments, scopes, frameworks, risk scale, assets

**Files:**
- Modify: `packages/database/prisma/schema.prisma`
- Create: `packages/database/prisma/migrations/20261104000100_organisation_setup/migration.sql`
- Create: `apps/api/src/identity/role-scope.ts`
- Modify: `apps/api/src/identity/user-provisioning.service.ts` (select and create use `siteId`/`departmentId`)
- Test: `packages/database/test/organisation-schema.int.test.ts` (new), `packages/database/test/schema.int.test.ts` (scope tests move to the new columns), `apps/api/test/identity/role-scope.test.ts` (new)

**Interfaces:**
- Consumes: Task 2 `FrameworkVersion`.
- Produces (Prisma):
  - `Organisation`: add `singleton Boolean @default(true) @unique`, `description String @default("")`, `approximateHeadcount Int?`, `setupCompletedAt DateTime?`, `setupCompletedById String?` (→ User), `updatedAt @updatedAt`.
  - `Site`: add `nameKey String @unique`, `createdAt`.
  - `Department`: add `nameKey String @unique`, `createdAt`.
  - `RoleAssignment`: drop `scopeId`; add `siteId String? @db.Uuid` (→ Site, Restrict) and `departmentId String? @db.Uuid` (→ Department, Restrict); `@@unique([userId, role, scopeType, siteId, departmentId])`, with the comment pointing at this migration.
  - `enum OrganisationFrameworkStatus { suggested confirmed }`
  - `enum OrganisationFrameworkSource { manual ai }`
  - `OrganisationFramework { id, frameworkVersionId @unique (→ FrameworkVersion, Restrict), status, source, reasoning String?, confirmedById String? (→ User), confirmedAt DateTime?, createdAt, updatedAt }`
  - `enum RiskAxis { likelihood impact }`
  - `RiskScale { id, version Int @unique, appetiteThreshold Int, createdById (→ User), createdAt, levels RiskScaleLevel[] }`
  - `RiskScaleLevel { id, riskScaleId, axis RiskAxis, value Int, label, description; @@unique([riskScaleId, axis, value]) }`
  - `enum AssetType { information application device service facility other }`
  - `Asset { id, name, type AssetType, siteId String? (→ Site, Restrict), ownerId String? (→ User), createdAt, updatedAt }`
- Produces (migration SQL, in addition to the generated DDL):
  - Abort with `RAISE EXCEPTION 'scoped role assignments exist; migrate them manually'` if any `RoleAssignment."scopeId" IS NOT NULL`. Plan 1 had no way to create one.
  - Checks:
    - `"singleton"` is true;
    - `approximateHeadcount BETWEEN 1 AND 1000000`;
    - `"nameKey" = lower(btrim("name"))` on Site and Department;
    - `"countryCode" ~ '^[A-Z]{2}$'`;
    - the RoleAssignment scope: ORGANISATION means both ids are null; SITE means only `siteId` is set; DEPARTMENT means only `departmentId` is set;
    - OrganisationFramework: `("status" = 'confirmed') = ("confirmedById" IS NOT NULL AND "confirmedAt" IS NOT NULL)`;
    - `RiskScaleLevel.value BETWEEN 1 AND 5`;
    - `RiskScale.appetiteThreshold BETWEEN 1 AND 24`.
  - Recreate the RoleAssignment unique index under its Prisma name with `NULLS NOT DISTINCT`.
  - `REVOKE UPDATE, DELETE, TRUNCATE ON "RiskScale", "RiskScaleLevel" FROM isms_app`. Versions are append-only.
- Produces (API): `toRoleAssignmentDto(a: { role: Role; scopeType: ScopeType; siteId: string | null; departmentId: string | null }): RoleAssignmentDto`. `id` is `siteId ?? departmentId ?? null`, and the type is lower-cased. Provisioning uses it.

- [ ] **Step 1: Write the failing tests.**

```ts
// organisation-schema.int.test.ts (owner client unless noted)
it("allows only one Organisation row", ...);                   // second create → unique violation; singleton:false → check violation
it("site and department names are unique ignoring case", ...); // nameKey "riga" twice → unique; nameKey ≠ lower(btrim(name)) → check
it("rejects a country code that is not two capital letters", ...);
it("role assignment scope columns must match the scope type", ...); // SITE without siteId, ORGANISATION with siteId, SITE with departmentId → check
it("organisation-scoped assignments stay unique", ...);        // duplicate (user, role, ORGANISATION) → unique violation
it("a site used by a role assignment or an asset cannot be deleted", ...); // FK restrict
it("a confirmed organisation framework records who confirmed it and when", ...);
it("risk scale versions are append-only for the app role", ...);   // app UPDATE/DELETE → /permission denied/
it("risk scale levels are 1–5 and the appetite 1–24", ...);
// role-scope.test.ts
it.each([[ORG, { type: "organisation", id: null }], [SITE_A, { type: "site", id: A }], [DEPT_B, { type: "department", id: B }]])(...);
```

- [ ] **Step 2: Run** `pnpm db:migrate:test && pnpm --filter @isms/database test:integration && pnpm --filter @isms/api test -- role-scope`. Expected: FAIL.
- [ ] **Step 3: Implement** the schema, the migration, `toRoleAssignmentDto` and the provisioning changes.
- [ ] **Step 4: Run** the same commands plus `pnpm db:validate && pnpm --filter @isms/api test:integration`. Expected: PASS, with the identity tests unchanged.
- [ ] **Step 5: Commit** with `feat(database): organisation, sites, departments, scoped roles, frameworks, risk scale, assets`.

### Task 8: View-mode preference, saved and defaulted by role, and the web's server-side call path

**Files:**
- Create: `packages/database/prisma/migrations/20261104000200_view_mode_default/migration.sql`
- Create: `apps/api/src/identity/view-mode.ts`, `apps/web/lib/server-api.ts`, `apps/web/lib/actions/view-mode.ts`
- Modify: `packages/database/prisma/schema.prisma` (`User.viewMode ViewMode?`, no default), `packages/contracts/src/{permissions.ts,routes/identity.ts,index.ts,openapi.ts}`, `apps/api/src/identity/me.controller.ts`, `apps/api/src/authorization/roles.ts` (baseline), `apps/web/lib/viewer.ts` (`stepUpPath`), `apps/web/app/auth/login/route.ts`, `apps/web/components/shell/view-mode-switch.tsx`, `apps/web/messages/en.json`, `e2e/shell.spec.ts`
- Test: `apps/api/test/identity/view-mode.test.ts` (new), `apps/api/test/identity/me.int.test.ts`, `apps/api/test/authorization/policy.test.ts`, `packages/contracts/test/openapi.test.ts`, `apps/web/test/server-api.test.ts` (new), `apps/web/test/auth-routes.test.ts`, `apps/web/test/shell.test.tsx`, `e2e/shell.spec.ts`

**Interfaces:**
- Consumes: `apiCall`, `ApiError`, `RouteInput`, `RouteOutput` (`lib/api-client.ts`); `resolveAccessToken`, `getSession` (`lib/session.ts`); `sessionCookie()`; `loginPath` (`lib/viewer.ts`); `buildAuthorizationUrl(returnTo, { maxAge })` (`lib/oidc.ts`).
- Produces (contracts):
  - `ViewModeSchema = z.enum(["guided","professional","executive"])`, exported. `MeResponse.viewMode` uses it.
  - Permission `"me.update"`.
  - `identityRoutes.updatePreferences`: `PATCH /api/v1/me/preferences`, permission `me.update`, body `UpdatePreferencesRequest = { viewMode: ViewModeSchema }` (strict), response 200 `PreferencesResponse = { viewMode }`.
- Produces (API):
  - `BASELINE_PERMISSIONS = ["me.read", "me.update"]`. Task 11 adds `organisation.read`.
  - `defaultViewMode(roles: readonly Role[]): ViewMode`, per P2-R7.
  - `/me` returns `user.viewMode ?? defaultViewMode(actor.roles.map(r => r.role))`.
  - The migration sets every existing `viewMode` to NULL (no endpoint ever wrote it) and drops the default and NOT NULL.
  - Preference changes are not audited: they are presentation only and grant nothing (ADR-0005).
- Produces (web):
  - `type CallFailureKind = "signed-out" | "reauth" | "forbidden" | "not-found" | "invalid" | "conflict" | "unavailable"`
  - `type CallResult<T> = { ok: true; data: T } | { ok: false; kind: CallFailureKind; details: { path: string; message: string }[]; href?: string }`
  - `callApi<R extends RouteDef>(route: R, input: RouteInput<R>, options?: { returnTo?: string }): Promise<CallResult<RouteOutput<R>>>`
    - It reads the session cookie and `resolveAccessToken`, then calls `apiCall`. It never throws for API outcomes.
    - Mapping:
      - no session, or token `signed-out`, or 401 → `signed-out` with `href = loginPath(returnTo)`;
      - 403 `RECENT_AUTH_REQUIRED` → `reauth` with `href = stepUpPath(returnTo)`;
      - 403 → `forbidden`; 404 → `not-found`; 400 → `invalid` (with details); 409 → `conflict` (with details);
      - everything else, including token `unavailable` → `unavailable`.
    - `returnTo` defaults to `/`.
  - `stepUpPath(path: string | null): string` returns `/auth/login?returnTo=<encoded safe path>&stepUp=1`.
  - `/auth/login?stepUp=1` calls `buildAuthorizationUrl(returnTo, { maxAge: 0 })`.
  - `saveViewMode(viewMode: ViewMode): Promise<CallResult<PreferencesResponse>>` (`"use server"`).
  - `ViewModeSwitch` updates optimistically, calls `saveViewMode`, then `router.refresh()`. On failure it reverts and shows `viewMode.saveFailed` in a `role="status"` region.
  - en.json: remove `viewMode.notSaved`; add `viewMode.aboutText` = "Changes how much detail you see. It never changes what you can do." and `viewMode.saveFailed` = "We couldn't save your view. Please try again."

- [ ] **Step 1: Write the failing tests.**

```ts
// view-mode.test.ts
it.each([[[], "guided"], [["contributor"], "guided"], [["viewer"], "guided"], [["administrator"], "professional"],
  [["ciso"], "professional"], [["risk_owner"], "professional"], [["risk_approver"], "professional"],
  [["auditor"], "professional"], [["contributor", "ciso"], "professional"]])("defaultViewMode(%j) is %s", ...);
// me.int.test.ts
it("returns the role default until the user chooses a view mode", ...); // no role → guided; org admin → professional
it("saves the chosen view mode and returns it from /me", ...);           // PATCH { viewMode: "executive" } → 200; /me.viewMode === "executive"
it("keeps the choice when roles change", ...);
it("rejects an unknown view mode with VALIDATION_FAILED", ...);
// update the Plan 1 expectation: permissions ["me.read", "me.update"]
// server-api.test.ts (mock session + apiCall)
it.each([
  [new ApiError({ status: 401, code: "UNAUTHENTICATED", message: "x" }), "signed-out", "/auth/login?returnTo=%2Fsetup%2Fpeople"],
  [new ApiError({ status: 403, code: "RECENT_AUTH_REQUIRED", message: "x" }), "reauth", "/auth/login?returnTo=%2Fsetup%2Fpeople&stepUp=1"],
  [new ApiError({ status: 403, code: "FORBIDDEN", message: "x" }), "forbidden", undefined],
  [new ApiError({ status: 404, code: "NOT_FOUND", message: "x" }), "not-found", undefined],
  [new ApiError({ status: 409, code: "CONFLICT", message: "x", details: [{ path: "lastAdministrator", message: "m" }] }), "conflict", undefined],
  [new ApiError({ status: 503, code: "AUTH_UNAVAILABLE", message: "x" }), "unavailable", undefined],
])("maps %s to %s", ...);   // callApi(route, input, { returnTo: "/setup/people" })
it("returns signed-out without calling the API when there is no session", ...);
it("passes validation details through for invalid", ...);
// auth-routes.test.ts
it("stepUp=1 asks the identity provider for a fresh sign-in (max_age=0)", ...); // redirect URL has max_age=0
// shell.test.tsx
it("view-mode switch saves the choice and reverts with a message when saving fails", ...);
// e2e/shell.spec.ts — replaces "view-mode switch is display-only…"
test("the view-mode choice is saved and survives a reload", ...);  // choose Professional, reload, radio still checked
```

- [ ] **Step 2: Run** `pnpm --filter @isms/api test -- view-mode && pnpm --filter @isms/web test && pnpm --filter @isms/contracts test`. Expected: FAIL.
- [ ] **Step 3: Implement.** Update the OpenAPI snapshot intentionally. Update the ADR-0005 bullet "View mode never grants access": it is now stored, NULL means the role default, and it is not audited.
- [ ] **Step 4: Run** `pnpm db:migrate:test && pnpm db:validate && pnpm test && pnpm --filter @isms/api test:integration && pnpm e2e`. Expected: PASS.
- [ ] **Step 5: Commit** with `feat: saved view-mode preference defaulted by role; web server-side call path with step-up`.

### Task 9: Scoped authorization, and the users and roles API

**Files:**
- Create: `apps/api/src/authorization/scoped-permissions.ts`, `apps/api/src/identity/{users.controller.ts,role-assignment.service.ts}`, `packages/contracts/src/{conflicts.ts,routes/people.ts}`
- Modify: `apps/api/src/authorization/{policy.service.ts,require-permission.ts,authorization.module.ts,index.ts}`, `apps/api/src/identity/{identity.module.ts,index.ts,user-provisioning.service.ts}` (export `BOOTSTRAP_ADMIN_LOCK = "isms:bootstrap-admin"`), `packages/contracts/src/{index.ts,openapi.ts}`, `docs/decisions/0005-authorization-model.md`
- Test: `apps/api/test/authorization/policy.test.ts`, `apps/api/test/authorization/guards.int.test.ts`, `apps/api/test/identity/people.int.test.ts` (new), `packages/contracts/test/conflicts.test.ts` (new)

**Interfaces:**
- Consumes: `PolicyService`, `ResourceScope`, `forbidden` (Plan 1); `toRoleAssignmentDto` (Task 7); `AuditService`, `auditContextFrom`, `AuditSnapshot` (Task 1).
- Produces (contracts):
  - `ConflictReasonSchema = z.enum(["lastAdministrator","duplicateRoleAssignment","siteInUse","departmentInUse","setupIncomplete"])`
  - `conflictDetail(reason: ConflictReason, item?: string, message?: string): ErrorDetail` builds the path `reason` or `reason.item`.
  - `conflictReasons(details: readonly ErrorDetail[]): { reason: ConflictReason; item: string | null }[]` ignores unknown paths.
  - `ScopeInput = z.discriminatedUnion("type", [{ type: "organisation", id: z.null() }, { type: "site", id: z.uuid() }, { type: "department", id: z.uuid() }])`
  - `RoleAssignmentDetailDto = { id, userId, role, scope: { type, id }, scopeName: string | null, createdAt: iso }`
  - `UserSummaryDto = { id, email, displayName, lastSeenAt: iso | null, roles: RoleAssignmentDetailDto[] }`
  - `peopleRoutes.listUsers`: `GET /api/v1/users`, `users.list`, → 200 `{ users: UserSummaryDto[] }`, sorted by displayName.
  - `peopleRoutes.grantRole`: `POST /api/v1/users/{userId}/roles`, `roles.assign`, `recentAuth: true`, body `GrantRoleRequest = { role: RoleSchema, scope: ScopeInput }`, → 201 `RoleAssignmentDetailDto`.
  - `peopleRoutes.revokeRole`: `DELETE /api/v1/role-assignments/{assignmentId}`, `roles.assign`, `recentAuth: true`, → 200 `RoleAssignmentDetailDto` (the removed assignment).
- Produces (API, authorization):
  - `SCOPED_PERMISSIONS` (DI token) and `DEFAULT_SCOPED_PERMISSIONS: readonly Permission[] = []`, with the comment "Plan 3 adds risk permissions".
  - `AuthorizationModule.forRoot(options?: { scopedPermissions?: readonly Permission[] })`.
  - `PolicyService`:
    - `canAtAnyScope(actor, permission): boolean`.
    - `accessScope(actor, permission): AccessScope`, where `AccessScope = { kind: "organisation" } | { kind: "units"; siteIds: string[]; departmentIds: string[] } | { kind: "none" }`.
    - `assertCanAccess(actor, permission, resource: ResourceScope): void`. When `can` is false it throws `DomainError("NOT_FOUND", "Not found")`, so the response never reveals that the resource exists.
  - `PermissionGuard`: for a permission in the scoped set it uses `canAtAnyScope`; otherwise `can(actor, permission)` as before.
  - `permissionsFor` = baseline ∪ the permissions of org-scoped roles ∪ { scoped permissions held at any scope }.
  - `PolicyService` takes the scoped set through an `@Optional()` injection, defaulting to `DEFAULT_SCOPED_PERMISSIONS`.
- Produces (API, identity), `RoleAssignmentService`:
  - `listUsers(): Promise<UserSummaryDto[]>`
  - `grant(userId: string, input: GrantRoleRequest, ctx: AuditContext): Promise<RoleAssignmentDetailDto>`. An unknown user gives 404. A foreign-key violation on the site or department gives `400 VALIDATION_FAILED` with detail path `scope.id`. A unique violation gives 409 `duplicateRoleAssignment`. It audits `identity.role_granted` with after `{ userId, role, scopeType, scopeId }`.
  - `revoke(assignmentId: string, ctx: AuditContext): Promise<RoleAssignmentDetailDto>`. It runs in a transaction holding `pg_advisory_xact_lock(hashtext(BOOTSTRAP_ADMIN_LOCK))`. If the assignment is the only organisation-scoped `administrator`, it gives 409 `lastAdministrator`. It audits `identity.role_revoked` with before `{ userId, role, scopeType, scopeId }`.
  - `scopeName` comes from the related Site or Department row. This is a read-only join, documented in the service.

- [ ] **Step 1: Write the failing tests.**

```ts
// policy.test.ts (new PolicyService(["audit.read"]) for scoped cases)
it("canAtAnyScope is true for a site-scoped holder", ...);
it("accessScope: org role → organisation; site + department roles → units with both ids; none → none", ...);
it("assertCanAccess throws NOT_FOUND for a resource outside the actor's units", ...);
it("permissionsFor includes a scoped permission held at site scope, not an unscoped one", ...); // property: every p in permissionsFor passes the guard rule
// guards.int.test.ts — AuthorizationModule.forRoot({ scopedPermissions: ["audit.read"] }), test route permission audit.read
it("a site-scoped holder passes the guard for a scoped permission", ...);
it("a service check hides another site's resource as 404", ...);  // test controller calls assertCanAccess with { siteId: B }
// people.int.test.ts (admin token with auth_time = now; dev users provisioned by signing in)
it("lists users who have signed in, with their roles and scope names", ...);
it("grants an organisation role and audits it in the same transaction", ...); // 201; audit row identity.role_granted
it("grants a site-scoped role", ...);                              // scope { type: "site", id } → scopeName "Riga plant"
it("rejects a scope that does not exist with VALIDATION_FAILED on scope.id", ...);
it("refuses a duplicate assignment with 409 duplicateRoleAssignment", ...);
it("revokes an assignment and audits the removal", ...);
it("refuses to remove the last organisation administrator, including oneself", ...); // 409; details[0].path "lastAdministrator"
it("two administrators revoking each other at once leave exactly one", ...);          // Promise.all → one 200, one 409; admin count 1
it("requires a recent sign-in: auth_time 301 s old gives RECENT_AUTH_REQUIRED", ...);
it("a CISO can list users but cannot grant roles", ...);           // GET 200; POST 403 FORBIDDEN
// conflicts.test.ts
it("round-trips reasons and items and ignores unknown paths", ...);
```

- [ ] **Step 2: Run** `pnpm --filter @isms/api test -- policy && pnpm --filter @isms/api test:integration -- guards people && pnpm --filter @isms/contracts test`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Update ADR-0005 with: scoped permissions (P2-R10), `assertCanAccess` returning 404 by design, the last-administrator rule now implemented, and the role routes requiring recent authentication (P2-R5).
  - Update the OpenAPI snapshot intentionally.
- [ ] **Step 4: Run** `pnpm --filter @isms/api test && pnpm --filter @isms/api test:integration && pnpm --filter @isms/contracts test`. Expected: PASS.
- [ ] **Step 5: Commit** with `feat(api): scoped permission evaluation; users and role assignment with last-admin protection`.

### Task 10: Control library API — frameworks, search, detail, review, export

**Files:**
- Create: `apps/api/src/library/{library.module.ts,library.controller.ts,control-query.service.ts,control-search.ts,mapping-review.service.ts,framework-catalog.service.ts,mappers.ts,index.ts}`, `packages/contracts/src/routes/library.ts`
- Modify: `apps/api/src/app.module.ts`, `apps/api/src/authorization/roles.ts`, `packages/contracts/src/{permissions.ts,index.ts,openapi.ts}`, `apps/api/package.json` (devDependency `@isms/control-library`)
- Test: `apps/api/test/library/library.int.test.ts` (new), `apps/api/test/authorization/policy.test.ts`, `packages/contracts/test/openapi.test.ts`

**Interfaces:**
- Consumes: `FIXTURE_LIBRARY` and `syncControlLibrary` (Task 2), used to seed the tests through the owner client; `AuditService`; `CurrentActor`.
- Produces (contracts):
  - Permissions `"library.read"` and `"library.review"`.
  - `ROLE_PERMISSIONS` additions:
    - `library.read`: administrator, ciso, risk_owner, risk_approver, auditor, viewer.
    - `library.review`: ciso only.
  - DTOs:
    - `ControlCategorySchema`, the enum from Task 2.
    - `FrameworkVersionDto = { id, key, frameworkKey, name, versionLabel, summary, requirementCount }`
    - `MappingReviewDto = z.discriminatedUnion("status", [{ status: "unreviewed" }, { status: "reviewed", reviewedBy: { id, displayName }, reviewedAt: iso }])`
    - `MappingDto = { id, frameworkVersionKey, frameworkName, versionLabel, requirementRef, requirementTitle, review: MappingReviewDto }`
    - `ControlSummaryDto = { code, title, category, frameworks: string[] /* version keys, sorted */, mappings: { total, reviewed } }`
    - `ControlDetailDto = { code, title, description, guidance: string[], category, libraryVersion, mappings: MappingDto[] }`
    - `LibraryExportRow = { controlCode, controlTitle, category, frameworkVersionKey, frameworkName, requirementRef, requirementTitle, reviewStatus: "unreviewed" | "reviewed", reviewedBy: string | null, reviewedAt: iso | null }`
  - Routes (`libraryRoutes`):
    - `listFrameworks`: `GET /api/v1/library/frameworks`, `library.read` → `{ frameworks: FrameworkVersionDto[] }`
    - `listControls`: `GET /api/v1/library/controls`, `library.read`. Query `ControlListQuery = { q?: string (trimmed, max 200), framework?: string, review: "all" | "unreviewed" | "reviewed" (default "all"), category?: ControlCategorySchema }` → `{ libraryVersion: string | null, items: ControlSummaryDto[] }`, sorted by code.
    - `getControl`: `GET /api/v1/library/controls/{code}`, `library.read`, `code` matching the Task 2 regex → `ControlDetailDto`. Mappings are sorted by framework key, then requirement `sortOrder`.
    - `reviewMapping`: `POST /api/v1/library/mappings/{mappingId}/review`, `library.review`, no body → 200 `MappingDto`.
    - `exportLibrary`: `GET /api/v1/library/export`, `library.read` → `{ libraryVersion, generatedAt: iso, rows: LibraryExportRow[] }`, ordered by control code, framework and `sortOrder`.
- Produces (API):
  - `FrameworkCatalog`, exported from `library/index.ts` for Task 11:
    - `list(): Promise<FrameworkVersionDto[]>`
    - `findByIds(ids: readonly string[]): Promise<FrameworkVersionDto[]>`
  - `controlSearchIds(db, q: string): Promise<string[]>` in `control-search.ts`, one `$queryRaw`. A control matches when:
    - its `code` matches `ILIKE q || '%'`, after escaping `\`, `%` and `_` (`ESCAPE '\'`); or
    - `to_tsvector('english', title || ' ' || description || ' ' || array_to_string(guidance, ' ')) @@ websearch_to_tsquery('english', q)`; or
    - one of its mapped requirements has `lower(ref) = lower(q)`.
    - An empty `q` skips the search.
    - There is no index, because the library is bounded at a few hundred rows (noted in a code comment).
  - Review filter:
    - `unreviewed` = at least one unreviewed mapping, within the framework filter when one is given;
    - `reviewed` = every such mapping is reviewed.
  - `MappingReviewService.review(mappingId, actor, ctx)` does a conditional `updateMany` (`where { id, reviewedAt: null }`) inside a transaction, and audits `library.mapping_reviewed` with after `{ controlCode, frameworkVersionKey, requirementRef, reviewedById }`. If the mapping is already reviewed, it returns the existing review and writes no audit row. An unknown id gives 404.

- [ ] **Step 1: Write the failing tests** in `library.int.test.ts`. Seed `FIXTURE_LIBRARY` after each reset. Users are Carl Ciso (ciso), Anna Admin (administrator), Arno Auditor (auditor) and Rita Reporter (contributor).

```ts
it("lists frameworks with requirement counts", ...);                 // iso27001-2022: 2, gdpr-2016-679: 1
it("lists controls sorted by code with mapping counts and the library version", ...);
  // codes ["ACC-01","GOV-01","RES-01"]; RES-01.mappings { total: 2, reviewed: 0 }; libraryVersion "2026.11.0-test"
it("searches by words in the text", ...);                             // q "backup" → ["RES-01"]
it("searches by requirement reference", ...);                         // q "A.8.13" → ["RES-01"]; q "art. 32" → ["ACC-01","RES-01"]
it("treats wildcards and tsquery syntax as plain text", ...);         // q "%" → []; q "_" → []; q "a & | ! :* ( '" → 200; 201 chars → 400 VALIDATION_FAILED
it("filters by framework, category and review status", ...);
it("shows a control's mappings, each with its review status", ...);   // RES-01: 2 mappings, review.status "unreviewed"
it("returns 404 NOT_FOUND for an unknown control code", ...);
it("a CISO marks a mapping reviewed; name and date are returned and audited", ...);
  // 200 review { status: "reviewed", reviewedBy: { displayName: "Carl Ciso" } }; audit row library.mapping_reviewed
it("reviewing twice keeps the first review and writes one audit row", ...);
it("administrators and auditors can read but not review; contributors cannot read", ...); // 403 FORBIDDEN cases
it("export returns one row per mapping with its review status", ...); // rows 4; RES-01 rows reviewStatus "unreviewed"
```

- [ ] **Step 2: Run** `pnpm --filter @isms/api test:integration -- library`. Expected: FAIL.
- [ ] **Step 3: Implement** the module, contracts and permissions. Update the `/me` and policy expectations, and update the OpenAPI snapshot intentionally.
- [ ] **Step 4: Run** `pnpm --filter @isms/api test && pnpm --filter @isms/api test:integration && pnpm --filter @isms/contracts test`. Expected: PASS.
- [ ] **Step 5: Commit** with `feat(api): control library search, mapping review and export`.

### Task 11: Organisation setup API

**Files:**
- Create: `apps/api/src/organisation/{organisation.module.ts,organisation.controller.ts,organisation.service.ts,organisation-units.service.ts,organisation-frameworks.service.ts,risk-scale.service.ts,default-risk-scale.ts,setup-lock.ts,index.ts}`, `packages/contracts/src/routes/organisation.ts`, `packages/domain/src/{risk-scale.ts,countries.ts}`
- Modify: `apps/api/src/app.module.ts`, `apps/api/src/authorization/roles.ts`, `packages/contracts/src/{permissions.ts,index.ts,openapi.ts}`, `packages/domain/src/index.ts`
- Test: `packages/domain/test/risk-scale.test.ts`, `packages/domain/test/countries.test.ts`, `apps/api/test/organisation/{profile-and-setup.int.test.ts,units.int.test.ts,frameworks-and-scale.int.test.ts}` (new), `packages/contracts/test/openapi.test.ts`

**Interfaces:**
- Consumes: `FrameworkCatalog` (Task 10); `conflictDetail` (Task 9); `AuditService`, `AuditSnapshot` (Task 1); the Task 7 schema.
- Produces (domain):
  - `riskScore(likelihood: number, impact: number): number`
  - `isAboveAppetite(score: number, appetiteThreshold: number): boolean` (`score > threshold`)
  - `DEFAULT_APPETITE_THRESHOLD = 9`, `APPETITE_PRESETS = { cautious: 4, balanced: 9, bold: 14 } as const`, `MIN_APPETITE_THRESHOLD = 1`, `MAX_APPETITE_THRESHOLD = 24`
  - `COUNTRY_CODES: readonly string[]` (the 249 officially assigned ISO 3166-1 alpha-2 codes) and `isCountryCode(code: string): boolean`
- Produces (contracts):
  - Permissions: `"organisation.read"` (baseline, P2-R14) and `"organisation.manage"` (administrator).
  - `SetupStepSchema = z.enum(["profile","sites","frameworks","riskScale"])`
  - DTOs:
    - `SiteDto = { id, name, countryCode }`
    - `DepartmentDto = { id, name }`
    - `OrganisationFrameworkDto = { id, frameworkVersionId, frameworkVersionKey, name, versionLabel, status: "suggested" | "confirmed", source: "manual" | "ai", reasoning: string | null, confirmedBy: { id, displayName } | null, confirmedAt: iso | null }`
    - `RiskLevelDto = { value: 1..5, label, description }`
    - `RiskScaleDto = { version: number | null, appetiteThreshold, likelihood: RiskLevelDto[], impact: RiskLevelDto[] }`
    - `OrganisationResponse = { profile: { name, description, approximateHeadcount } | null, sites: SiteDto[], departments: DepartmentDto[], frameworks: OrganisationFrameworkDto[], riskScale: RiskScaleDto | null, defaultRiskScale: RiskScaleDto, setup: { completedAt: iso | null, missing: SetupStep[] } }`
  - Inputs, all `.strict()`, with strings trimmed:
    - `ProfileInput = { name: 1–200, description: 1–2000, approximateHeadcount: int 1–1 000 000 }`
    - `SitesInput = { sites: { id?: uuid, name: 1–120, countryCode: refine(isCountryCode) }[] (1–200) }`, with names unique case-insensitively after trimming (refine; detail path `sites.<i>.name`)
    - `DepartmentsInput = { departments: { id?: uuid, name: 1–120 }[] (0–200) }`, with the same uniqueness rule
    - `FrameworksInput = { frameworkVersionIds: uuid[] (1–20, unique) }`
    - `RiskScaleInput = { appetiteThreshold: int MIN–MAX }`
  - Routes (`organisationRoutes`):
    - `get`: `GET /api/v1/organisation`, `organisation.read`
    - `updateProfile`: `PUT /api/v1/organisation/profile`, `organisation.manage`, → `OrganisationResponse`
    - `replaceSites`: `PUT /api/v1/organisation/sites`, `organisation.manage`, → `{ sites: SiteDto[] }`
    - `replaceDepartments`: `PUT /api/v1/organisation/departments`, `organisation.manage`, → `{ departments: DepartmentDto[] }`
    - `setFrameworks`: `PUT /api/v1/organisation/frameworks`, `organisation.manage`, → `{ frameworks: OrganisationFrameworkDto[] }`
    - `setRiskScale`: `PUT /api/v1/organisation/risk-scale`, `organisation.manage`, → `RiskScaleDto`
    - `completeSetup`: `POST /api/v1/organisation/setup/complete`, `organisation.manage`, → 200 `{ completedAt: iso }`
- Produces (API):
  - Every write runs in one transaction that first takes `pg_advisory_xact_lock(hashtext(SETUP_LOCK))`, with `SETUP_LOCK = "isms:organisation-setup"` (`withSetupLock(prisma, fn)` in `setup-lock.ts`). Each write audits with `tx`.
  - `updateProfile` upserts on `singleton: true`. Audit: `organisation.profile_updated`, objectType `Organisation`, with before and after `{ name, description, approximateHeadcount }`.
  - `replaceSites` diffs against the stored list. An entry with an id that exists is updated; a stored id that is missing is deleted; an entry without an id is created. A stored id that is unknown gives 400 with path `sites.<i>.id`. A delete that hits a foreign key is refused with 409 `siteInUse.<siteId>`, and the whole save rolls back. Audit: one row per change, `organisation.site_added`, `_updated` or `_removed`, objectType `Site`. Departments follow the same pattern, with reason `departmentInUse` and actions `organisation.department_*`.
  - `setFrameworks`:
    - Unknown ids (checked through `FrameworkCatalog.findByIds`) give 400 with path `frameworkVersionIds.<i>`.
    - A selected version is upserted as `confirmed` / `manual`, with `confirmedById = actor` and `confirmedAt = now`, and `reasoning` left as stored.
    - An unselected `confirmed` row is deleted.
    - An unselected `suggested` row is left untouched (the seam for Plan 3).
    - Audit: `organisation.framework_confirmed` and `organisation.framework_removed`, objectType `OrganisationFramework`.
  - `setRiskScale`:
    - If the threshold equals the latest version's, nothing is written and the latest version is returned.
    - Otherwise it creates version = latest + 1, with the levels from `DEFAULT_RISK_SCALE`. Audit: `organisation.risk_scale_created` with after `{ version, appetiteThreshold }`.
  - `DEFAULT_RISK_SCALE` labels and descriptions (`default-risk-scale.ts`; installation data, P2-R4):
    - Likelihood:
      - 1 Rare: "Hardly ever: less than once in ten years."
      - 2 Unlikely: "Could happen, but not expected: about once in five to ten years."
      - 3 Possible: "Might happen every few years."
      - 4 Likely: "Will probably happen this year."
      - 5 Almost certain: "Expected to happen several times a year."
    - Impact:
      - 1 Negligible: "Barely noticeable. Sorted out within a day."
      - 2 Minor: "Some disruption or cost, no lasting harm."
      - 3 Moderate: "Noticeable harm to customers, money or operations, but recoverable."
      - 4 Major: "Serious harm: regulators involved, large losses or many people affected."
      - 5 Severe: "Threatens the organisation or causes lasting harm to people."
  - `missing` lists, in order: `profile` (no row); `sites` (none); `frameworks` (no `confirmed` row); `riskScale` (no version).
  - `completeSetup`:
    - If anything is missing, it gives 409 with details `setupIncomplete.<step>` for each missing step.
    - If setup is already complete, it returns the stored `completedAt` and writes no audit row.
    - Otherwise it sets `setupCompletedAt` and `setupCompletedById`, and audits `organisation.setup_completed`.

- [ ] **Step 1: Write the failing tests.**

```ts
// risk-scale.test.ts
it("score is likelihood × impact; above appetite only when score > threshold", ...); // (3,3,9) within; (2,5,9) above
it("presets are cautious 4, balanced 9 (default), bold 14", ...);
// countries.test.ts
it("has 249 unique two-letter codes including LV, DE, PL, US and excludes UK", ...);
// profile-and-setup.int.test.ts
it("a new installation reports every setup step missing and offers the default scale", ...);
  // profile null; missing ["profile","sites","frameworks","riskScale"]; defaultRiskScale.appetiteThreshold 9; likelihood[0].label "Rare"
it("saves the profile and audits before and after", ...);
it("two concurrent profile saves leave exactly one organisation row", ...);
it("completing setup lists what is missing", ...);                // 409; detail paths ["setupIncomplete.sites", …]
it("completes setup once everything is in place; completing again changes nothing", ...); // one organisation.setup_completed row
it("only administrators can change setup; everyone signed in can read it", ...);           // contributor PUT 403, GET 200
// units.int.test.ts
it("replaces the site list: creates, renames and removes, with one audit row per change", ...);
it("rejects duplicate site names ignoring case and spaces", ...); // [" Riga ", "riga"] → 400 path "sites.1.name"
it("rejects an unknown country code", ...);                       // "XX" → 400 path "sites.0.countryCode"
it("refuses to remove a site a role assignment uses, and changes nothing", ...);
  // 409 details[0].path === `siteInUse.${siteId}`; a rename in the same save is not applied
it("two concurrent site saves leave one consistent list", ...);   // no duplicate nameKey, no 500
it("replaces departments, and refuses to remove one in use", ...);
// frameworks-and-scale.int.test.ts (FIXTURE_LIBRARY seeded)
it("confirms the chosen frameworks as manual, attributed and dated", ...);
it("deselecting removes a confirmed framework and audits it", ...);
it("keeps a suggested framework that was not chosen", ...);       // owner inserts status suggested, source ai, reasoning "r" → still there, unchanged
it("rejects an unknown framework version", ...);
it("sets the appetite as a new immutable scale version with the default labels", ...); // version 1, then 2; same value again → still 2
it("rejects an appetite outside 1–24", ...);
```

- [ ] **Step 2: Run** `pnpm --filter @isms/domain test && pnpm --filter @isms/api test:integration -- organisation`. Expected: FAIL.
- [ ] **Step 3: Implement.** Add `organisation.read` to the baseline. Update `/me` and the policy expectations, and update the OpenAPI snapshot intentionally.
- [ ] **Step 4: Run** `pnpm test && pnpm --filter @isms/api test:integration`. Expected: PASS.
- [ ] **Step 5: Commit** with `feat(api): audited organisation setup: profile, sites, departments, frameworks, risk appetite`.

### Task 12: Web setup flow I — frame, navigation, the organisation and sites steps

**Files:**
- Create: `apps/web/app/(app)/setup/{page.tsx,loading.tsx,organisation/page.tsx,sites/page.tsx}`, `apps/web/components/setup/{setup-frame.tsx,steps.ts,profile-form.tsx,units-form.tsx}`, `apps/web/lib/{page-result.tsx,actions/setup.ts}`, `apps/web/components/shell/nav-items.ts`, `packages/ui/src/components/{field.tsx,textarea.tsx,select.tsx}`
- Modify: `apps/web/app/(app)/layout.tsx` (passes `permissions` to `AppShell`), `apps/web/components/shell/{app-shell.tsx,primary-nav.tsx}`, `apps/web/components/status/status-screen.tsx` (kind `forbidden`), `packages/ui/src/index.ts`, `apps/web/messages/en.json`, `apps/web/package.json` (dependency `@isms/domain`)
- Test: `apps/web/test/setup-steps.test.ts`, `apps/web/test/profile-form.test.tsx`, `apps/web/test/units-form.test.tsx`, `apps/web/test/actions-setup.test.ts`, `apps/web/test/shell.test.tsx`, `packages/ui/test/components.test.tsx`

**Interfaces:**
- Consumes: `callApi`, `CallResult` (Task 8); `organisationRoutes`, `ProfileInput`, `SitesInput`, `DepartmentsInput`, `conflictReasons` (Tasks 9 and 11); `COUNTRY_CODES` (Task 11); `requireViewer`.
- Produces:
  - `SETUP_STEPS: readonly SetupStepDef[]`, with `SetupStepDef = { key: "organisation" | "sites" | "frameworks" | "riskAppetite" | "people" | "review"; path: string; apiStep: SetupStep | null }`, in that order. The paths are `/setup/organisation`, `/setup/sites`, `/setup/frameworks`, `/setup/risk-appetite`, `/setup/people` and `/setup/review`.
  - `firstIncompleteStep(missing: readonly SetupStep[]): SetupStepDef`. It returns the first step whose `apiStep` is missing, or `review` when nothing is missing. `/setup` redirects there.
  - `SetupFrame({ current, missing, children })`:
    - It renders an ordered step list (`<nav aria-label>`; `aria-current="step"`; each done step marked with a check icon plus visually hidden "Done" text).
    - It shows the step's title and a "Why we ask" line from `setup.<key>.why`.
    - It shows "Step n of 6".
  - `failureScreen(result: Exclude<CallResult<unknown>, { ok: true }>, path: string): ReactElement`. It redirects to `href` for `signed-out` and `reauth`, calls `notFound()` for `not-found`, shows `StatusScreen` `forbidden` for `forbidden`, and `unavailable` otherwise.
  - Server actions, in `lib/actions/setup.ts` (`"use server"`):
    - `saveProfile(input: z.input<typeof ProfileInput>): Promise<CallResult<OrganisationResponse>>`
    - `saveUnits(input: { sites: …; departments: … }): Promise<CallResult<{ sites: SiteDto[]; departments: DepartmentDto[] }>>`. It calls `replaceSites`, then `replaceDepartments`, and stops at the first failure.
    - Each passes `returnTo` set to its step path.
  - `@isms/ui`:
    - `Field({ id, label, hint?, error?, children })` renders the label, the hint (id `${id}-hint`) and the error (id `${id}-error`, with an icon and text).
    - `fieldA11y(id, { hint, error }) → { "aria-describedby", "aria-invalid" }` wires the control.
    - `Textarea` and `Select` (a native `<select>`) are styled like `Input`.
  - `navItemsFor(permissions: readonly Permission[]): NavItem[]` returns Home, plus Organisation (`/setup`, when `organisation.manage` is held). Task 14 adds Controls. `PrimaryNav` takes `items`.
  - Forms:
    - They validate on submit with the contract schema, then call the action.
    - They map details: a field path goes to that field's `en.json` message; a conflict reason goes to `setup.errors.<reason>`, shown on the referenced row.
    - On success they `router.push` the next step.
    - Pending state: the submit button shows "Saving…" and is disabled. A `role="status"` region announces "Saved".
  - `setup/loading.tsx` shows a designed skeleton of the frame (step list plus a card), with no numbers, `aria-busy="true"` and the `setup.loading` label. There is no animation under reduced motion.
  - The sites step:
    - Repeatable rows for sites (name, and a country `Select` with names from `new Intl.DisplayNames(["en"], { type: "region" })`) and for departments (name).
    - "Add a site" and "Add a department" buttons, and a "Remove" button per row with accessible names that include the row name.
    - Focus moves to the new row's name field.
    - At least one site is required. Departments are optional, with the copy "Optional — add teams if some people should only see their own area."
  - en.json keys:
    - `nav.organisation`
    - `status.forbidden.{title,body,retry}`
    - `setup.title`, `setup.loading`, `setup.stepOf`, `setup.done`, `setup.continue`, `setup.back`, `setup.saving`, `setup.saved`
    - `setup.organisation.{title,why,name,nameHint,description,descriptionHint,headcount,headcountHint}`
    - `setup.sites.{title,why,siteName,country,addSite,removeSite,departmentsTitle,departmentsHint,departmentName,addDepartment,removeDepartment}`
    - `setup.errors.{name,description,headcount,siteName,country,departmentName,siteInUse,departmentInUse,unavailable}`
    - `setup.organisation.why` = "Your answers help us suggest the right rules and examples for an organisation like yours."

- [ ] **Step 1: Write the failing tests.**

```ts
// setup-steps.test.ts
it.each([[["profile","sites","frameworks","riskScale"], "organisation"], [["frameworks","riskScale"], "frameworks"],
  [["riskScale"], "riskAppetite"], [[], "review"]])("firstIncompleteStep(%j) is %s", ...);
// profile-form.test.tsx (NextIntlClientProvider with marked messages, as in shell.test.tsx)
it("every label and hint comes from en.json", ...);
it("shows the API's field problem next to the field and marks it invalid", ...);
  // action resolves { ok:false, kind:"invalid", details:[{ path:"name", message:"x" }] } → textbox aria-invalid="true",
  // aria-describedby includes the error id, error text === en setup.errors.name; API message "x" not shown
it("submits trimmed values and goes to the sites step", ...);       // push("/setup/sites")
it("announces 'Saving…' while pending and 'Saved' after success", ...);
// units-form.test.tsx
it("adds and removes rows with labelled buttons and moves focus to the new row", ...);
it("shows the site-in-use message on the row that cannot be removed", ...); // conflict detail siteInUse.<id> → message in that row
it("requires at least one site before continuing", ...);
// actions-setup.test.ts (mock callApi)
it("saveUnits saves sites, then departments, and stops at the first failure", ...);
// shell.test.tsx
it("shows Organisation in navigation only to people who can manage it", ...);
// components.test.tsx (ui)
it("Field links hint and error to the control and has no axe violations", ...);
```

- [ ] **Step 2: Run** `pnpm --filter @isms/web --filter @isms/ui test`. Expected: FAIL.
- [ ] **Step 3: Implement** the pages, components, actions and messages.
  - Each page starts with `requireViewer()`, then checks `me.permissions.includes("organisation.manage")` (otherwise it shows the `forbidden` screen), then loads `organisationRoutes.get` through `callApi`.
  - Use Clear Glass tokens and the existing `glass` surface pattern. Use the Motion `Entrance` for step content.
- [ ] **Step 4: Run** the same command plus `pnpm typecheck && pnpm lint`. Expected: PASS.
- [ ] **Step 5: Commit** with `feat(web): guided organisation setup: frame, profile and sites steps`.

### Task 13: Web setup flow II — frameworks, risk appetite, people, review and finish; e2e

**Files:**
- Create: `apps/web/app/(app)/setup/{frameworks,risk-appetite,people,review}/page.tsx`, `apps/web/components/setup/{frameworks-form.tsx,appetite-form.tsx,appetite-grid.tsx,people-list.tsx,role-dialog.tsx,review-summary.tsx}`, `apps/web/lib/actions/roles.ts`, `e2e/db.ts`, `e2e/org-setup.spec.ts`
- Modify: `apps/web/lib/actions/setup.ts` (`saveFrameworks`, `saveRiskAppetite`, `completeSetup`), `apps/web/app/(app)/page.tsx` and `apps/web/components/home/home-view.tsx` (setup link and state), `apps/web/components/shell/command-palette-host.tsx`, `apps/web/messages/en.json`, `e2e/{auth.setup.ts,env.ts,playwright.config.ts,shell.spec.ts,package.json}`, `.github/workflows/ci.yml` (e2e job: `pnpm db:migrate:test` instead of `pnpm db:migrate`), `docs/operations/local-development.md` (e2e uses `isms_test`; stop `pnpm dev` first)
- Test: `apps/web/test/{frameworks-form.test.tsx,appetite-form.test.tsx,role-dialog.test.tsx,review-summary.test.tsx,home-view.test.tsx}`, `e2e/org-setup.spec.ts`, `e2e/shell.spec.ts`

**Interfaces:**
- Consumes: Task 12's frame, actions pattern, `failureScreen` and `Field`; `libraryRoutes.listFrameworks` (Task 10); `peopleRoutes` (Task 9); `isAboveAppetite`, `riskScore`, `APPETITE_PRESETS`, `DEFAULT_APPETITE_THRESHOLD` (Task 11); `resetTestDatabase` (`@isms/database/testing`); `loadLibrary` and `syncControlLibrary` (Task 2).
- Produces (web):
  - Actions:
    - `saveFrameworks(ids: string[])`
    - `saveRiskAppetite(threshold: number)`
    - `completeSetup()`
    - `grantRole(userId: string, input: GrantRoleRequest)`
    - `revokeRole(assignmentId: string)`
    - Each returns `CallResult`. The role actions use `returnTo: "/setup/people"`. On `reauth`, the client calls `window.location.assign(result.href)`.
  - Frameworks step:
    - A `fieldset` and `legend` with one checkbox per framework version, showing name, version label and summary.
    - Only already-confirmed frameworks are pre-checked.
    - There is no AI or "suggested" wording.
    - Helper copy: "Not sure? GDPR applies to most organisations that handle personal data of people in the EU. You can change this later."
  - Appetite step:
    - A radio group with three presets (`setup.riskAppetite.presets.{cautious,balanced,bold}.{label,description}`). Balanced is selected unless a scale exists.
    - `AppetiteGrid({ scale: RiskScaleDto, threshold })` renders a real `<table>` with a caption, row headers (impact labels) and column headers (likelihood labels). Each of the 25 cells shows the score plus an icon and words: "Within appetite" or "Needs a second approver". Status is never colour alone.
  - People step:
    - `PeopleList` lists the users who have signed in, with role chips (label + scope name). It says "People appear here after they sign in for the first time."
    - `RoleDialog` (the UI `Dialog`) has role checkboxes with plain descriptions (`roles.<role>.{label,description}`) and a scope `Select` (Whole organisation, each site, each department).
    - Saving computes the diff, then grants and revokes one call at a time. The first failure is shown with its `en.json` message (for example `setup.errors.lastAdministrator`).
  - Review step:
    - `ReviewSummary` shows each step's saved values, with an "Edit" link to the step.
    - It lists `missing` items as links.
    - "Finish setup" is enabled only when nothing is missing. If finish returns a 409, the list re-renders from the details.
    - On success it goes to `/` with `?setup=done`, and the home page announces "Your organisation is set up." in `role="status"`.
  - Home:
    - Administrators (`organisation.manage`) get a real link button, "Set up your organisation", to `/setup`. This replaces the disabled button and fixes the deferred T12 minor.
    - After completion, administrators see `home.hint.adminDone` with a link "Review setup", and members see `home.hint.memberDone`.
  - Palette: "Set up your organisation" when `organisation.manage` is held.
  - Role copy, `roles.*.description`:
    - administrator: "Sets up the workspace and decides who does what."
    - ciso: "Leads security: reviews risks, controls and their mappings."
    - risk_owner: "Looks after the risks in their area."
    - risk_approver: "Approves important risk decisions."
    - contributor: "Reports concerns and provides evidence when asked."
    - viewer: "Sees approved risks."
    - auditor: "Reads everything, including history, but changes nothing."
  - Role labels: Administrator, Security lead, Risk owner, Risk approver, Contributor, Viewer, Auditor.
  - en.json adds:
    - `setup.{frameworks,riskAppetite,people,review}.*` (each with `title` and `why`)
    - `setup.errors.{frameworks,lastAdministrator,duplicateRoleAssignment,scope,setupIncomplete}`
    - `roles.<role>.{label,description}`
    - `home.hint.{adminDone,memberDone,reviewSetup}` and `home.setupDone`
    - `palette.setUp`
- Produces (e2e, P2-R6):
  - `resetE2eDatabase(): Promise<void>` runs `resetTestDatabase(DATABASE_OWNER_TEST_URL)` and then `syncControlLibrary(owner client, loadLibrary())`.
  - `assertApiUsesTestDatabase(email: string): Promise<void>` throws "The API is not using isms_test — stop `pnpm dev` and re-run `pnpm e2e`" when no `User` with that email exists in `isms_test` after sign-in.
  - `auditActions(): Promise<string[]>`.
  - `e2e/package.json` gains `@isms/database`, `@isms/control-library` and `@isms/config` (all `workspace:*`).
  - `auth.setup.ts`:
    - It first calls `resetE2eDatabase()`.
    - It signs in admin, reporter and `ciso@example.test` (new `CISO_STATE`, `CISO_EMAIL`).
    - After the admin sign-in it calls `assertApiUsesTestDatabase(ADMIN_EMAIL)`.
  - The Playwright `webServerEnv` adds `DATABASE_URL: <DATABASE_TEST_URL>`.
  - Projects: `setup` → `chromium` (shell) → `org-setup` (`org-setup.spec.ts`) → `library` (Task 14) → `chromium-login` → `webkit`.

- [ ] **Step 1: Write the failing tests.**

```ts
// frameworks-form.test.tsx
it("is a labelled checkbox group showing each framework's summary", ...);
it("pre-checks only confirmed frameworks and never mentions AI", ...);   // queryByText(/AI|suggest/i) === null
// appetite-form.test.tsx
it("offers three presets with Balanced selected by default", ...);
it("the grid is a table whose 25 cells say in words whether they are within appetite", ...);
  // threshold 9: cell (likelihood 3, impact 3) "Within appetite"; (2,5) "Needs a second approver"; every cell has an svg[aria-hidden] and text
// role-dialog.test.tsx
it("lists roles with plain descriptions and requires a site when the scope is a site", ...);
it("sends the browser to sign in again when the API needs a recent sign-in", ...); // assign spy called with "/auth/login?returnTo=%2Fsetup%2Fpeople&stepUp=1"
it("shows the last-administrator message from en.json", ...);
// review-summary.test.tsx
it("links each missing step and enables Finish only when nothing is missing", ...);
// home-view.test.tsx
it("administrators get a working link to set up the organisation", ...);  // role link, href "/setup"; no aria-disabled
it("after setup, administrators can review it and members are told it is set up", ...);

// e2e/org-setup.spec.ts (fresh admin sign-in in a new context, so auth_time is recent)
test("an administrator sets up the organisation from first sign-in to a finished setup", async ({ browser }) => {
  // home → "Set up your organisation" → profile (name, what it does, headcount 850) → Continue
  // sites: "Riga plant" Latvia, "Munich office" Germany; department "Production" → Continue
  // frameworks: check GDPR and ISO/IEC 27001 → Continue; appetite: keep Balanced → Continue
  // people: Carl Ciso → Security lead, Whole organisation → Save → chip "Security lead" visible → Continue
  // review: all four sections show the saved values → Finish setup → URL "/?setup=done", status text "Your organisation is set up."
  expect(await auditActions()).toEqual(expect.arrayContaining(["organisation.profile_updated", "organisation.site_added",
    "organisation.framework_confirmed", "organisation.risk_scale_created", "identity.role_granted", "organisation.setup_completed"]));
});
test("people who cannot manage the organisation get a plain 'no access' page at /setup", ...); // reporter → heading from status.forbidden.title
test("the setup steps are usable with the keyboard alone, with visible focus", ...);
for (const theme of ["light", "dark"] as const)
  test(`axe: no violations on every setup step in ${theme}`, ...);   // six pages
// e2e/shell.spec.ts — replace "users who can assign roles see that setup is coming"
test("administrators see a link to set up the organisation", ...);  // role link "Set up your organisation" → /setup/organisation
```

- [ ] **Step 2: Run** `pnpm --filter @isms/web test`, then `pnpm db:migrate:test && pnpm e2e`. Expected: FAIL.
- [ ] **Step 3: Implement** the steps, the home changes, the e2e harness and the CI change.
- [ ] **Step 4: Run** `pnpm test && pnpm e2e`. Expected: PASS in chromium; the login specs also pass in webkit.
- [ ] **Step 5: Commit** with `feat(web): frameworks, risk appetite, people and finish steps; organisation setup e2e`.

### Task 14: Web control library browser, CSV export and e2e

**Files:**
- Create: `apps/web/app/(app)/library/{page.tsx,loading.tsx,[code]/page.tsx,export/route.ts}`, `apps/web/components/library/{control-list.tsx,control-filters.tsx,control-detail.tsx,mapping-row.tsx}`, `apps/web/lib/{csv.ts,actions/library.ts}`, `e2e/library.spec.ts`
- Modify: `apps/web/components/shell/{nav-items.ts,command-palette-host.tsx}`, `apps/web/lib/api-client.ts` (response size cap), `apps/web/next.config.ts` (an `ASSET_EXTENSIONS` comment: dynamic routes must not end in a listed extension; the export route has no extension), `apps/web/messages/en.json`, `e2e/playwright.config.ts` (`library` project)
- Test: `apps/web/test/{csv.test.ts,control-list.test.tsx,mapping-row.test.tsx,export-route.test.ts,api-client.test.ts,messages.test.ts}`, `e2e/library.spec.ts`

**Interfaces:**
- Consumes: `libraryRoutes` and DTOs (Task 10); `callApi`, `failureScreen` (Tasks 8 and 12); `StatusBadge`; `getTranslations`.
- Produces:
  - `toCsv(header: readonly string[], rows: readonly (readonly string[])[]): string`:
    - UTF-8 BOM, then RFC 4180 output.
    - Fields are quoted when they contain `"`, `,`, CR or LF, with `""` escaping.
    - Lines end with CRLF.
    - A cell that starts with `=`, `+`, `-`, `@`, TAB or CR is prefixed with `'` (formula injection).
  - `GET /library/export` (route handler):
    - Without a session it redirects to `loginPath("/library")`.
    - Otherwise it calls `libraryRoutes.exportLibrary`.
    - It responds `200 text/csv; charset=utf-8` with `Content-Disposition: attachment; filename="control-library-<libraryVersion>.csv"` and `Cache-Control: no-store`.
    - Column headers come from `library.export.columns.*`.
    - The review column is "Not yet reviewed" or "Reviewed".
    - API failures map to 403 or 503 plain-text responses, with text from `en.json`.
  - `MAX_RESPONSE_BYTES = 5_000_000` in `api-client.ts`. A larger body becomes `ApiError { status: 0, code: "INTERNAL", message: "API response too large" }`.
  - `reviewMapping(mappingId: string): Promise<CallResult<MappingDto>>`, with `returnTo` set to the control's path.
  - `/library`:
    - A `role="search"` form (GET, `q`, with a visible label), framework and review-status `Select`s, and a category `Select`.
    - The result count is announced (`library.results`, plural).
    - The list is cards, not a dense table. Each card shows the code, title, framework short names, and a review `StatusBadge`:
      - all reviewed → `ok`, "All mappings reviewed";
      - otherwise `attention`, "{reviewed} of {total} mappings reviewed".
    - An intro line: "Our own plainly worded controls, mapped to the frameworks you follow. 'Not yet reviewed' means no one in your organisation has checked that mapping yet."
    - A "Download CSV" link to `/library/export`.
    - A Guided-view user still sees the page (view mode never limits access), with a note `library.professionalNote`.
  - Both library pages start with `requireViewer()` and show the `forbidden` screen without `library.read`. `library/loading.tsx` is a skeleton list (`aria-busy`, `library.loading`).
  - `/library/[code]`: the title, description, a guidance list, and the mappings grouped by framework. Each `MappingRow` shows the requirement ref and title, and its status:
    - `StatusBadge attention` "Not yet reviewed"; or
    - `ok` "Reviewed by {name} on {date}" (the date formatted with `useFormatter`, `dateStyle: "medium"`).
    - It has a "Mark as reviewed" button only when `me.permissions` includes `library.review`.
  - `navItemsFor` adds Controls (`/library`, `library.read`). The palette adds "Go to Controls".
  - en.json: `nav.library` = "Controls"; `library.{title,loading,intro,professionalNote,search,searchLabel,framework,anyFramework,review,reviewAll,reviewUnreviewed,reviewReviewed,category,anyCategory,results,empty,download,allReviewed,someReviewed,notReviewed,reviewedBy,markReviewed,marking,guidance,mappings,export.columns.*,export.unavailable,export.forbidden}`; `library.categories.<category>`; `palette.goLibrary`.

- [ ] **Step 1: Write the failing tests.**

```ts
// csv.test.ts
it("quotes commas, quotes and newlines and ends lines with CRLF", () =>
  expect(toCsv(["a", "b"], [["x,y", 'say "hi"']])).toBe('﻿a,b\r\n"x,y","say ""hi"""\r\n'));
it.each(["=1+1", "+1", "-1", "@SUM(A1)", "\tx", "\rx"])("neutralises formula-like cell %j", (v) =>
  expect(toCsv(["h"], [[v]]).split("\r\n")[1]).toMatch(/^"?'/));
// control-list.test.tsx
it("shows review status as an icon and words, never colour alone", ...); // "1 of 2 mappings reviewed" text + svg
it("the search form is a labelled search landmark", ...);
it("says plainly when nothing matches", ...);
// mapping-row.test.tsx
it("shows 'Not yet reviewed', and the button only with library.review", ...);
it("after marking, shows 'Reviewed by Carl Ciso on …' and announces it", ...);
// export-route.test.ts (mock callApi)
it("returns text/csv with the version in the filename and headers from en.json", ...);
it("redirects to sign-in without a session", ...);
// api-client.test.ts
it("rejects a response larger than 5 MB", ...);
// messages.test.ts
it("en.json stays under 500 lines", ...);
// e2e/library.spec.ts (CISO_STATE; the shipped library is seeded; Carl Ciso has the ciso role from org-setup)
test("a CISO finds a control by reference and marks a mapping reviewed", ...);
  // search "A.8.13" → at least one card; open first; first "Not yet reviewed" row → Mark as reviewed → "Reviewed by Carl Ciso"
test("unreviewed status is visible to every library reader", ...);    // admin sees "Not yet reviewed" and no Mark button
test("the export downloads a CSV with one row per mapping", ...);     // download event; first line = en headers; rows > 93
test("people without library access don't see Controls", ...);       // reporter: no nav link; /library → forbidden screen
for (const theme of ["light", "dark"] as const)
  test(`axe: no violations on the library list and a control in ${theme}`, ...);
```

- [ ] **Step 2: Run** `pnpm --filter @isms/web test && pnpm e2e`. Expected: FAIL.
- [ ] **Step 3: Implement** the pages, components, route handler, action and messages.
- [ ] **Step 4: Run** `pnpm typecheck && pnpm lint && pnpm format:check && pnpm boundaries && pnpm test && pnpm test:integration && pnpm e2e`. Expected: PASS.
- [ ] **Step 5: Commit** with `feat(web): control library browser with mapping review and CSV export`. Push, open the PR into `main`, and confirm every CI job is green.

---

## Definition of done for Plan 2

- `pnpm run setup && pnpm dev` from a clean clone migrates the database, seeds the library, and lets `admin@example.test` complete organisation setup at `http://localhost:3000/setup`.
- `pnpm db:seed` reports 93 Annex A reference points, 16 GDPR and 10 NIS2 reference points, and no coverage gaps. Running it again creates nothing and keeps every review.
- A CISO can search the library, see every mapping's review status, mark one reviewed (audited), and export the library as CSV.
- Every setup change and every role change appears in `AuditEvent`, written in the same transaction as the change.
- ADR-0008 exists. ADRs 0004, 0005 and 0006 reflect Tasks 1, 8 and 9.
- The Review Focus tests exist and pass. Every CI job is green on the PR into `main`.
