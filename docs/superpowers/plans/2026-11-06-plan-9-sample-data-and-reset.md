# Plan 9 — Sample Data and Reset Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On an instance switched into demo mode, an administrator can:
- load a realistic, deterministic year of activity for "Isarwerk Finanz AG (sample)";
- reset the instance to a fresh install.

Both actions need a typed confirmation. Neither exists anywhere else.

**Architecture:**
- **Package:** a new package `@isms/demo` (`packages/demo`) holds:
  - `resetInstance`: TRUNCATE as owner, re-sync the library, clear the evidence objects, Redis sessions and queues;
  - `generateSampleYear`: a seeded generator that writes rows **directly** with Prisma, backdated, in the order the app writes them.
- **Why direct writes:** the API's lifecycle services stamp `new Date()` and refuse past due dates, so they cannot replay a year (P9-R1).
- **Ports:** side effects outside Postgres go through small ports (`ObjectPut`, `ObjectWipe`, `SessionWipe`, `QueueControl`), so the API and the CLI wire them differently.
- **API:** a `demo` module, registered only when `DEMO_TOOLS_ENABLED`, receives the owner URL. It exposes two recent-auth, `organisation.manage` routes.
- **Identity:** `UserProvisioningService` gains the placeholder claim.
- **Web:** a "Demo and training" section at the bottom of Setup, with a typed-confirmation dialog.

**Tech Stack:** As in Plan 8. No new third-party dependencies:
- the seeded random generator is a 10-line mulberry32 in the package;
- UUIDv7 at a given time is a local function.

**Spec:** `docs/superpowers/specs/2026-11-06-phase-3-board-visuals-and-demo-design.md`, §5, §6 and §7. This plan's rulings are P9-R*.

## Global Constraints

- Everything in Plan 7's Global Constraints.
- **Demo mode off means nothing exists:**
  - no routes (404, not 403);
  - no Setup section;
  - no owner connection in the API;
  - `DATABASE_OWNER_URL` is never read by the API config when the flag is false.
- **Demo mode on requires** `BOOTSTRAP_ADMIN_EMAIL` and `DATABASE_OWNER_URL`; config parsing fails otherwise.
- **Confirmation:** both actions require `confirm` equal to the organisation name, or `RESET` when there is no organisation. The server checks it too (400 `confirmationMismatch`), not only the button.
- **Sample data never mixes with real data:** load always resets first.
- **Sample people are visibly fictional:**
  - emails `@example.test`;
  - the company name ends "(sample)";
  - sample board narratives start "Sample narrative:".
- **No AI interactions or AI settings are generated.**
- **History is real history:**
  - each change writes `Risk` / `RiskVersion` / `AuditEvent` (and `Approval`, `Task`, … as the API would) with the backdated time and the acting person;
  - ids are UUIDv7 for that time;
  - the same snapshot shape as `apps/api/src/risks/risk-versions.ts`;
  - audit action names and payload shapes exactly as the API writes them.
- **Determinism:** fixed seed; all dates are offsets from `now` (whole UTC days, plus a seeded minute-of-day). Two loads at the same `now` give identical rows, apart from the loader-dependent admin.
- **Performance:** load in under 30 seconds on a laptop. Use `createMany` per table, inside one transaction.
- Copy goes in `apps/web/messages/en/setup.json`.

## Review Focus

1. **The loader is not the bootstrap admin, and not `@example.test`** (for example `loader@corp.example` on a local instance where `BOOTSTRAP_ADMIN_EMAIL` is someone else). They still hold administrator after loading. P9-R3: the loader's `User` row is recreated with their **exact** `idpIssuer` / `idpSubject`, so no claim is needed. *(Task 4 test.)*
2. **A second sign-in race.** Two `@example.test` sign-ins for the same placeholder at once. The claim is a single `UPDATE … WHERE idpIssuer = 'pending:' AND email = $1` that affects 0 or 1 rows. The loser falls through to the normal upsert and finds the claimed row by issuer and subject. There is never a duplicate user. *(Task 3 test.)*
3. **Reset while a worker job is mid-flight**, for example `risk.suggest_controls` for a risk that no longer exists. P9-R4: reset drains the waiting and delayed jobs of every queue (`Queue.drain(true)`). A job already running finds no risk and completes as a no-op; Task 2 verifies or adds that guard. *(Task 2 test.)*
4. **Typed confirmation with surrounding spaces or different case.** The comparison trims and is case-sensitive. "isarwerk finanz ag (sample)" does not match. The button stays disabled, and the server returns 400 if called directly. *(Task 4 and Task 5 tests.)*
5. **A scoped viewer after load.** Olga Owner (scoped to Munich) sees fewer risks than Carl Ciso. The board pack, register and maps all show something for both. *(Task 1 assertions on generated data, plus Task 6 e2e.)*

