# Plan 5 — Risk Visuals Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reviewers record what a risk is expected to be after treatment. Everyone with `risks.read` sees where risks sit against appetite on a likelihood × impact map, how far each risk has moved through the process, and a compact risk picture on home. Every figure comes from records.

**Architecture:**
- **Domain (`@isms/domain`):** pure rules for the residual assessment, the map basis, week buckets, and the journey derived from state changes.
- **Database:** two nullable columns on `Risk` (`residualLikelihood`, `residualImpact`) with check constraints.
- **Contracts:** the residual fields join `RiskChanges`, `RiskDetailDto` and the version snapshot. `RiskDetailDto` gains `journey`. A new route file, `routes/risk-insights.ts`, holds `GET /api/v1/risks/map`. The risk list gains a cell filter, and the workspace response gains `riskPicture`.
- **API:** residual validation in `RiskEditService`, a new `RiskInsightsService` (map and movement, visibility-scoped SQL), journey assembly in `RiskQueryService.detail`, and `WorkspaceService` adding the picture.
- **Web:**
  - residual editing and both scores in the header;
  - `/risks?view=map` with a basis switch and a table alternative;
  - a journey tracker under the risk header;
  - a "Risk picture" home section.

  All of these are hand-built with the design system; there is no chart library.

**Tech Stack:** Unchanged from Plan 3 (Node 26, TypeScript 6 strict, NestJS 12, Next 16.4.3 `--webpack`, Zod 4, Prisma 7, PostgreSQL 17, Vitest, Playwright + axe). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-06-phase-2-visuals-loop-reports-design.md`, §3 (Part A) and §6. The foundation spec `docs/superpowers/specs/2026-11-03-isms-foundation-design.md` still binds, especially the §2 anti-goals, §5 UX, §6 visuals and §10 visibility. Rulings from Plans 1–3 still bind. This plan's rulings are numbered P5-R*.

## Global Constraints

- TypeScript strict; every file under 500 lines (ESLint `max-lines`); every message JSON file under 500 lines.
- Tests first: each task writes failing tests before code.
- British spelling in identifiers and copy (organisation, summarise). JSDoc on every export, saying why.
- All business rules in `@isms/domain` or the API; the web app never decides scores, appetite, eligibility or journey state.
- Colour never carries meaning alone: every map cell and journey step also has a number, a word or an icon. Every visual has a table or list alternative.
- No composite score, no gauges, and no AI-produced numbers.
- New copy goes in the new `apps/web/messages/en/insights.json` (top-level key `insights`, imported in `messages/index.ts`), except where a task names another file. Pinned copy in `test/fixtures/en-key-paths.txt` must not change.
- Every new or changed route goes in `allRoutes` (`packages/contracts/src/openapi.ts`). Update the OpenAPI snapshot with `pnpm --filter @isms/contracts exec vitest run test/openapi.test.ts -u`, and update the "exact routes" list in that test.
- Risk visibility everywhere goes through `riskVisibilityWhere(actor)` / `riskVisibilitySql(actor)`, never a reimplementation.
- Formatting: `pnpm exec prettier --write --config packages/tooling/prettier.config.js <files>`, only on touched files.
- Commit after each task on branch `feat/plan-5-risk-visuals`. Each commit message ends with the attribution lines the controller supplies.

## Review Focus

1. **A risk with only one residual field set**, for example residualLikelihood with no residualImpact. It must not be placed on the Expected map, must show "no expected score yet", and the header must not show a half score. *(Task 3 test, Task 4 test.)*
2. **Lowering the inherent score below an existing residual.** An edit of `likelihood` to 2 when `residualLikelihood` is 3 must be refused, just like the reverse. *(Task 2 test.)*
3. **A viewer with the `viewer` role.** The map, the movement data and the home picture count only approved risks in scope. A contributor gets no `riskPicture` at all. *(Task 3 and Task 5 tests.)*
4. **A risk returned twice, then approved.** The journey shows "Returned 2 times", Awaiting approval done with the approver, and Approved current. *(Task 1 and Task 4 tests.)*
5. **The empty installation.** No risks gives a map with no counts and a calm empty line, movement with 12 zero weeks, and no division by zero. *(Task 3 and Task 8 tests.)*

---

### Task 1: Domain rules (residual, map basis, weeks, journey)

**Files:**
- Create: `packages/domain/src/residual.ts`, `packages/domain/src/journey.ts`, `packages/domain/src/weeks.ts`
- Modify: `packages/domain/src/index.ts`
- Test: `packages/domain/test/residual.test.ts`, `packages/domain/test/journey.test.ts`, `packages/domain/test/weeks.test.ts`

**Interfaces (Produces):**
```ts
// residual.ts
export type ResidualProblem = "residualAboveInherent" | "residualForAccept";
/** Problems with a would-be stored combination; [] when valid. Nulls are always allowed (P5-R1). */
export function residualProblems(r: {
  likelihood: number | null; impact: number | null;
  residualLikelihood: number | null; residualImpact: number | null;
  treatment: Treatment | null;
}): ResidualProblem[];
/** Where a risk sits on the map for `basis`, or null when it cannot be placed. */
export type MapBasis = "inherent" | "residual";
export function mapPosition(r: {
  likelihood: number | null; impact: number | null;
  residualLikelihood: number | null; residualImpact: number | null;
  treatment: Treatment | null;
}, basis: MapBasis): { likelihood: number; impact: number } | null;

