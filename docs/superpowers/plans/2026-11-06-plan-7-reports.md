# Plan 7 — Reports Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** CISOs, risk approvers and auditors get a reports area with:
- a risk register in Excel and PDF;
- an ISO 27001 Statement of Applicability (on screen, Excel and PDF), with applicability decided by the CISO;
- a one-page board pack (on screen and PDF), with an AI-drafted, number-checked, human-approved narrative;
- AI-suggested test steps for a control.

Every figure comes from records, and every file respects the reader's visibility.

**Architecture:**
- **Domain:**
  - the number guard;
  - board periods;
  - SoA status and hint derivation.
- **Database:**
  - `RequirementApplicability` (one row per requirement, updated in place, every change audited with before and after);
  - append-only `BoardNarrative`;
  - permissions `reports.read` (scoped), `reports.narrative` and `soa.manage`.
- **API:**
  - a new `reports` module (`ReportsService` for register rows, SoA and board pack data);
  - renderers (`render/xlsx.ts` with write-excel-file, `render/pdf.ts` with pdfmake);
  - download routes that audit `report.exported`;
  - two new AI purposes in `@isms/ai` (`summarisePosture`, `draftControlTest`).
- **Web:**
  - `/reports` hub, `/reports/soa`, `/reports/board`;
  - export buttons and download proxy route handlers (following `apps/web/app/(app)/library/export/route.ts` and the evidence download proxy);
  - the narrative editor;
  - "Suggest how to test";
  - the Executive home.

**Tech Stack:** As in Plans 5 and 6. New pinned dependencies in `apps/api` only, both MIT and pure JavaScript:
- `pdfmake@0.3.12`. It is at least 14 days old (ADR-0002); 0.3.13 is too new. It depends on pdfkit.
- `write-excel-file@4.1.1`. Its only dependency is fflate.

Record them in ADR-0002's table or in a short new ADR `docs/decisions/0012-report-files.md` (pick the one the ADR-0002 text asks for). CI runs `osv-scanner`. If it flags either dependency, stop and report.

**Spec:** `docs/superpowers/specs/2026-11-06-phase-2-visuals-loop-reports-design.md`, §5 and §6. The foundation spec still binds, especially "no AI numbers as fact" and "never ship ISO text". Plan 5 and 6 rulings still bind. This plan's rulings are P7-R*.

## Global Constraints

- Everything in Plan 5's and Plan 6's Global Constraints.
- Copy goes in a new `apps/web/messages/en/reports.json` (top-level `reports`, registered in `messages/index.ts`); for library additions, in `library.json`.
- **Files:**
  - Every generated file carries:
    - "ComplAIent ISMS";
    - the organisation name;
    - "Generated {date time UTC} by {display name}";
    - a scope line ("Scope: whole organisation" or the viewer's scoped units' names);
    - "Confidential: internal use".
  - PDFs also carry page numbers, "Page N of M".
  - File names: `complaient-<report>-<YYYY-MM-DD>.<ext>`, for example `complaient-risk-register-2026-11-06.xlsx`.
  - Content-Type: `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` or `application/pdf`, with `Content-Disposition: attachment`.
- Every download writes an `AuditEvent` `report.exported`, with the kind, format and filters, never the content.
- Requirement text: only `ref` and the paraphrased `title`. Include `Requirement.fullText` only when it is non-null (the installation imported its own licensed text), and in the SoA on-screen view only, never in files (P7-R2: files stay safe to share).
- The AI never sees anything the requesting user may not see, and never produces a number that is not in its input.
- Visibility: all risk data goes through `riskVisibilityWhere` / `riskVisibilitySql`.

## Review Focus