---

### Task 1: The generator (`@isms/demo`, pure part)

**Files:**
- Create: `packages/demo/{package.json,tsconfig.json,vitest.config.ts,src/index.ts}`, following `packages/control-library`'s layout. Dependencies: `@isms/database`, `@isms/domain`, `@isms/control-library`.
- Create:
  - `packages/demo/src/random.ts`;
  - `src/uuid7.ts`;
  - `src/company.ts`: the company, sites, departments, frameworks, scale and appetite, people;
  - `src/year.ts`: the event plan;
  - `src/rows.ts`: event plan → table rows;
  - `src/snapshot.ts`.
- Test: `packages/demo/test/*.test.ts`, plus `apps/api/test/demo/snapshot-parity.test.ts`.

**Interfaces (Produces):**
```ts
export function rng(seed: number): () => number;                        // mulberry32
export function uuidv7At(at: Date, rand: () => number): string;
export const SAMPLE_ORG_NAME = "Isarwerk Finanz AG (sample)";
export const SAMPLE_DOMAIN = "@example.test";
export type SamplePerson = { key: string; email: string; displayName: string; signsIn: boolean;
  roles: { role: RoleName; scope: { kind: "organisation" } | { kind: "site"; site: string } | { kind: "department"; department: string } }[] };
export const SAMPLE_PEOPLE: readonly SamplePerson[];   // 6 dev users (spec §5.3 roles; Olga scoped to Munich) + 10 fictional, never signing in
export type SampleEvent =
  | { at: Date; kind: "report"; risk: string; by: string } | { at; kind: "edit"; … } | { at; kind: "submit" } | { at; kind: "return"; concern: string }
  | { at; kind: "approve" } | { at; kind: "accept" } | { at; kind: "close" } | { at; kind: "reassess" } | { at; kind: "review" }
  | { at; kind: "action_open" | "action_done"; due: string } | { at; kind: "control_accept" } | { at; kind: "evidence" }
  | { at; kind: "control_test"; result: "effective"|"partially_effective"|"ineffective" } | { at; kind: "soa"; applicable: boolean; justification: string }
  | { at; kind: "narrative"; periodKey: string; text: string };
/** The whole year, sorted by `at`. Pure: same (now, seed) → same plan. */
export function planSampleYear(now: Date, seed?: number): { people: SamplePerson[]; events: SampleEvent[] };
/** Rows per table, ready for createMany, with ids, createdAt and occurredAt set. */
export function rowsFor(plan, ctx: { now: Date; library: LibraryIds; loader: LoaderIdentity | null; bootstrapEmail: string | null }): SampleRows;
export function versionSnapshot(risk: RiskRow, assets: { name; type }[], controls: string[], lifecycleNote?: string): Prisma.InputJsonObject;
```
Fill in the field shapes by reading the API services named in the survey: `approval.service.ts`, `risk-lifecycle.service.ts`, `treatment.service.ts`, `risk-controls.service.ts`, `control-operation.service.ts`, `evidence.service.ts`, `soa.service.ts`, `narrative.service.ts` and `risk-report.service.ts`. For each event kind, the generator writes the same rows and the same audit action with the same payload keys.

The year (spec §5.3):
- about 120 risks over 12 months, with an irregular weekly rhythm: a busy 3 weeks about 7 months ago "after an incident", and a quiet last two weeks of December;
- every path:
  - proposed and never submitted;
  - returned with a concern, then resubmitted and approved;
  - approved with actions done, open and overdue;
  - closed, some reassessed;
  - accepted;
  - reviews done, due and overdue;
- expected scores on most approved or closed risks, none on some proposed ones;
- above-appetite count falling over the year;
- assets and controls accepted;
- evidence linked to controls;
- control tests in all three results;
- SoA decisions with some "Not applicable";
- narratives for 3 past months;
- tasks of every `TaskKind`.
- At least one fictional owner has ≥ 8 open risks and ≥ 3 overdue actions; at least one closes steadily.