// weeks.ts
/** The Monday (UTC) of d's week as YYYY-MM-DD. */
export function weekStartUtc(d: Date): string;
/** The `count` week starts ending with now's week, oldest first. */
export function recentWeekStarts(now: Date, count: number): string[];

// journey.ts
export const JOURNEY_STEPS = ["reported", "under_review", "awaiting_approval", "approved"] as const;
export type JourneyStepKey = (typeof JOURNEY_STEPS)[number];
export type StateChange = { state: RiskState; at: Date; by: string };
export type JourneyStep = {
  key: JourneyStepKey;
  status: "done" | "current" | "upcoming";
  /** done: when it was completed; current: when it was entered; upcoming: null. */
  at: Date | null;
  /** The user who completed (done) or entered (current) it. */
  by: string | null;
};
export function riskJourney(changes: readonly StateChange[]): {
  steps: JourneyStep[]; since: Date; returnCount: number;
};
```

Rules:
- `residualProblems`:
  - `residualForAccept`: treatment is `accept` and either residual field is non-null.
  - `residualAboveInherent`: a residual field is non-null and its inherent counterpart is null, or is lower than it. Each axis is checked separately; the code is reported once.
- `mapPosition`:
  - **inherent:** both inherent fields set, otherwise null.
  - **residual:** for treatment `accept`, the inherent position (null when unscored). Otherwise both residual fields set, otherwise null.
- `riskJourney`: `changes` are oldest first, and the first entry is the report (state `proposed`).
  - **proposed / returned:** reported done (at/by = first change), under_review current (entered at the last change), the other two upcoming.
  - **in_review:** under_review done (at/by = the last change to in_review), awaiting_approval current (entered at that same change), approved upcoming.
  - **approved:** awaiting_approval done (at/by = the last change to approved), approved current (entered at that change, by that approver), under_review done (the last change to in_review).
  - `since` = the last change's `at`. `returnCount` = the number of changes to `returned`.
  - An empty `changes` array throws `DomainError("INTERNAL", …)`. Check `ErrorCode` for the right code; use the existing generic one.

- [ ] **Step 1: Write failing tests**, including:
  - `residualProblems({likelihood:4,impact:4,residualLikelihood:5,residualImpact:2,treatment:"mitigate"})` → `["residualAboveInherent"]`.
  - `({likelihood:2,impact:4,residualLikelihood:3,residualImpact:1,treatment:"mitigate"})` → `["residualAboveInherent"]` (the inherent value was lowered below the residual).
  - `({likelihood:null,impact:4,residualLikelihood:1,residualImpact:null,treatment:"mitigate"})` → `["residualAboveInherent"]`.
  - `({likelihood:4,impact:4,residualLikelihood:1,residualImpact:1,treatment:"accept"})` → `["residualForAccept"]`.
  - `({4,4,null,null,"accept"})` → `[]`.
  - `mapPosition` for each rule above. Residual with only `residualLikelihood` set → null. Accept in residual basis → the inherent position.
  - `weekStartUtc(new Date("2026-11-08T23:30:00Z"))` → `"2026-11-02"` (a Sunday maps to the previous Monday). `weekStartUtc(new Date("2026-11-02T00:00:00Z"))` → `"2026-11-02"`.
  - `recentWeekStarts(new Date("2026-11-06T12:00:00Z"), 3)` → `["2026-10-19","2026-10-26","2026-11-02"]`.
  - Journey: report → submit → return → submit → return → submit → approve gives `returnCount` 2, statuses `[done, done, done, current]`, approved `by` = the approver, and awaiting_approval `at` = the approval time. A freshly reported risk gives `[done, current, upcoming, upcoming]`, with `since` = the report time.
- [ ] **Step 2: Run** `pnpm --filter @isms/domain test`. Expected: FAIL, because the modules are missing.
- [ ] **Step 3: Implement** the three modules and export them from `index.ts`.
- [ ] **Step 4: Run** `pnpm --filter @isms/domain test`, then `pnpm --filter @isms/domain typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(domain): residual, map basis, week and journey rules`.

### Task 2: Residual assessment in the database, contracts and API

**Files:**
- Modify: `packages/database/prisma/schema/risk.prisma` (Risk: `residualLikelihood Int?`, `residualImpact Int?`)
- Create: `packages/database/prisma/migrations/20261106000000_residual_assessment/migration.sql`. This is the Prisma-generated SQL plus a hand-written tail adding `Risk_residualLikelihood_check` and `Risk_residualImpact_check` (`IS NULL OR BETWEEN 1 AND 5`), with a comment citing Plan 5.
- Modify: `packages/contracts/src/routes/risks.ts`:
  - `RiskChanges`: `residualLikelihood: level.nullable()`, `residualImpact: level.nullable()`.
  - `RiskSummaryDto`: `residualScore: z.number().int().nullable()` and `residualAboveAppetite: z.boolean().nullable()`.
  - `RiskDetailDto`: `residualLikelihood`, `residualImpact` (nullable ints).
- Modify: `packages/contracts/src/conflicts.ts`. This only applies if the API reports these as conflicts; per P5-R2 they are **validation** errors, so leave conflicts alone and use `VALIDATION_FAILED` with paths `changes.residualLikelihood` / `changes.residualImpact`.
- Modify:
  - `apps/api/src/risks/risk-edit.service.ts`: add both fields to `PLAIN_FIELDS`. After the plan is built, compute the would-be stored values and call `residualProblems`. Switching treatment to `accept` clears both residual fields in the same edit (they are added to `changed`).
  - `apps/api/src/risks/risk-versions.ts`: add both fields to `VersionedRisk` and the snapshot.
  - `apps/api/src/risks/mappers.ts`: select the fields; summary `residualScore` / `residualAboveAppetite` via `mapPosition(…, "residual")` (null when not placeable); detail fields.
  - `apps/api/src/risks/risk-edit-audit.ts`: the fields audit like `likelihood`.
- Test: `apps/api/test/risks/residual.int.test.ts` (new); `packages/contracts/test/risks.test.ts`; the OpenAPI snapshot.

**Interfaces:**
- Consumes: `residualProblems`, `mapPosition` (Task 1).
- Produces: `RiskDetailDto.residualLikelihood|residualImpact`, `RiskSummaryDto.residualScore|residualAboveAppetite`, `RiskChanges.residualLikelihood|residualImpact`.

Messages for validation details (API text, not shown to users verbatim):
- `residualAboveInherent` → "Expected likelihood and impact cannot exceed the current ones".
- `residualForAccept` → "An accepted risk has no expected score".

- [ ] **Step 1: Write failing integration tests** (use `risksHarness` from `apps/api/test/risks/harness.ts`):
  - PATCH residual 2/2 on a 4/4 mitigate risk → 200; detail shows the residual values; the history gains a version whose `changedFields` includes `residualLikelihood`; an audit `risk.updated` row exists.
  - PATCH residual 5/1 on 4/4 → 400, with a detail path `changes.residualLikelihood`.
  - PATCH `likelihood: 1` on a risk whose residualLikelihood is 2 → 400 at `changes.likelihood`. Report the problem on whichever field the edit changed: inherent fields when inherent changed, otherwise residual.
  - PATCH residual on an accept risk → 400 (`residualForAccept`).
  - PATCH `treatment: "accept"` on a mitigate risk with a residual → 200, and both residual fields are null afterwards.
  - The list item shows `residualScore` 4 for 2/2; null when only one field is set.
  - The DB check constraint: a raw update to 6 through the owner client fails.
- [ ] **Step 2: Run** `pnpm db:migrate:test && pnpm --filter @isms/api test:integration -- test/risks/residual.int.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the schema, the migration (`pnpm --filter @isms/database exec prisma migrate dev --create-only --name residual_assessment`, then add the tail; rename the folder to the timestamp above), the contracts and the API changes. Then run `pnpm --filter @isms/database exec prisma generate`.
- [ ] **Step 4: Run** the new test, the existing `test/risks/*.int.test.ts`, `pnpm db:validate`, contract tests (`pnpm --filter @isms/contracts test`), and api `typecheck`. Expected: PASS. Update the snapshot deliberately.
- [ ] **Step 5: Commit** `feat(risks): expected-after-treatment assessment`.