1. **A site-scoped auditor exports the register.** The file contains only that site's risks, and the cover says "Scope: Riga". *(Task 3 and Task 4 tests.)*
2. **An AI narrative with a figure not in the facts**, for example "risk rose by 40%" when 40 is not a fact. The first attempt is discarded and retried once, then refused with the plain message. No narrative is stored. *(Task 5 test, mock marker.)*
3. **A Statement of Applicability for an installation without ISO 27001 confirmed.** The SoA page offers the confirmed frameworks only, or says plainly that no framework is confirmed yet. It is not an empty table or a 500. *(Task 3 and Task 6 tests.)*
4. **Characters that break files.** Risk titles with commas, quotes, newlines, `=`, `+`, `-` or `@` at the start (spreadsheet formula injection) must not become formulas in Excel. Prefix them with `'` or write them as explicit string cells. They must render in the PDF without breaking the layout. *(Task 4 test.)*
5. **An empty installation.** The register with no risks, the board pack with no data, and an SoA with no decisions all produce valid files and calm screens. *(Task 4 and Task 7 tests.)*

---

### Task 1: Domain — number guard, board periods, SoA status

**Files:**
- Create: `packages/domain/src/number-guard.ts`, `packages/domain/src/board-period.ts`, `packages/domain/src/soa.ts`
- Modify: `packages/domain/src/index.ts`
- Test: `packages/domain/test/number-guard.test.ts`, `board-period.test.ts`, `soa.test.ts`

**Interfaces (Produces):**
```ts
// number-guard.ts
/** Every number written in text: integers and decimals, with any thousands separators removed; "R-0003" yields 3; percentages yield the number. */
export function numbersIn(text: string): number[];
/** Numbers in `text` that are not in `allowed` (deduplicated, in order of appearance). */
export function unknownNumbers(text: string, allowed: readonly number[]): number[];
// board-period.ts
export type BoardPeriod = { key: string; start: string; end: string }; // ISO dates, end inclusive
/** "last-30-days" and the last 6 full calendar months ("2026-10" …), newest first, in UTC. */
export function boardPeriods(now: Date): BoardPeriod[];
/** The default: the last full calendar month. */
export function defaultBoardPeriod(now: Date): BoardPeriod;
export function boardPeriodByKey(now: Date, key: string): BoardPeriod | null;
// soa.ts
/** P7-R3: notImplemented = no accepted use; implementedNotTested = accepted, no test; implementedTested = latest test effective or partially effective; implementedIneffective = latest test ineffective. */
export type ImplementationStatus = "implementedTested" | "implementedNotTested" | "implementedIneffective" | "notImplemented";
export function implementationStatus(c: { acceptedOnRisks: number; latestResult: "effective" | "partially_effective" | "ineffective" | null }): ImplementationStatus;
export function applicabilityHint(usedByRiskRefs: readonly string[]): { kind: "used"; refs: string[] } | { kind: "unused" };
```

- [ ] **Step 1: Write failing tests:**
  - `numbersIn("3 risks, 12.5% and 1,200 items; R-0003")` → `[3, 12.5, 1200, 3]`;
  - `unknownNumbers("5 open, 40% up", [5])` → `[40]`;
  - `unknownNumbers("No change.", [])` → `[]`;
  - `boardPeriods(2026-11-06T…)` → first `{key:"last-30-days", start:"2026-10-08", end:"2026-11-06"}`, then `{key:"2026-10", start:"2026-10-01", end:"2026-10-31"}` and 5 more;
  - `defaultBoardPeriod` → `2026-10`;
  - an unknown key → null;
  - each `implementationStatus` branch;
  - `applicabilityHint`.
- [ ] **Step 2: Run** `pnpm --filter @isms/domain test`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the domain tests and typecheck. Expected: PASS.
- [ ] **Step 5: Commit** `feat(domain): number guard, board periods and SoA status`.

### Task 2: Database and permissions

**Files:**
- Modify the Prisma schema in `library.prisma` (or a new `reports.prisma`):
  ```prisma
  model RequirementApplicability { requirementId Uuid @id ; applicable Boolean ; justification String ; decidedById Uuid ; decidedAt Timestamptz ; relations }
  enum AiPurpose { … + posture_summary, control_test_steps }   // ai.prisma
  /// Append-only.
  model BoardNarrative { id uuid7 ; periodKey String ; periodStart Date ; periodEnd Date ; text String ; aiInteractionId Uuid? ; approvedById Uuid ; approvedAt Timestamptz ; @@index([periodKey, approvedAt]) }
  ```
