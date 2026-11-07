# Plan 6 — Closing the Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:**
- An approved risk gets a treatment plan of actions with owners and due dates.
- It can be marked as treated (**closed**) once every action is done.
- It comes back for review on a schedule.
- Controls in use get recorded tests.

Every step is explicit, attributed, versioned and audited.

**Architecture:**
- **Domain:** the extended state machine (`closed`; actions close, reassess, confirmReview), review-due dates, and journey cycles.
- **Database:**
  - a `closed` state;
  - closing, review-due and task-completion columns;
  - two new task kinds;
  - an organisation review interval;
  - an append-only `ControlTest` with evidence links;
  - a `controls.test` permission.
- **API:**
  - a lifecycle service (close / reassess / confirmReview);
  - treatment actions as tasks;
  - review-due tasks created by a scheduled worker job (BullMQ job scheduler, new in `@isms/jobs`);
  - the control "in operation" read model and test recording.
- **Web:**
  - lifecycle buttons;
  - the treatment plan editor;
  - task list kinds;
  - the review interval setting;
  - the control "In operation" panel;
  - the Closed journey step and an "include closed" map toggle.

**Tech Stack:** Unchanged from Plan 5. BullMQ's `upsertJobScheduler` (already a dependency of `@isms/jobs`). No new packages.

**Spec:** `docs/superpowers/specs/2026-11-06-phase-2-visuals-loop-reports-design.md`:
- §4 (Part B) and §6;
- the "include closed" items of §3.2–§3.4.

The foundation spec still binds, and so do Plan 5's rulings (P5-R1–R4). This plan's rulings are P6-R*.

## Global Constraints

- Everything in Plan 5's Global Constraints, unchanged. In particular:
  - files under 500 lines;
  - TDD;
  - rules only in the domain or the API;
  - copy only in message files (new keys under `insights.*` in `apps/web/messages/en/insights.json`, or a new `apps/web/messages/en/loop.json` with top-level key `loop` if insights.json would pass 450 lines);
  - the OpenAPI snapshot and the exact-routes list are updated deliberately;
  - visibility only through `riskVisibilityWhere` / `riskVisibilitySql`.
- Plain words in the UI:
  - close = **"Mark as treated"**;
  - reassess = **"Reassess"**;
  - confirmReview = **"Confirm still accurate"**;
  - treatment action = **"Action"**, in a **"Treatment plan"**;
  - periodic review task = **"Review this risk"**.
- Notes and reasons: 1–2000 characters (`text(2000, "multiline")`), except where a task says optional.
- Every new state change writes a `RiskVersion` (when the risk changes) and an `AuditEvent`. Free text is audited by length only, as today.
- New conflict reasons go in `packages/contracts/src/conflicts.ts` `ConflictReasonSchema`:
  - `openTreatmentActions`
  - `treatmentIsAccept`
  - `riskClosed`
  - `taskNotAssignee`
- Dates are ISO dates (`YYYY-MM-DD`), computed in UTC.

## Review Focus

1. **Closing while an action is open**, including an action created by someone else a second earlier. `close` must lock the risk and re-check inside the transaction, giving 409 `openTreatmentActions`. *(Task 4 test; the lock is in `close`.)*
2. **A reassessed risk's journey.** After approved → reassess → submit → approve, the tracker shows the *current* cycle (Being reviewed, then Waiting for approval, then Approved again), not a mix of the old and new cycles, and the return count covers only the current cycle. *(Task 2 and Task 4 tests.)*
3. **The review job runs twice on the same day**, or two workers run it at once. Exactly one open `periodic_review` task per risk. *(Task 3 and Task 6 tests, using a unique partial index.)*
4. **A viewer** sees approved **and closed** risks in scope, and nothing proposed. A contributor assigned a treatment action sees the action and the risk reference in their tasks, but still gets 404 on the risk. *(Task 3 and Task 5 tests.)*
5. **Month-end review dates.** Approved on 31 January with a 1-month interval → due 28 February (29 in a leap year), never 3 March. *(Task 2 test.)*

---