### Task 3: Risk map API and the list's cell filter

**Files:**
- Create: `packages/contracts/src/routes/risk-insights.ts`, exported from `packages/contracts/src/index.ts` and added to `allRoutes`.
- Create: `apps/api/src/risks/risk-insights.service.ts`, `apps/api/src/risks/risk-insights.controller.ts`, both registered in `risks.module.ts`. Export the service from `risks/index.ts`, because Task 5 uses it.
- Modify: `packages/contracts/src/routes/risks.ts` (`RiskListQuery` gains `likelihood`, `impact`, `basis`); `apps/api/src/risks/risk-query.service.ts` (`list` applies the cell filter).
- Test: `apps/api/test/risks/risk-map.int.test.ts`, `packages/contracts/test/risk-insights.test.ts`, the OpenAPI snapshot and its routes list.

**Interfaces (Produces):**
```ts
export const MapBasisSchema = z.enum(["inherent", "residual"]).openapi("MapBasis");
export const RiskMapQuery = z.object({ basis: MapBasisSchema.default("inherent") }).openapi("RiskMapQuery");
export const RiskMapCellDto = z.object({ likelihood: z.number().int(), impact: z.number().int(), count: z.number().int().min(1) }).openapi("RiskMapCellDto");
export const RiskMapResponse = z.object({
  basis: MapBasisSchema,
  appetiteThreshold: z.number().int(),
  /** Non-empty cells only. */
  cells: z.array(RiskMapCellDto),
  /** Visible risks counted by this map (placed + unplaced + unscored). */
  total: z.number().int(),
  /** No likelihood or impact yet. */
  unscored: z.number().int(),
  /** Residual basis only: scored, but no expected score and not accepted. 0 for inherent. */
  unplaced: z.number().int(),
}).openapi("RiskMapResponse");
export const riskInsightRoutes = {
  map: defineRoute({ method: "get", path: "/api/v1/risks/map", summary: "...", permission: "risks.read",
    request: { query: RiskMapQuery }, responses: { 200: RiskMapResponse } }),
};
// RiskListQuery additions (both or neither of likelihood/impact; 400 otherwise, via superRefine at path "likelihood"):
likelihood: z.coerce.number().int().min(1).max(5).optional(),
impact: z.coerce.number().int().min(1).max(5).optional(),
basis: MapBasisSchema.default("inherent"),
// API
class RiskInsightsService {
  map(actor: Actor, basis: MapBasis): Promise<RiskMapResponse>;
  /** Weekly reported/approved counts for the last 12 weeks (Task 5). */
  movement(actor: Actor, now: Date): Promise<{ weekStart: string; reported: number; approved: number }[]>;
}
```
- In this plan the map counts every visible risk (Plan 6 adds `closed` and an `includeClosed` flag). One SQL query groups by `(likelihood, impact)` or by the residual expression, using `riskVisibilitySql(actor)`.
- The residual SQL must match `mapPosition` exactly:

  ```sql
  CASE WHEN treatment = 'accept' THEN likelihood ELSE "residualLikelihood" END
  ```

  and the same for impact. A risk is placed only when both resulting values are non-null.