- Create: the migration `20261108000000_reports` (a separate `…_enums` migration first if the `AiPurpose` values are needed in the same file), with this tail:
  - check `RequirementApplicability_justification_check` (length 1–2000);
  - check `BoardNarrative_text_check` (length 1–6000);
  - `REVOKE UPDATE, DELETE, TRUNCATE ON "BoardNarrative" FROM isms_app`.
- Modify:
  - `packages/contracts/src/permissions.ts` and `apps/api/src/authorization/roles.ts`:
    - `reports.read` for ciso, risk_approver and auditor, added to `DEFAULT_SCOPED_PERMISSIONS`;
    - `reports.narrative` for ciso and risk_approver;
    - `soa.manage` for ciso.
  - `packages/ai/src/store.ts`: the `AiPurpose` union.
  - `packages/ai/src/readiness.ts`: `MODEL_KEY_BY_PURPOSE` maps `posture_summary` → `"conversation"` and `control_test_steps` → `"controls"`.
- Test:
  - the grants test (BoardNarrative is append-only);
  - the policy unit tests;
  - AI readiness unit tests for the two purposes;
  - the snapshot.

- [ ] **Step 1: Write failing tests.**
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** Migrate the test and dev databases, then run `pnpm db:validate`.
- [ ] **Step 4: Run** the database, AI, policy and contracts tests, `pnpm -r typecheck`, then the web tests. Expected: PASS.
- [ ] **Step 5: Commit** `feat(db): applicability, board narratives and report permissions`.

### Task 3: Reports API — register rows, SoA, board pack data

**Files:**
- Create: `packages/contracts/src/routes/reports.ts` (`reportRoutes`), added to `allRoutes`, the index and the exact-routes list.
- Create: `apps/api/src/reports/{reports.module.ts,reports.controller.ts,reports.service.ts,soa.service.ts,board.service.ts,index.ts}`, registered in `app.module.ts`. The reports module may import `risks`, `library` and `organisation` through their `index.ts` files, and must create no cycle.

**Interfaces (Produces):**
```ts
ReportScopeDto = { kind: "organisation" } | { kind: "units"; names: string[] }
RegisterRowDto = { reference, title, owner: string|null, site: string|null, department: string|null, state, likelihood, impact, score, aboveAppetite: boolean|null,
  treatment, residualLikelihood, residualImpact, residualScore, controls: string[], openActions: int, overdueActions: int, nextReviewDue: date|null,
  approvedBy: string|null, approvedOn: date|null, closedOn: date|null }
RegisterResponse = { generatedAt, generatedBy, organisation: string, scope: ReportScopeDto, appetiteThreshold: int, filter: RiskListFilter, rows: RegisterRowDto[] }
SoaRowDto = { requirementId, ref, title, fullText: string|null, decision: { applicable: boolean, justification, decidedBy: string, decidedAt } | null,
  hint: { kind:"used", refs: string[] } | { kind:"unused" }, controls: { code, title, status: ImplementationStatus }[] , riskRefs: string[] }
SoaResponse = { frameworks: { key, name, versionLabel }[] /* confirmed only */, framework: {key,name,versionLabel} | null, rows: SoaRowDto[], canManage: boolean, generatedAt, generatedBy, organisation, scope }
SetApplicabilityInput = { applicable: boolean, justification: text(2000,"multiline") }
BoardFactsDto = { openRisks, aboveAppetite, reported, approved, closed, overdueActions, reviewsDue }   // ints; reported/approved/closed are within the period
BoardTopRiskDto = { reference, title, owner: string|null, treatment, score, residualScore: int|null, actions: { done: int, total: int } }
BoardPackResponse = { period: BoardPeriod, periods: BoardPeriod[], facts: BoardFactsDto, topRisks: BoardTopRiskDto[] /* ≤5, open, above appetite, by score desc then reference */,
  mapNow: RiskMapResponse, mapExpected: RiskMapResponse, movement: RiskPictureDto["movement"], narrative: { text, approvedBy: string, approvedAt, aiAssisted: boolean } | null,
  canDraftNarrative: boolean, canApproveNarrative: boolean, generatedAt, generatedBy, organisation, scope }
routes:
  register GET  /api/v1/reports/register?filter=…   reports.read → RegisterResponse
  soa      GET  /api/v1/reports/soa?framework=<versionKey>  reports.read → SoaResponse
  setApplicability PUT /api/v1/reports/soa/{requirementId}  soa.manage → SoaRowDto | 404
  board    GET  /api/v1/reports/board?period=<key>  reports.read → BoardPackResponse (unknown period → 400)
```