- [ ] **Step 1: Write failing tests:**
  - `rng(42)` and `uuidv7At` are deterministic; `uuidv7At` encodes the timestamp, so ids sort by time;
  - `planSampleYear(now)` twice is deep-equal;
  - events are sorted and none is after `now`;
  - every `RiskState`, every `TaskKind` and all three test results appear;
  - ≥ 1 `close` followed by `reassess`;
  - risk count 100–140;
  - every sample email ends `@example.test`;
  - the above-appetite count at month 2 is greater than at month 11 (replay the plan);
  - `rowsFor` gives every `RiskVersion` a `version` sequence of 1..n per risk; every audit row has an actor id that exists in the user rows;
  - Olga's scope covers only Munich, and Munich has fewer risks than the total;
  - **snapshot parity** (in `apps/api/test/demo/`): the set of keys of `versionSnapshot(...)` equals the set of keys produced by the API's `writeVersion` for an equivalent risk. Run `writeVersion` against the test database in a transaction and roll back.
- [ ] **Step 2: Run** `pnpm --filter @isms/demo test`. Expected: FAIL.
- [ ] **Step 3: Implement.** Add the package to the workspace and to the boundaries config: packages may not import apps.
- [ ] **Step 4: Run** the demo tests, the parity test, typecheck and boundaries. Expected: PASS.
- [ ] **Step 5: Commit** `feat(demo): deterministic sample year generator`.

### Task 2: Reset, load and the CLI

**Files:**
- Create:
  - `packages/demo/src/ports.ts`;
  - `src/reset.ts`;
  - `src/load.ts`;
  - `src/cli/{load.ts,reset.ts}`;
  - root `package.json` scripts `demo:load` and `demo:reset`: `pnpm --filter @isms/demo cli:load` / `cli:reset`, run with tsx and reading `.env` like the seed CLI.
- Modify: `packages/database/src/test-db.ts`. Extract the TRUNCATE body into an exported `truncateAll(sql)`. `resetTestDatabase` keeps its `_test` guard and calls it.

**Interfaces (Produces):**
```ts
export type DemoPorts = {
  wipeEvidence(): Promise<number>;                    // delete every object under "evidence/" (paged ListObjectsV2 + DeleteObjects)
  putEvidence(key: string, body: Uint8Array, contentType: string): Promise<void>;
  wipeSessions(): Promise<number>;                    // SCAN MATCH sess:* + UNLINK, batched
  drainQueues(): Promise<void>;                       // Queue.drain(true) for every JobContracts name and DEAD_LETTER_QUEUE
  enqueueLibraryEmbed(): Promise<void>;               // "library.embed" { requestedAt }
};
export type DemoActor = { email: string; idpIssuer: string; idpSubject: string } | { email: string; cli: true };
/** Owner connection. One transaction: truncateAll → syncControlLibrary(loadLibrary()) → AuditEvent demo.reset {actorEmail} (actorUserId null). Then ports: wipeEvidence, wipeSessions, drainQueues, enqueueLibraryEmbed. */
export async function resetInstance(ownerDb: PrismaClient, ports: DemoPorts, actor: DemoActor): Promise<void>;
/** resetInstance, then (one transaction) rowsFor(planSampleYear(now)) via createMany in FK order, AuditEvent demo.sample_loaded {actorEmail, risks, people} last, then putEvidence for each evidence object. */
export async function loadSample(ownerDb: PrismaClient, ports: DemoPorts, actor: DemoActor, opts: { now: Date; bootstrapEmail: string | null }): Promise<{ risks: number; people: number; ms: number }>;
export function createDefaultPorts(cfg: { s3: StorageSettings; redisUrl: string }): DemoPorts;  // used by CLI and API
```

Rules:
- **P9-R2:**
  - `demo.reset` and `demo.sample_loaded` are written with `actorUserId: null` and `payload.actorEmail`;
  - `demo.reset` is the first event of the new trail, with `occurredAt` = the real now;
  - sample history is backdated **before** it;
  - `demo.sample_loaded` is the newest event.
  - So the trail reads: past sample history, then "reset by X at T", then "sample loaded by X at T".
- Evidence uploads happen after the database commit. If one fails, the rows stay. Downloads of that file then 404 as for any missing object, and the load result reports `evidenceFailed: n`.
- **P9-R4:** queues are drained. Check `apps/worker` processors for `risk.suggest_controls` and `risk.review_due` exit cleanly when the risk is missing, and add the guard if one does not.
- **CLI:**
  - refuses unless `DEMO_TOOLS_ENABLED=true`;
  - uses `DATABASE_OWNER_URL`;
  - the actor is `{ email: BOOTSTRAP_ADMIN_EMAIL ?? "cli", cli: true }`;
  - prints counts and duration.