- Register `/api/v1/risks/map` **before** `/api/v1/risks/{id}`, or confirm the `{id}` UUID param validation already rejects `map`. The test covers this.
- `movement` lives here too (Task 5 calls it). Implement it in this task with its own tests:
  - `reported` = visible risks whose `createdAt` falls in the week;
  - `approved` = `Approval` rows with `decision = 'approved'` on visible risks in the week;
  - 12 entries from `recentWeekStarts`, zeros included.

- [ ] **Step 1: Write failing tests:**
  - CISO map with risks at 4/4, 4/4 and 2/3, plus one unscored → cells `[{4,4,2},{2,3,1}]` (any order; compare sorted), `unscored` 1, `total` 4.
  - Residual basis: a 4/4 risk with residual 2/2, a 3/3 accept risk, and a 4/4 mitigate risk with no residual → cells `{2,2,1}` and `{3,3,1}`, `unplaced` 1.
  - A viewer sees only approved risks. A contributor gets 403 (they lack `risks.read`).
  - `GET /api/v1/risks?likelihood=4&impact=4` lists exactly the two 4/4 risks. `likelihood` alone → 400. `basis=residual&likelihood=2&impact=2` → the one residual risk.
  - Movement: risks created in two different weeks, plus one approval → the right buckets; 12 entries; empty DB → 12 zeros.
  - Contract unit test: `RiskListQuery` refuses one-sided cells.