Rules:
- **Register:** the same visibility and filter as the risk list, with no paging. Cap at 5000 rows. Above that, 409 `reportTooLarge` (add it to the conflict reasons).
- **SoA:**
  - The framework defaults to the confirmed ISO 27001 version (`frameworkKey` "iso27001"; check the library keys), else the first confirmed one, else `framework: null`, `rows: []`.
  - Controls come through `ControlRequirementMapping`. Each control's status uses `implementationStatus` with accepted uses on **any** risk; `riskRefs` lists **visible** risks only.
  - `setApplicability` upserts and audits `soa.applicability_set` with before and after (applicable, plus justification length).
- **Board:**
  - Facts and maps use visibility. `reported`, `approved` and `closed` count the events within the period.
  - The narrative is the newest `BoardNarrative` for the period key.
  - `canDraftNarrative` = AI is ready for `posture_summary` and the user holds `reports.narrative`.
  - `canApproveNarrative` = the user holds `reports.narrative`.
- The scope: build `ReportScopeDto` from the actor's `reports.read` scopes, via the `PolicyService.accessScope` pattern.

- [ ] **Step 1: Write failing integration tests** (`apps/api/test/reports/*.int.test.ts`):
  - the register for CISO vs a site-scoped auditor (scope names; rows);
  - filter passing;
  - a contributor → 403;
  - SoA default framework, hint, statuses for all four values, `riskRefs` visibility, no framework confirmed → null;
  - `setApplicability` by CISO → audited; by an auditor → 403; an unknown requirement → 404;
  - board facts for a fixed period (seed events in and out of the period), top risks ordering, the newest narrative wins, an unknown period → 400, an empty installation → zeros.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the reports, risks and library integration tests, contracts, typecheck, lint and boundaries. Expected: PASS.
- [ ] **Step 5: Commit** `feat(reports): register, SoA and board pack data`.

### Task 4: Report files — XLSX and PDF renderers and download routes

**Files:**
- Modify: `apps/api/package.json`, adding `pdfmake@0.3.12` and `write-excel-file@4.1.1` exactly. Update the lockfile with `pnpm install`. Add the ADR or the ADR-0002 table row.
- Create:
  - `apps/api/src/reports/render/xlsx.ts`: `registerXlsx(r: RegisterResponse): Promise<Buffer>`, `soaXlsx(s: SoaResponse): Promise<Buffer>`. Each has a data sheet plus an "About" sheet (brand, organisation, generated, scope, filters, appetite threshold). The header row is sticky. Dates are written as real dates. Text cells are explicit strings, with a leading `'` for values starting `= + - @` (P7-R4).
  - `apps/api/src/reports/render/pdf.ts`: `registerPdf` (A4 landscape), `soaPdf` (A4 portrait), `boardPdf` (A4 portrait, one or two pages, with the map as a 5×5 table with shaded cells and numbers, not an image), all returning `Promise<Buffer>`. Use pdfmake's bundled Roboto through its virtual file system (no network fonts). Every page has the header, footer, page numbers and the confidential marking.
  - `apps/api/src/reports/report-files.controller.ts`:
    - `GET /api/v1/reports/register.xlsx`, `register.pdf`, `soa.xlsx`, `soa.pdf` and `board.pdf`, with the same query parameters as their JSON routes, permission `reports.read`, and `download: true` in contracts;
    - each writes `report.exported` and sets the headers from the Global Constraints.