- [ ] **Step 1: Write failing integration tests** (`packages/demo/test/*.int.test.ts` against the test database, with fake ports recording calls):
  - reset empties every table except `_prisma_migrations`;
  - the library is present afterwards; the first and only audit row is `demo.reset`;
  - ports are called in order;
  - load twice gives identical row counts per table, and identical risk references and titles;
  - `demo.sample_loaded` is the newest audit row;
  - the audit `occurredAt` and `RiskVersion.createdAt` of sample rows are in the past and match the plan;
  - load completes in < 30 s (assert < 30 000 ms and log the time);
  - a worker processor given a missing risk id resolves without throwing.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the demo integration tests and the database tests (`resetTestDatabase` is unchanged in behaviour), then run `pnpm demo:load` against the dev stack and open the app. Expected: PASS, and the home, risks, map and board pack all show data.
- [ ] **Step 5: Commit** `feat(demo): reset and sample load with CLI`.

### Task 3: Config, the API demo module and the placeholder claim

**Files:**
- Modify:
  - `packages/config/src/schemas.ts`: `demoConfig = z.object({ DEMO_TOOLS_ENABLED: z.stringbool().default(false) })`, using the repo's existing boolean env helper if there is one. Add a `superRefine` on the API's merged schema in `apps/api/src/config.ts`: when true, `BOOTSTRAP_ADMIN_EMAIL` and `DATABASE_OWNER_URL` are required. The owner URL is parsed **only** inside that branch, and lives at `config.demo = { ownerUrl } | null`.
  - `apps/api/src/app.module.ts`: `DemoModule.register(config.demo)` returns an empty module when it is null.
  - `apps/api/src/identity/user-provisioning.service.ts`: add `demoTools: boolean` to `ProvisioningOptions`.
- Create:
  - `apps/api/src/demo/{demo.module.ts,demo.controller.ts,demo.service.ts,index.ts}`;
  - `packages/contracts/src/routes/demo.ts` (`demoRoutes`). Do **not** add them to `allRoutes`'s always-on list. Mark them `conditional: "demo"` (or the repo's equivalent), so the OpenAPI snapshot documents them and the route-coverage test knows they may be absent.

**Interfaces (Produces):**
```ts
DemoStatusResponse = { enabled: true, organisationName: string | null }       // GET  /api/v1/demo           organisation.manage
DemoConfirmInput   = { confirm: string }
DemoLoadResponse   = { risks: int, people: int, ms: int, evidenceFailed: int } // POST /api/v1/demo/sample   organisation.manage, recentAuth
                                                                               // POST /api/v1/demo/reset    organisation.manage, recentAuth → 204
// conflict reason: "confirmationMismatch" (400)
```

Placeholder rules (P9-R3):
- The generator writes non-signing-in people and absent dev users with `idpIssuer = "pending:"` and `idpSubject = <email>`.
- It writes the loader with their real issuer and subject.
- It writes the bootstrap email (when it is not the loader) as a placeholder.
- In `resolve`, **before** `upsertUser`, when all of these hold:
  - `demoTools`;
  - `token.emailVerified`;
  - (`email` ends `@example.test`, or `email` equals `bootstrapAdminEmail`, case-insensitive);
  - no user exists for (issuer, subject);

  run one `UPDATE "User" SET "idpIssuer"=$iss, "idpSubject"=$sub WHERE "idpIssuer"='pending:' AND lower(email)=lower($email)`. Audit `identity.placeholder_claimed` when one row changes.
- The bootstrap email is claimable because it is already trusted by config. Any other real-looking address never is.
- After reset there is no admin, so the normal bootstrap grant applies. After load, the loader and the bootstrap user already hold administrator.

- [ ] **Step 1: Write failing tests:**
  - config: enabled without the bootstrap email → error naming it; enabled without the owner URL → error; disabled with the owner URL set → `config.demo === null`;
  - API integration (`apps/api/test/demo/demo.int.test.ts`, with demo on and fake ports injected via the `DEMO_PORTS` token):
    - GET status as admin;
    - a contributor → 403;
    - no recent auth → the existing recent-auth refusal;
    - wrong confirm → 400 `confirmationMismatch`;
    - " Isarwerk…" with spaces → accepted after trim; a different case → 400;
    - reset → 204, and the audit trail is `[demo.reset]`;
    - load → counts;
    - the loader (an arbitrary issuer/subject, email `loader@corp.example`) still resolves to an administrator afterwards (Review Focus 1);
  - a separate app instance with demo off: every demo route → 404;
  - provisioning: an `@example.test` verified sign-in claims the placeholder and keeps its roles; an unverified one → no claim (new user, no roles); `someone@bank.example` with a pending row → no claim; the bootstrap email → claimed; two concurrent claims → one user (Review Focus 2).