- [ ] **Step 2: Run** the new tests. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the new and existing risk integration tests, then contract tests, the snapshot, typecheck and lint. Expected: PASS.
- [ ] **Step 5: Commit** `feat(risks): risk map and cell filter`.

### Task 4: Journey in the risk detail

**Files:**
- Modify: `packages/contracts/src/routes/risks.ts` (`RiskDetailDto.journey`). If that pushes the file over 500 lines, move the DTOs added in this plan to `packages/contracts/src/routes/risk-insights.ts` and import them.
- Modify:
  - `apps/api/src/risks/risk-query.service.ts`: `detail` reads the state changes and approvals and calls `riskJourney`. If this file passes about 450 lines, put the assembly in a new `apps/api/src/risks/journey.ts`.
  - `apps/api/src/risks/approval-readiness.ts`: expose the eligible approvers (at most 5, display names), alongside the existing count.
- Test: `apps/api/test/risks/journey.int.test.ts`, the snapshot.

**Interfaces (Produces):**
```ts
export const JourneyStepDto = z.object({
  key: z.enum(JOURNEY_STEPS), status: z.enum(["done", "current", "upcoming"]),
  at: z.iso.datetime().nullable(), by: PersonRef.nullable(),
}).openapi("JourneyStepDto");
export const JourneyWaitingDto = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("owner"), owner: PersonRef.nullable() }),
  z.object({ kind: z.literal("approver"), rule: ApprovalRuleSchema, reviewer: PersonRef,
    eligibleApprovers: z.array(PersonRef).max(5), eligibleApproverCount: z.number().int(), noEligibleApprover: z.boolean() }),
  z.object({ kind: z.literal("none") }),
]).openapi("JourneyWaitingDto");
export const RiskJourneyDto = z.object({
  steps: z.array(JourneyStepDto), since: z.iso.datetime(), waitingOn: JourneyWaitingDto,
  returnCount: z.number().int(),
  /** Oldest first. */
  returns: z.array(z.object({ at: z.iso.datetime(), by: PersonRef, comment: z.string() })),
}).openapi("RiskJourneyDto");
```
- State changes come from `RiskVersion` rows where `version = 1` or `changedFields` contains `"state"`. Take the state from `snapshot.state` and the user from `changedById`, oldest first.
- `waitingOn`:
  - proposed / returned → `owner`;
  - in_review → `approver`, built from the same readiness data as `approval`;
  - approved → `none`.