### Task 1: Split the risk contracts (refactor only)

**Files:**
- Modify: `packages/contracts/src/routes/risks.ts` (490 lines). Move the DTO schemas into a new `packages/contracts/src/routes/risk-dtos.ts`:
  - `RiskSummaryDto`, `RiskDetailDto`, `RiskControlDto`, `EvidenceDto`, `RiskHistoryEntryDto`;
  - the approval DTOs and the journey DTOs.

  `risks.ts` keeps the inputs and `riskRoutes`, and re-exports everything moved, so **no import anywhere else changes**. There must be no import cycle; check that `risk-insights.ts` still resolves.
- Test: the existing contract tests and the OpenAPI snapshot, unchanged (a byte-identical snapshot proves the refactor).

- [ ] **Step 1:** Run `pnpm --filter @isms/contracts test`. Expected: PASS (the baseline).
- [ ] **Step 2:** Move the code.
- [ ] **Step 3:** Run the contract tests with `CI=true` (the snapshot must not change), then `pnpm -r typecheck` and `pnpm boundaries`. Expected: PASS, with no snapshot diff.
- [ ] **Step 4: Commit** `refactor(contracts): split risk DTOs out of the risk routes`.

### Task 2: Domain — lifecycle, review dates, journey cycles

**Files:**
- Modify: `packages/domain/src/risk.ts`:
  - `RISK_STATES` gains `"closed"`;
  - `RiskAction` gains `"close" | "reassess"`;
  - `nextState`:
    - close: approved → closed;
    - reassess: approved | closed → proposed;
    - existing actions unchanged; closed is not editable.
- Create: `packages/domain/src/review.ts`.
- Modify: `packages/domain/src/journey.ts`:
  - `JOURNEY_STEPS` gains `"closed"` after `"approved"`;
  - only the **current cycle** counts.
- Modify: `packages/domain/src/index.ts`.
- Test: `packages/domain/test/risk.test.ts` (extend), `packages/domain/test/review.test.ts`, `packages/domain/test/journey.test.ts` (extend).

**Interfaces (Produces):**
```ts
// risk.ts
export function mayConfirmReview(state: RiskState): boolean; // approved | closed
export function mayPlanActions(state: RiskState, treatment: Treatment | null): boolean; // state !== closed && treatment !== "accept" && treatment !== null
// review.ts
export const MIN_REVIEW_INTERVAL_MONTHS = 1;
export const MAX_REVIEW_INTERVAL_MONTHS = 36;
export const DEFAULT_REVIEW_INTERVAL_MONTHS = 12;
/** from (a UTC instant) + months, as YYYY-MM-DD; clamps to the target month's last day. */
export function reviewDueDate(from: Date, months: number): string;
/** due <= today (both YYYY-MM-DD). */
export function isReviewDue(due: string, today: string): boolean;
/** YYYY-MM-DD of d in UTC. */
export function isoDateUtc(d: Date): string;
// journey.ts: riskJourney(changes) keeps its signature; JourneyStep keys now include "closed".
```

Journey rules (P6-R1):
- The **cycle** starts at the first change, or at the last change into `proposed` that follows an approved or closed state (a reassess). Only changes from the cycle start onwards decide the steps and `returnCount`.
- When the cycle starts with a reassess, the `reported` step is done, with at/by = the reassess change. The web labels it "Reassessed" in that case: add `cycle: "first" | "reassessed"` to the result.
- Closed state:
  - `approved` done (at/by = the last change to approved);
  - `closed` current (at/by = the change to closed).
- Every other state: `closed` upcoming.