- [ ] **Step 2: Run** the config, provisioning and demo tests. Expected: FAIL.
- [ ] **Step 3: Implement.** Update the OpenAPI snapshot with `-u` and review it.
- [ ] **Step 4: Run** the config, identity, demo and contracts tests, typecheck, lint and boundaries. Expected: PASS.
- [ ] **Step 5: Commit** `feat(api): demo mode routes and placeholder sign-in claim`.

### Task 4: Setup "Demo and training" section

**Files:**
- Create:
  - `apps/web/components/setup/demo-tools.tsx`: `DemoTools({ status })`. It shows "Demo mode is on" and the two actions with the spec's copy (§5.2).
  - `apps/web/components/setup/demo-confirm-dialog.tsx`. It lists what is deleted: risks, evidence files, history and audit trail, settings including the AI provider key, everyone's sign-in. It has a text field whose label says to type the organisation name (or `RESET`). The confirm button is disabled until `value.trim() === expected`. The load action shows "Loading sample data…" with `aria-busy` during the request.
  - Server actions in `apps/web/app/(app)/setup/demo-actions.ts`, following the existing setup actions and the recent-auth re-prompt pattern used for role changes. On success, clear the local session cookie and redirect to `/` (sign-in).
- Modify: `apps/web/app/(app)/setup/page.tsx`. Fetch `GET /api/v1/demo`; a 404 renders nothing. Then render `DemoTools` at the bottom.
- Modify: `apps/web/messages/en/setup.json`, all copy.
- Test: `apps/web/test/setup/demo-tools.test.tsx`:
  - hidden when the status is absent;
  - the button is disabled until an exact match; a trailing space matches; a lower-case value does not;
  - `RESET` is expected when `organisationName` is null;
  - the dialog lists the five deletions;
  - the busy state while loading;
  - the action error copy for `confirmationMismatch` and recent auth.

- [ ] **Step 1: Write failing tests.**
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the web tests, typecheck and lint. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): demo and training tools in Setup`.

### Task 5: Operations doc, end-to-end and final gate

**Files:**
- Modify: the operations doc in `docs/` (find the existing operations/deployment doc; extend it, do not create a new top-level file). Add:
  - `DEMO_TOOLS_ENABLED`;
  - the two required settings;
  - "every demo instance is its own deployment: own database, bucket and Redis";
  - the six sign-in accounts a hosted demo's operator must create;
  - `pnpm demo:load` / `demo:reset`.
- Modify: `.env.example` (`DEMO_TOOLS_ENABLED=false`, with a comment).
- Create: `e2e/demo.spec.ts`, its own Playwright project, run **last** because it wipes everything, including sessions. The API server for this project starts with `DEMO_TOOLS_ENABLED=true`. If one server process cannot serve both modes, add a second `webServer` entry on another port.

Scenario:
1. As Anna Admin, open Setup → "Demo and training" → Load sample data.
2. The button is disabled until "RESET", or the org name, is typed. Confirm.
3. Expect a sign-out. Sign in as Anna Admin again: the placeholder is claimed and she is administrator.
4. The risks list shows about 120. The board pack for last month shows 7 tiles, a movement chart and an owner table with at least 10 rows.
5. A sample evidence file downloads.
6. Sign in as Olga Owner: fewer risks than Anna.
7. As Anna: Reset everything and confirm. After signing in again, Setup is at its first step and the risks list is empty.
8. A second test hits `POST /api/v1/demo/reset` on the demo-off server and expects 404.
9. Run axe on the Setup page with the section and the dialog open.

- [ ] **Step 1: Write the doc changes and the spec.**
- [ ] **Step 2: Run** the full e2e suite. Expected: PASS, and the earlier projects are unaffected.
- [ ] **Step 3: Run the full gate:** `pnpm typecheck && pnpm lint && pnpm format:check && pnpm test && pnpm test:integration && pnpm boundaries && pnpm e2e`. Expected: all PASS.
- [ ] **Step 4: Commit** `test(e2e): demo load and reset; docs: demo mode operations`.