- `returns` come from `Approval` rows with `decision = 'returned'`.

- [ ] **Step 1: Write failing tests:**
  - A new risk → steps statuses `[done,current,upcoming,upcoming]` and `waitingOn.kind` `"owner"`.
  - After submit → awaiting_approval current, with `waitingOn.approver` naming eligible approvers.
  - Return twice, then approve → `returnCount` 2, two `returns` with comments, approved current, `by` = the approver.
  - A risk with no eligible approver → `noEligibleApprover` true, `eligibleApprovers` [].
  - The viewer cannot read the journey of a risk they cannot see (the detail returns 404 as before).
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the risk integration tests, the contract tests and snapshot, and typecheck. Expected: PASS.
- [ ] **Step 5: Commit** `feat(risks): journey in the risk detail`.

### Task 5: Risk picture in the workspace

**Files:**
- Modify: `packages/contracts/src/routes/workspace.ts`. Add `riskPicture: RiskPictureDto.nullable()` to `WorkspaceResponse`:
  ```ts
  export const RiskPictureDto = z.object({ map: RiskMapResponse,
    movement: z.array(z.object({ weekStart: z.iso.date(), reported: count, approved: count })).length(12),
  }).openapi("RiskPictureDto");
  ```
- Modify: `apps/api/src/workspace/workspace.service.ts`. Fill `riskPicture` when `canAtAnyScope(actor, "risks.read")`, using `RiskInsightsService.map(actor, "inherent")` and `.movement(actor, new Date())`; otherwise null.
- Test: `apps/api/test/workspace/*.int.test.ts` (add cases to the existing workspace test file, or a new `risk-picture.int.test.ts`), the snapshot.

- [ ] **Step 1: Write failing tests:**
  - CISO → `riskPicture.map.cells` matches the map endpoint, and `movement` has length 12.
  - Contributor → `riskPicture` null.
  - Viewer → counts only approved.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the workspace integration tests, contracts, snapshot and typecheck. Expected: PASS.
- [ ] **Step 5: Commit** `feat(workspace): risk picture`.

### Task 6: Web — expected score editing and both scores in the header

**Files:**
- Modify:
  - `apps/web/components/risks/treatment-section.tsx`: two inline selects labelled with the scale's level names ("Expected likelihood", "Expected impact"). Hidden when the treatment is accept. Uses the existing inline-edit mechanism (`inline-field.tsx` / `inline-editors.tsx`), the same way `assessment-section.tsx` edits likelihood and impact.
  - `apps/web/components/risks/risk-header.tsx`: "Now 16 · Expected 4", each with its appetite status in words (above/within) plus an icon. Only "Now" when residual is not fully set; for an accept risk, "Accepted at 16".
  - `apps/web/components/risks/risk-detail.tsx`: pass the scale where needed.