- Create (web): `apps/web/app/(app)/reports/[file]/route.ts`, a proxy route handler that streams the API download with the user's token, like `evidence/[id]/download/route.ts`. Only an allowlist of file names passes.
- Test:
  - unit: render each file from fixture DTOs, then
    - parse the XLSX back (unzip with fflate and check `sheet1.xml` contains the strings, a quoted `'=SUM(A1)` and no `<f>` formula elements);
    - check the PDF starts with `%PDF-` and has the expected page count. Text extraction is optional; if pdfmake output is compressed, assert on the size and page count instead;
  - integration: the routes return the right content-type and disposition, the audit row exists, and the scoped auditor's register file contains only that site's references;
  - web route handler tests.

- [ ] **Step 1: Write failing tests.**
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the api unit and integration tests, the web tests, contracts, typecheck, lint, and `pnpm install --frozen-lockfile` in a clean check. Expected: PASS.
- [ ] **Step 5: Commit** `feat(reports): Excel and PDF files`.

### Task 5: AI purposes — posture summary and control test steps

**Files:**
- Create:
  - `packages/ai/src/purposes/posture-summary.ts`:
    - `PostureSummaryOutput = z.object({ paragraphs: z.array(z.string().min(1).max(900)).min(1).max(4) })`;
    - `buildPostureSummaryPrompt(facts: BoardFactsInput)`, which takes only the board facts and the top risks' references, titles, owners and treatments, wrapped with `wrapUntrusted`;
    - `allowedNumbers(facts): number[]`, covering every number in the input, including the digits of references.
  - `packages/ai/src/purposes/control-test-steps.ts`: `ControlTestStepsOutput = z.object({ steps: z.array(z.string().min(1).max(300)).min(3).max(7) })` and `buildControlTestStepsPrompt(control: { code, title, description, guidance })`.
  - Mock replies in `packages/ai/src/mock/`, registered in `MOCK_REPLIES`. Support a marker `[[mock:badnumber]]` (in a fact title) that makes the posture mock reply with a number that is not in the facts.
- Modify: `packages/ai/src/index.ts` (exports).
- Create (API):
  - `apps/api/src/reports/narrative.service.ts`:
    - `draft(actor, periodKey)` gives 409 `aiUnavailable.<reason>` when not ready. It runs the purpose. If `unknownNumbers(text, allowedNumbers)` is non-empty, it retries once, then refuses with 409 `narrativeUnverifiable` (a new conflict reason). It returns `{ text, interactionId }` and stores nothing.
    - `approve(actor, periodKey, { text, interactionId|null })` is gated by `reports.narrative`. If `interactionId` is set, the text is re-checked with the number guard against the **current** facts; on failure it gives 400 at `text` with the message "The summary uses figures that are not in the records". It writes a `BoardNarrative` and audits `report.narrative_approved` (length only).
  - Routes:
    - `POST /api/v1/reports/board/narrative-draft {period}`, permission `reports.narrative` → `{ text, interactionId }`;
    - `PUT /api/v1/reports/board/narrative {period, text, interactionId}`, permission `reports.narrative` → `BoardPackResponse["narrative"]`;
    - `POST /api/v1/library/controls/{code}/test-steps`, permission `controls.test` → `{ steps: string[], interactionId }` (409 `aiUnavailable.*`).
- Test:
  - `packages/ai/test/*` for the prompts (no organisation data in test steps; facts wrapped) and the mocks;
  - API integration:
    - a draft through the mock passes the guard;
    - `[[mock:badnumber]]` → refused after one retry, with two `AiInteraction` rows;
    - approving a human-edited text containing a number not in the facts → 400;
    - approving with no AI (`interactionId` null) and the same check → 400 too (P7-R5: the guard applies to every narrative, AI-drafted or typed);
    - AI off → 409;
    - test steps for a control → 3–7 steps;
    - a contributor → 403.

- [ ] **Step 1: Write failing tests.**
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the AI package tests, the API reports and library integration tests, contracts, typecheck and lint. Expected: PASS.
- [ ] **Step 5: Commit** `feat(ai): board narrative with a number guard, and control test steps`.

### Task 6: Web — reports hub, register exports, Statement of Applicability