- [ ] **Step 1: Write failing tests:**
  - The state machine table from spec §4.1. Closed is not editable. Submit from closed → null.
  - `mayConfirmReview` and `mayPlanActions` for each state and treatment.
  - `reviewDueDate`:
    - `(2026-01-31T10:00Z, 1)` → `"2026-02-28"`;
    - `(2028-01-31, 1)` → `"2028-02-29"`;
    - `(2026-11-06, 12)` → `"2027-11-06"`;
    - `(2026-08-31, 6)` → `"2027-02-28"`.
  - `isReviewDue("2026-11-06","2026-11-06")` → true. The day before → false.
  - Journey:
    - approved → reassess → submit → return → submit → approve gives `cycle: "reassessed"`, `returnCount` 1 (the earlier cycle's returns are ignored), and approved current;
    - approved → close gives closed current;
    - a fresh risk still gives `cycle: "first"` and closed upcoming.
- [ ] **Step 2: Run** `pnpm --filter @isms/domain test`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the domain tests and typecheck. Expected: PASS. (Typecheck elsewhere may now fail on exhaustive switches over `RiskState`. Fix only compile errors here, with the minimal correct handling, e.g. closed treated like approved for display, and list each in the report. Behaviour comes in later tasks.)
- [ ] **Step 5: Commit** `feat(domain): closed state, review dates and journey cycles`.

### Task 3: Database, permission and visibility

**Files:**
- Modify the Prisma schema:
  - `risk.prisma`: `RiskState` gains `closed`; Risk gains `closedAt DateTime? @db.Timestamptz(3)`, `closedById String? @db.Uuid` (relation "RiskClosedBy"), and `nextReviewDue DateTime? @db.Date`.
  - `evidence-and-tasks.prisma`: `TaskKind` gains `treatment_action` and `periodic_review`. Task gains `completionNote String @default("")`, `completedById String? @db.Uuid` (relation "TaskCompletedBy"), `cancelledReason String @default("")`, and `cancelledById String? @db.Uuid` (relation "TaskCancelledBy").
  - `organisation.prisma`: Organisation gains `reviewIntervalMonths Int @default(12)`.
  - New `library.prisma` models:
    ```prisma
    enum ControlTestResult { effective partially_effective ineffective }
    /// Append-only.
    model ControlTest { id (uuid7) ; controlId Uuid ; testedOn DateTime @db.Date ; result ControlTestResult ;
      method String ; notes String @default("") ; testedById Uuid ; createdAt ; relations ; evidence ControlTestEvidence[] ; @@index([controlId, testedOn]) }
    /// Insert-only.
    model ControlTestEvidence { controlTestId Uuid ; evidenceId Uuid ; @@id([controlTestId, evidenceId]) }
    ```
- Create: `packages/database/prisma/migrations/20261107000000_closing_the_loop/migration.sql`. Generate it as context.md describes, then add the tail:
  - check constraints: `Organisation_reviewIntervalMonths_check` (1–36), `ControlTest_method_check` (length 1–4000);
  - `REVOKE UPDATE, DELETE, TRUNCATE ON "ControlTest", "ControlTestEvidence" FROM isms_app;`
  - a **unique partial index** `Task_one_open_periodic_review` on `("riskId") WHERE kind = 'periodic_review' AND status = 'open'`;
  - a comment citing Plan 6.

  Note: `ALTER TYPE … ADD VALUE` cannot run inside the same transaction as statements that use the new value. Check how Prisma emits it, and split it into two migrations (`…000000_closing_the_loop_enums` and `…000100_closing_the_loop`) if needed.
- Modify:
  - `apps/api/src/authorization/roles.ts`: a new permission `controls.test` for ciso and risk_owner. Add it to `PermissionSchema` in `packages/contracts/src/permissions.ts`. It is not scoped.
  - `apps/api/src/risks/risk-visibility.ts`: the viewer grant `state: "approved"` becomes `state in (approved, closed)`, in both the Prisma and the SQL forms.
  - `apps/api/src/risks/risk-versions.ts`: the snapshot gains `closedAt`, `closedById` and `nextReviewDue`.
  - `apps/api/src/risks/mappers.ts`: the detail gains `closedAt`, `closedBy` (PersonRef) and `nextReviewDue` (ISO date or null). The contracts gain these in `risk-dtos.ts`.
  - The map (`risk-insights.service.ts`): add an `includeClosed` query flag (default false). Closed risks are excluded unless it is set. `RiskMapQuery` gains `includeClosed: z.coerce.boolean().default(false)`; use the stringbool pattern the codebase uses for query booleans, if one exists.
  - `apps/api/src/workspace/workspace.service.ts`: dimensions `risks` gains `closed`.
- Test:
  - `packages/database/test/closing-the-loop-grants.int.test.ts`: append-only ControlTest; the partial unique index refuses a second open periodic_review for the same risk; the check constraints.
  - `apps/api/test/risks/visibility*.ts`: a viewer sees a closed risk in scope.
  - The map test: closed excluded by default, included with the flag.
  - The snapshot.

- [ ] **Step 1: Write failing tests** (above).
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** Run the migration against the test and dev databases, then `pnpm db:validate`.
- [ ] **Step 4: Run** the database, risks and workspace integration tests, contracts, `pnpm -r typecheck` and web tests (update the fixtures). Expected: PASS.
- [ ] **Step 5: Commit** `feat(db): closed state, task kinds, review interval and control tests`.

### Task 4: Lifecycle API — close, reassess, confirm review; review dates on approval

**Files:**
- Create: `apps/api/src/risks/risk-lifecycle.service.ts`, `apps/api/src/risks/risk-lifecycle.controller.ts`, both registered in `risks.module.ts`.
- Create: `packages/contracts/src/routes/risk-lifecycle.ts` (`riskLifecycleRoutes`, inputs), added to `allRoutes` and the index.
- Modify:
  - `apps/api/src/risks/approval.service.ts`: on approve, set `nextReviewDue = reviewDueDate(now, org.reviewIntervalMonths)` and complete any open `periodic_review` task of the risk (status done, completedById = the approver, completedAt, note "Approved after reassessment"). Include `nextReviewDue` in the version's `changedFields`.
  - `apps/api/src/risks/journey.ts`: steps now include closed; pass through `cycle`. `waitingOn` for approved / closed: a new kind `{ kind: "review", nextReviewDue: string | null }` (add it to `JourneyWaitingDto`).
  - `RiskDetailDto.can` gains `close`, `reassess` and `confirmReview`, true when the action is allowed now for the viewer. `close` is false while open actions exist.

**Interfaces (Produces):**
```ts
CloseRiskInput = { expectedVersion, note: text(2000,"multiline") }
ReassessRiskInput = { expectedVersion, reason: text(2000,"multiline") }
ConfirmReviewInput = { expectedVersion, note: textOrEmpty(2000,"multiline") }
riskLifecycleRoutes.close   POST /api/v1/risks/{id}/close           risks.review → 200 RiskDetailDto | 404 | 409
riskLifecycleRoutes.reassess POST /api/v1/risks/{id}/reassess       risks.review → 200 | 404 | 409
riskLifecycleRoutes.confirmReview POST /api/v1/risks/{id}/review-confirmation risks.review → 200 | 404 | 409
class RiskLifecycleService { close(actor,id,input,ctx); reassess(actor,id,input,ctx); confirmReview(actor,id,input,ctx) } // each returns RiskDetailDto
```

Rules. Each action runs in one transaction that:
1. locks the risk (`FOR UPDATE`);
2. reads it with `getVisible`;
3. checks `policy.can(actor, "risks.review", riskScope(row))`;
4. checks the state with `nextState` / `mayConfirmReview` (409 `invalidTransition`);
5. checks the version (409 `staleVersion`).

Then, per action:
- **close:** count open `treatment_action` tasks; if any exist, 409 `openTreatmentActions`. Set state closed, `closedAt` and `closedById`, and `nextReviewDue = reviewDueDate(now, interval)`. Write a version (`["state","closedAt","closedById","nextReviewDue"]`) and audit `risk.closed` (note length only).
- **reassess:** set state proposed, `nextReviewDue` null, `closedAt` / `closedById` null, `reviewerId` null, `submittedAt` null. Version and audit `risk.reassessed` (reason length). Open treatment actions stay open.
- **confirmReview:** set `nextReviewDue = reviewDueDate(now, interval)`. Complete any open periodic_review task (completedById = actor, note = input.note). Version (`["nextReviewDue"]`) and audit `risk.review_confirmed`.
- The reason and note text are kept on the version: add an optional `note` to the `RiskVersion` snapshot under the key `lifecycleNote`. (The append-only history is the record; the length-only audit stays as it is.)

The interval comes from `Organisation.reviewIntervalMonths`. Read it inside the transaction.

- [ ] **Step 1: Write failing integration tests** (`apps/api/test/risks/lifecycle.int.test.ts`):
  - close an approved risk with no actions → 200, state closed, `nextReviewDue` = today + 12 months, a version and an audit row;
  - close with one open treatment action → 409 `openTreatmentActions` (create the task row directly with the test DB client);
  - close a proposed risk → 409 `invalidTransition`;
  - a viewer → 403 or 404, as other write routes do;
  - reassess a closed risk → proposed and editable, `nextReviewDue` null; then submit → approve → `nextReviewDue` set again, and the journey shows `cycle: "reassessed"`;
  - confirmReview on an approved risk with an open periodic_review task → the task is done, `nextReviewDue` moves on, a version and an audit row;
  - confirmReview on a proposed risk → 409;
  - approving sets `nextReviewDue`;
  - `can.close` is false with an open action;
  - stale version → 409.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the risk integration folder, the contracts and snapshot, typecheck and api lint. Expected: PASS.
- [ ] **Step 5: Commit** `feat(risks): mark as treated, reassess and confirm review`.

### Task 5: Treatment actions API and task changes

**Files:**
- Modify:
  - `packages/contracts/src/routes/evidence.ts`. `MyTaskDto` gains `kind: z.enum(["evidence_request","treatment_action","periodic_review"])`, `control` becomes nullable, and it gains `description: z.string()`. Web consumers are fixed in Task 8; keep the web typecheck green now with minimal fixture and type updates.
  - Create `packages/contracts/src/routes/treatment.ts`:
    ```ts
    TreatmentActionInput = { title: text(200), description: textOrEmpty(2000,"multiline"), assigneeId: z.uuid(), dueDate: z.iso.date(), controlId: z.uuid().nullable() }
    TreatmentActionDto = { id, title, description, assignee: PersonRef, dueDate, status, overdue, control: {code,title}|null, completedAt|null, completedBy: PersonRef|null, completionNote, cancelledReason }
    TreatmentPlanDto = { actions: TreatmentActionDto[] /* open first by dueDate, then done/cancelled newest first */, open: int, done: int, overdue: int }
    CompleteTaskInput = { note: textOrEmpty(2000,"multiline") }
    CancelTaskInput = { reason: text(2000,"multiline") }
    treatmentRoutes.addAction  POST /api/v1/risks/{id}/actions   risks.review → 201 TreatmentActionDto | 404 | 409
    treatmentRoutes.complete   POST /api/v1/tasks/{id}/complete  me.read     → 200 MyTaskDto | 404 | 409
    treatmentRoutes.cancel     POST /api/v1/tasks/{id}/cancel    risks.review → 200 TreatmentActionDto | 404 | 409
    ```
  - `RiskDetailDto` gains `treatmentPlan: TreatmentPlanDto` and `can.planActions`.
- Create: `apps/api/src/risks/treatment.service.ts` (or in `evidence/`, beside `TasksService`; follow where task code lives and keep files under 500 lines) and its controller.

Rules:
- **addAction:**
  - visible risk, `risks.review` at scope, `mayPlanActions(state, treatment)` (409 `riskClosed` / `treatmentIsAccept`);
  - the assignee exists (400 at `assigneeId` otherwise);
  - the control, when given, is accepted on this risk (409 `controlNotAccepted`);
  - lock the risk FOR SHARE while creating;
  - audit `task.created` with kind.
- **complete:**
  - for `treatment_action` and `periodic_review`, allowed when actor = assignee, or the actor holds `risks.review` at the risk's scope;
  - for `evidence_request`, refused with 409 `taskNotAssignee`. Evidence requests still complete by upload; keep that route;
  - a task not open → 409 `taskClosed`;
  - set done, `completedAt`, `completedById`, `completionNote`; audit `task.completed`.
- **cancel:**
  - `treatment_action` only, and the actor holds `risks.review` at scope;
  - set cancelled, `cancelledReason`, `cancelledById`; audit `task.cancelled`.
- **myTasks:** include all kinds. For `periodic_review`, the title is generated: "Review R-0003 {title}". The assignee still never gets the risk record.
- **Workspace:**
  - new statement keys `actionsOverdue` (href `/tasks`), and `reviewsDue` (count of visible approved / closed risks with `nextReviewDue <= today`, href `/risks?filter=reviewDue`);
  - add a `reviewDue` value to `RiskListFilterSchema`, implemented in the list query.
  - Dimensions `tasks.open` / `overdue` already count tasks on visible risks; make sure the new kinds are included.

- [ ] **Step 1: Write failing tests** (`apps/api/test/risks/treatment.int.test.ts`, plus workspace cases):
  - add an action on an approved mitigate risk → 201 and listed in `treatmentPlan`;
  - on an accept risk → 409 `treatmentIsAccept`;
  - on a closed risk → 409 `riskClosed`;
  - with a control not accepted on the risk → 409;
  - the assignee (a contributor) completes it → done, and the contributor still gets 404 on `GET /risks/{id}`;
  - another contributor → 404 or 409 (choose 404 for a task they cannot see, matching `uploadForTask`);
  - cancel by a reviewer → cancelled;
  - cancel by the assignee contributor → 403;
  - an overdue count;
  - close after all actions are done → 200 (end-to-end with Task 4);
  - workspace `reviewsDue` and `actionsOverdue` statements;
  - the `reviewDue` list filter.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the risk, evidence and workspace integration tests, contracts, typecheck and lint. Expected: PASS.
- [ ] **Step 5: Commit** `feat(risks): treatment actions`.

### Task 6: Review interval setting and the daily review job

**Files:**
- Modify:
  - `packages/contracts/src/routes/organisation.ts`: `OrganisationDto` gains `reviewIntervalMonths`; a new route `setReviewInterval` `PUT /api/v1/organisation/review-interval`, permission `organisation.manage`, body `{ months: int 1..36 }`.
  - The organisation API service: audit `organisation.review_interval_changed` with before and after.
  - `packages/jobs/src/contracts.ts`: `"risk.review_due": z.object({ runOn: z.iso.date() })`.
  - `packages/jobs/src/enqueue.ts`: `JobsClient.schedule(name, { pattern: string; tz?: "UTC" }, payloadFactory)`. **P6-R2:** BullMQ job schedulers take a fixed payload, so the payload is `{ runOn: <the date at enqueue time> }` and is ignored by the handler, which uses the current date. Simplify to `schedule(name, pattern, payload)` and document that the handler uses today. Implement with `queue.upsertJobScheduler(\`${name}__daily\`, { pattern, tz: "UTC" }, { name, data: payload })`.
- Create: `apps/worker/src/jobs/review-due.ts`: `reviewDue({ db, logger }, now: Date): Promise<{ created: number }>`. It finds approved / closed risks with `nextReviewDue <= today` and an owner, with no open periodic_review task. It creates one per risk (assignee = owner, requestedById = the owner, dueDate = nextReviewDue, title "Review this risk", riskId), using `createMany({ skipDuplicates: true })` or catching the unique-index violation. It logs the count only. Risks without an owner are skipped and counted in the log.
- Modify: `apps/worker/src/main.ts`: register the processor and schedule `"0 2 * * *"` UTC; also enqueue once at startup (idempotency key = today's date).
- Test:
  - `packages/jobs/test/schedule.test.ts`, unit-level with the existing test approach;
  - `apps/worker/test/review-due.int.test.ts`:
    - due risk → one task;
    - run twice → still one;
    - two parallel runs → one;
    - a not-due or proposed risk → none;
    - no owner → skipped;
  - an organisation integration test for the setting (admin can set it; CISO 403; out of range 400; audit).

- [ ] **Step 1: Write failing tests.**
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the jobs, worker, organisation and risk integration tests, contracts, typecheck and lint. Expected: PASS.
- [ ] **Step 5: Commit** `feat(worker): daily review-due tasks and the review interval`.

### Task 7: Controls in operation API

**Files:**
- Modify: `packages/contracts/src/routes/library.ts`, or create `packages/contracts/src/routes/control-operation.ts` if library.ts would pass 400 lines:
  ```ts
  ControlTestResultSchema = z.enum(["effective","partially_effective","ineffective"])
  ControlTestDto = { id, testedOn: iso.date, result, method, notes, testedBy: PersonRef, evidence: {id, fileName}[] }
  ControlOperationDto = { code, risks: {id, reference, title, state}[] /* visible risks where accepted */, evidenceCount: int /* on visible risks */,
    tests: ControlTestDto[] /* newest first, max 50 */, latest: ControlTestDto|null, testDue: boolean, canRecordTest: boolean,
    evidenceOptions: {id, fileName, riskReference}[] /* visible evidence linked to this control, for the form */ }
  RecordControlTestInput = { testedOn: iso.date (not in the future), result, method: text(4000,"multiline"), notes: textOrEmpty(2000,"multiline"), evidenceIds: z.array(z.uuid()).max(20) }
  routes: operation GET /api/v1/library/controls/{code}/operation (library.read) → 200 ControlOperationDto | 404
          recordTest POST /api/v1/library/controls/{code}/tests (controls.test) → 201 ControlTestDto | 400 | 404
  ControlSummaryDto gains `inUse: boolean`, `latestResult: ControlTestResultSchema.nullable()`; ControlListQuery gains `inUse: boolean filter`.
  ```
- Rules:
  - `testDue` = never tested, or the latest `testedOn` + `reviewIntervalMonths` ≤ today (use `reviewDueDate` / `isReviewDue`).
  - `evidenceIds` must each be linked to this control (`EvidenceControl`) **and** on a risk visible to the actor; otherwise 400 at `evidenceIds.<i>`.
  - A future `testedOn` gives 400.
  - `risks` and `evidenceCount` respect risk visibility. A user without `risks.read` gets `risks: []`, `evidenceCount: 0` and `evidenceOptions: []`.
  - Audit `control.tested` (result, evidence count; method by length).
- Workspace: the dimensions `controls` gains `testedWithinInterval` (accepted controls on visible risks whose latest test is not due).
- Create: `apps/api/src/library/control-operation.service.ts` (plus controller methods).
- Test: `apps/api/test/library/control-operation.int.test.ts`:
  - record a test with linked evidence → 201, and the operation shows it as latest with `testDue` false;
  - unlinked evidence → 400;
  - evidence on a risk the actor cannot see → 400;
  - a future date → 400;
  - a contributor → 403;
  - an auditor can read but not record;
  - `inUse` filter;
  - `testedWithinInterval`.

- [ ] **Step 1: Write failing tests.**
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the library, workspace and risk integration tests, contracts, typecheck and lint. Expected: PASS.
- [ ] **Step 5: Commit** `feat(library): controls in operation and control tests`.

### Task 8: Web — lifecycle, treatment plan, tasks

**Files:**
- Create:
  - `apps/web/components/risks/lifecycle-section.tsx`:
    - shown for approved / closed risks;
    - "Next review due {date}" (or "Due for review" with an icon when past);
    - buttons **Mark as treated** (`can.close`; when false because of open actions, a line "Finish or cancel the open actions first"), **Confirm still accurate**, and **Reassess**, each opening a small dialog with the note or reason field (`@isms/ui` Dialog);
    - calls the lifecycle routes through server actions in `apps/web/lib/actions/risks.ts` (or a new `lib/actions/lifecycle.ts`), with stale-version handling like submit / approve.
  - `apps/web/components/risks/treatment-plan.tsx`:
    - inside the treatment section, below the note, when `can.planActions` or actions exist;
    - progress "2 of 5 done, 1 overdue" with a bar and words;
    - the list of actions (title, assignee, due date, overdue badge, linked control, status);
    - an **Add action** form (title, description, assignee from the existing people picker, due date, optional accepted control);
    - **Mark done** (with optional note) and **Cancel** (reason) per open action, according to permissions.
- Modify:
  - `apps/web/components/risks/risk-detail.tsx`: include `LifecycleSection` after `ApprovalSection`.
  - `apps/web/components/risks/risk-journey.tsx`: the Closed step; "Reassessed" label for the first step when `cycle === "reassessed"`; the `review` waiting kind → "Next review due {date}".
  - `apps/web/components/risks/view-switch.tsx` and `apps/web/app/(app)/risks/page.tsx`: an "Include treated risks" toggle on the map (`includeClosed=true` in the URL).
  - `apps/web/app/(app)/tasks/page.tsx` and its components: show the kind (Evidence request / Action / Review this risk), description, due and overdue. Actions get **Mark done** with a note. Reviews link to the risk when the viewer can see it (`risks.read`), otherwise just show the reference.
  - `apps/web/components/risks/risk-filters.tsx`: a "Due for review" filter.
  - `apps/web/components/home/statements.tsx`: the new statement keys and copy.
  - `apps/web/components/risks/risk-badges.tsx`: a badge for closed ("Treated").
- Test: `apps/web/test/risks/lifecycle.test.tsx`, `apps/web/test/risks/treatment-plan.test.tsx`, `apps/web/test/tasks/*.test.tsx`, plus a journey test for closed and reassessed.

- [ ] **Step 1: Write failing tests:**
  - lifecycle buttons per `can` flags;
  - the open-actions line;
  - dialogs submit a note;
  - plan progress words and overdue;
  - the add-action form validation (title and due date required);
  - task kinds render;
  - the closed and reassessed journey;
  - the new statements.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the web tests, typecheck and lint. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): treatment plan, mark as treated and periodic review`.

### Task 9: Web — review interval and controls in operation

**Files:**
- Modify: `apps/web/app/(app)/setup/risk-appetite/page.tsx` and its form: a "Review risks every N months" number field (1–36), saved through a new server action calling `setReviewInterval`, with plain help text ("Approved and treated risks come back to their owner for review after this long.").
- Create: `apps/web/components/library/control-operation.tsx`:
  - the "In operation" panel on `/library/[code]`: the risks using it (links), the evidence count, the latest result (icon and words: Effective / Partly effective / Not effective), "Test due" when due, and the test history (`<details>` per test);
  - a **Record a test** form (date, result radio group, what was checked, notes, evidence checkboxes from `evidenceOptions`), shown when `canRecordTest`.
- Modify: `apps/web/app/(app)/library/[code]/page.tsx` (load the operation), `apps/web/components/library/control-filters.tsx` and `control-list.tsx` (an "In use" filter; the latest result in words per row).
- Test: `apps/web/test/library/control-operation.test.tsx`, plus a setup form test.

- [ ] **Step 1: Write failing tests.**
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the web tests, typecheck and lint. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): review interval and controls in operation`.

### Task 10: End-to-end and final gate

**Files:**
- Create: `e2e/loop.spec.ts`, as its own project after `insights`.

Scenario:
1. As CISO, via the API: an approved mitigate risk owned by Olga Owner, with an accepted control.
2. CISO adds an action assigned to Rita Reporter, due tomorrow.
3. Rita sees it in Tasks and marks it done.
4. CISO marks the risk as treated: the journey shows Treated, and the lifecycle shows the next review date.
5. CISO records a control test on the control's page: the panel shows Effective.
6. CISO reassesses the risk: it is editable again.
7. Run the axe check on the risk page and the control page.

The review job is covered by integration tests, not e2e.

- [ ] **Step 1: Write the spec.**
- [ ] **Step 2: Run** the full e2e suite. This needs the dev server stopped; the controller handles it.
- [ ] **Step 3: Run the full gate**, as in Plan 5 Task 9.
- [ ] **Step 4: Commit** `test(e2e): closing the loop`.