- Create: `apps/web/messages/en/insights.json` (keys under `insights.residual.*`, `insights.header.*`); register it in `apps/web/messages/index.ts`.
- Modify: `apps/web/lib/actions/risks.ts`, only if the update action whitelists fields.
- Modify: `apps/web/components/risks/risk-call.ts` and the `risks.errors` copy, so the two validation paths map to a friendly message: "Treatment should not make the risk worse. Lower the expected likelihood or raise the current one." This goes in `insights.json`; reference it from the error mapping.
- Test: `apps/web/test/risks/residual.test.tsx`.

- [ ] **Step 1: Write failing component tests** (testing-library, `test/intl.tsx`):
  - The header shows "Now 16" and "Expected 4" with words for appetite.
  - With only one residual field set, there is no "Expected" text.
  - With an accept treatment, the editor is hidden and the header says "Accepted at 16".
  - The editor offers the five level names.
- [ ] **Step 2: Run** `pnpm --filter @isms/web test -- test/risks/residual.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the web tests, typecheck and lint. Expected: PASS. `messages.test.ts` still passes (only new keys were added).
- [ ] **Step 5: Commit** `feat(web): expected score on the risk`.

### Task 7: Web — the risk map view

**Files:**
- Create:
  - `apps/web/components/risks/risk-map.tsx`: `RiskMap({ map, scale, compact?, cellHref })`. This is a semantic table modelled on `components/setup/appetite-grid.tsx`, with impact on columns and likelihood on rows (most likely on top). Each non-empty cell is a link with an accessible name such as "4 risks, likelihood Likely, impact Major, above appetite". The appetite tint and icon come from `isAboveAppetite(riskScore(l, i), map.appetiteThreshold)`, and a legend explains them in words. A `<details>` "Show as table" lists the non-empty cells (likelihood, impact, score, appetite in words, count). Below it are lines for `unscored` and `unplaced` when above zero, and a calm empty line when `total` is 0. `compact` hides axis titles, the legend and the table, keeping each cell's accessible name.
  - `apps/web/components/risks/view-switch.tsx`: segmented links List / Map, and the basis links Now / Expected (both keep the URL in sync; `aria-current` on the active one).
- Modify:
  - `apps/web/app/(app)/risks/page.tsx`: parse `view` (`list` default | `map`), `basis`, `likelihood` and `impact`. Map view: `callApi(riskInsightRoutes.map, { query: { basis } })` plus the organisation risk scale (`organisationRoutes` risk-scale get; see how `risks/[id]/page.tsx` loads the scale) and render `RiskMap`, with `cellHref` → `/risks?view=list&likelihood=L&impact=I&basis=B`. List view with a cell: show a dismissible chip "Likelihood X × impact Y (Now|Expected)" linking back to `/risks`, and pass the cell to the list call.
  - `apps/web/components/risks/risk-queue.tsx` and its loader: carry the cell params when paging.
- Test: `apps/web/test/risks/risk-map.test.tsx`.

- [ ] **Step 1: Write failing tests:**
  - Above-appetite cells have the word/icon; cell counts render; an empty map shows the empty line.
  - The table alternative lists the cells.
  - `cellHref` is used for links.
  - `unplaced` shows "1 risk has no expected score yet".
  - Compact mode keeps accessible names.
  - A view-switch test: the active link has `aria-current`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the web tests, typecheck and lint. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): risk map view`.

### Task 8: Web — journey tracker and the home risk picture