**Files:**
- Create:
  - `apps/web/app/(app)/reports/page.tsx`: the hub. Cards for the Risk register (Excel, PDF), the Statement of Applicability (open, Excel, PDF) and the Board pack (open, PDF), each with a one-line purpose. It is forbidden without `reports.read`.
  - `apps/web/app/(app)/reports/soa/page.tsx` and `apps/web/components/reports/soa-table.tsx`:
    - a framework picker (confirmed ones);
    - rows with ref, title, applicability (Applicable / Not applicable / "Not decided yet"), justification, the hint as plain text ("Used by R-0003, R-0007" / "No risk uses its controls yet"), controls with status in words and icons, and risk references;
    - inline editing of applicability and justification for `canManage` (a dialog with a radio choice and a required justification), saved through a server action in `apps/web/lib/actions/reports.ts`;
    - a summary line "12 of 93 decided";
    - for a long table, a sticky header row and an "Only undecided" filter.
- Modify:
  - `apps/web/components/shell/primary-nav.tsx`: a "Reports" item for `reports.read` holders.
  - `apps/web/app/(app)/risks/page.tsx`: "Download as Excel / PDF" links to the proxy with the current filter, for `reports.read` holders.
- Test: hub visibility by permission, SoA rendering for each status, the hint text, undecided rows, the edit dialog validation, the nav item, the download links.

- [ ] **Step 1: Write failing tests.**
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the web tests, typecheck and lint. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): reports hub and Statement of Applicability`.

### Task 7: Web — board pack, narrative, Executive home, control test suggestions

**Files:**
- Create: `apps/web/app/(app)/reports/board/page.tsx` and `apps/web/components/reports/board-pack.tsx`.
  - A period picker (links), the headline facts as plain statements, and the top risks list with action progress.
  - The two maps side by side ("Now" and "Expected after treatment"), reusing `RiskMap` compact with axis captions, and movement (`RiskMovement`).
  - **Narrative:** shows the approved one with "Approved by X on D" and "Drafted with AI assistance" when `aiAssisted`.
    - For `canDraftNarrative`: a "Draft a summary" button calls the draft action and shows the text in an editable textarea marked with the `AiBadge` ("AI draft: check every sentence").
    - For `canApproveNarrative`: "Use in board pack" saves. The number-guard refusals show plain copy.
    - Without AI, an approver can still write one by hand.
  - "Download PDF".
- Modify:
  - `apps/web/app/(app)/page.tsx` / `components/home/home-view.tsx`: when `viewer.me.viewMode === "executive"` and the user holds `reports.read`, home shows an "At a glance" block with the board facts for the default period and a link to the board pack, above the usual sections. Load it only in that case.
  - `apps/web/components/library/record-test-form.tsx`: a "Suggest how to test" button (shown when AI is on; the operation DTO or a separate readiness flag tells the page, so add `canSuggestSteps: boolean` to `ControlOperationDto` in Task 5 if needed and note it). It shows the steps as an AI suggestion with "Insert into what was checked".
- Test: the board pack with and without narrative, the draft and approve flow (mock actions), the number-guard error copy, the Executive home block only in executive mode, the suggestion insertion.

- [ ] **Step 1: Write failing tests.**
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the web tests, typecheck and lint. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): board pack, narrative and Executive home`.

### Task 8: End-to-end and final gate

**Files:**
- Create: `e2e/reports.spec.ts`, as its own project after `loop`.

Scenario:
1. As CISO: open Reports.
2. Download the register as Excel and PDF. Check the response headers via `page.waitForEvent("download")`, the file name pattern and a non-empty file.
3. Open the SoA and mark one requirement Not applicable with a justification. The summary line changes.
4. Open the board pack. AI is on (mock), so draft a summary, edit it, and choose "Use in board pack". "Approved by Carl Ciso" shows.
5. Download the board PDF.
6. Switch to the Executive view: home shows "At a glance".
7. As the auditor: the reports are readable, but there are no edit or approve buttons.
8. Run axe on `/reports`, `/reports/soa` and `/reports/board`.

- [ ] **Step 1: Write the spec.**
- [ ] **Step 2: Run** the full e2e suite (the controller stops the dev server).
- [ ] **Step 3: Run the full gate.**
- [ ] **Step 4: Commit** `test(e2e): reports`.