**Files:**
- Create:
  - `apps/web/components/risks/risk-journey.tsx`: `RiskJourney({ journey, timeZone })`. Step labels: **Reported**, **Being reviewed**, **Waiting for approval**, **Approved**. An `<ol>` of the four steps, with icons and words for done/current/upcoming and `aria-current="step"` on the current one. A done step shows its date and person. The current step shows "Waiting on …" and a relative duration since `journey.since` ("for 3 days"; use `Intl.RelativeTimeFormat` or the existing date helpers in `lib/dates*`). Returns: "Returned 2 times", with a `<details>` listing date, person and comment. Waiting copy:
    - `owner` → "Waiting on {name}" or "No owner yet";
    - `approver` with `reviewerMayApprove` → "The reviewer {name} or an approver can approve";
    - `independentApprover` → "Needs an independent approver: {names}", plus "and N more" when the count exceeds the names shown;
    - `noEligibleApprover` → the existing plain message "No one else can approve this yet — an administrator can give the approver role to someone" (reuse the existing key if there is one).

    It is horizontal on `sm` and up, and stacks vertically below that.
  - `apps/web/components/home/risk-picture.tsx`: `RiskPicture({ picture, scale })`. A home section (use `home-section.tsx` and `styles.ts`) titled "Risk picture", with a compact `RiskMap` linking to `/risks?view=map`, and `RiskMovement`.
  - `apps/web/components/home/risk-movement.tsx`: 12 paired bars per week (reported, approved), heights relative to the largest weekly value (all zero → flat baseline, no division by zero), each bar with an accessible label. It has a legend in words and a `<details>` table (week of, reported, approved).
- Modify:
  - `apps/web/components/risks/risk-detail.tsx`: render `RiskJourney` directly under `RiskHeader`, from `useRisk()` state, so it updates after every action.
  - `apps/web/components/home/home-view.tsx`: render `RiskPicture` when `workspace.riskPicture` is non-null, after the statements.
  - `apps/web/app/(app)/page.tsx`: load the risk scale for the picture, only when `riskPicture` is present.
- Test: `apps/web/test/risks/risk-journey.test.tsx`, `apps/web/test/home/risk-picture.test.tsx`.

- [ ] **Step 1: Write failing tests:**
  - The journey for each state: `aria-current` on the right step, the waiting copy for each `waitingOn` kind, "Returned 2 times" with its details, and the no-approver message.
  - Movement with all zeros renders 12 weeks and the table; with data, the tallest bar is the maximum.
  - The picture is hidden when null (in a home-view test).
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the web tests, typecheck and lint. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): journey tracker and home risk picture`.

### Task 9: End-to-end test and final checks

**Files:**
- Create: `e2e/insights.spec.ts`
- Modify: `e2e/workspace.spec.ts`, only if home assertions break because of the new section.

Scenario. Follow `e2e/review.spec.ts` and `e2e/approval.spec.ts` for setup; reuse `api()`/`grantRoleViaApi` from `e2e/support.ts`:
1. As CISO (via the API), report a risk, then set likelihood 4, impact 4, treatment mitigate, residual 2/2, and an owner.
2. In the browser as CISO, open the risk: the header shows "Now 16" and "Expected 4"; the journey shows "Being reviewed" as the current step.
3. Open `/risks?view=map`: the 4/4 cell shows 1. Click it: the list shows the risk. Switch to Expected: the 2/2 cell shows 1.
4. Submit the risk; as the approver, approve it. The journey shows Approved as current.
5. Home as CISO shows "Risk picture" with the movement table containing the week's counts.
6. Run the axe check on the map page and the risk page, as other specs do.

- [ ] **Step 1: Write the spec.**
- [ ] **Step 2: Run** `pnpm e2e -- insights.spec.ts`. Expected: PASS. Run the whole e2e suite once.
- [ ] **Step 3: Run the full gate:** `pnpm typecheck && pnpm lint && pnpm format:check && pnpm boundaries && pnpm test && pnpm test:integration`, and the contract snapshot with `CI=true`. Expected: all PASS.
- [ ] **Step 4: Commit** `test(e2e): risk visuals`.
