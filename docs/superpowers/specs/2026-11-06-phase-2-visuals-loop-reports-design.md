# Phase 2: Risk Visuals, Closing the Loop, Reports — Design

**Date:** 2026-11-06
**Owner:** Tim Crouch, Global Software AI
**Status:** Approved by owner 2026-11-06 ("Go with 1, 2, and 3. Get them all shipped!"); the calls in §8 are the builder's and are open to the owner's check.

This document extends `docs/superpowers/specs/2026-11-03-isms-foundation-design.md` (the foundation spec). Everything there still binds: the directives, the stack, the "Clear Glass" visual direction, the authorization model, the audit design, and above all the anti-goals. Where this document is silent, the foundation spec decides.

---

## 1. Intent

The first slice takes a concern from report to approved risk. Three gaps stop it being a working ISMS:

1. **People cannot see the picture.** There is no view of where risks sit against appetite, how far each risk has moved through the process, or what treatment is expected to achieve.
2. **Approval is a dead end.** An approved risk has no plan, no actions, no "done", and no reminder to look at it again. Controls are chosen but nobody records whether they work.
3. **Nothing leaves the system.** Auditors and boards need a risk register, an ISO 27001 Statement of Applicability and a short posture summary, as files.

Phase 2 closes those gaps in three parts, shipped as three plans in this order: **A. Visuals** (Plan 5), **B. Closing the loop** (Plan 6), **C. Reports** (Plan 7). Plan 4 stays reserved for the infrastructure work named in Plan 3 (Terraform, Entra ID, backups). B depends on A's residual score; C depends on A and B.

## 2. Goals, non-goals, anti-goals

### Goals

- **A.** The residual (expected-after-treatment) assessment, a likelihood × impact risk map against appetite, a journey tracker on every risk, and a "risk picture" on the home workspace.
- **B.** A treatment plan of actions with owners and due dates, a **closed** state, periodic re-review, and recorded control tests.
- **C.** A reports area with a risk register export (XLSX and PDF), a Statement of Applicability (on screen, XLSX, PDF), a board pack (on screen and PDF), and an AI-drafted, human-approved board narrative. AI-drafted test steps for a control.

### Non-goals (later)

- Scheduled or emailed reports, a custom report builder, report templates per organisation.
- A charting library. The few visuals here are simple grids and bars built with the design system.
- Automatic residual scoring from controls, control effectiveness scores, any composite "security score".
- Incidents, third-party risk, DORA / BAIT / MaRisk / NIS2 mapping content (only ISO 27001 drives the SoA in this phase; the SoA works for any confirmed framework because it is built on requirements).
- Notifications by email or chat. Due work surfaces as tasks and home statements.

### Anti-goals (in addition to the foundation spec's)

- A chart dashboard on home. Home stays a workspace of plain statements; the risk picture is one compact section that leads into records.
- Any figure on screen or in a file that does not come from records. The AI narrative may only repeat numbers it was given (§6.4).
- Colour as the only carrier of meaning on the map or the tracker. Every cell and step also carries a number, a word or an icon, and every visual has a table or list alternative.
- A risk silently leaving the process. Closing, reassessing and confirming a review are explicit, attributed, versioned and audited.
- Exported files that leak more than the exporting person may see. Every report is built from the same visibility rules as the screens.

## 3. Part A — Visuals (Plan 5)

### 3.1 Residual assessment

- Two new optional fields on a risk: `residualLikelihood` and `residualImpact` (1–5, same scale). Plain words: **"Expected after treatment"**, with "residual risk" as the term underneath.
- Edited in the treatment section, inline like every other field, only while the risk is editable; versioned and audited like other fields.
- Each must be less than or equal to its inherent counterpart; the API refuses otherwise with a plain message ("Treatment should not make the risk worse. Lower the expected likelihood or raise the current one.").
- Not shown, and not settable, when the treatment is **accept** (the risk stays where it is). Switching to accept clears them.
- Not a submit blocker. The approval rule is unchanged and keeps using the inherent score.
- The risk header shows both scores side by side when residual is set: "Now 16 · Expected 6", each with its appetite status in words.

### 3.2 Risk map

- `/risks?view=map` beside the existing list (`?view=list`, the default). A segmented control switches between them; the choice stays in the URL.
- A 5 × 5 grid: impact on the horizontal axis, likelihood on the vertical, both labelled with the configured scale level names. Each cell shows the number of risks in it, or nothing when zero.
- Cells whose score is above the appetite threshold are tinted as "above appetite" and carry an outlined edge along the appetite boundary; a legend explains it in words. Tints come from the semantic tokens (attention and critical), never as the only signal.
- A basis switch: **Now** (inherent) or **Expected** (residual). In Expected, a risk treated by accept sits at its inherent position; any other risk without a residual assessment is not placed, and a line under the grid says how many ("4 risks have no expected score yet").
- A state filter: open risks (everything except closed) by default; "include closed" once Part B exists.
- Clicking a cell opens the list filtered to that cell (`?view=list&likelihood=4&impact=3&basis=inherent`). The list endpoint gains these filters.
- Below the grid, a "Show as table" disclosure lists every non-empty cell: likelihood, impact, score, appetite status, count.
- API: `GET /api/v1/risks/map?basis=inherent|residual&includeClosed=false` returning the appetite threshold, the scale level names, the cells (likelihood, impact, count), and the number of unplaced risks. Counts respect the viewer's risk visibility exactly as the list does. Unscored risks are counted separately ("2 risks are not scored yet").

### 3.3 Journey tracker

- A horizontal step tracker under the risk header: **Reported → In review → Approved**, plus **Closed** once Part B exists. It is an ordered list (`aria-current="step"` on the current step) with icons and words, and it stacks vertically on narrow screens.
- Each completed step shows when it happened and who did it. The current step shows **who it is waiting on** and **for how long**:
  - proposed or returned: the owner (or "No owner yet");
  - in review: the approver it needs: "the reviewer can approve" or "needs an independent approver", with the eligible approvers' names when the viewer may see them, or the plain "No one else can approve this yet" message from the foundation spec;
  - approved: "Approved; next review due <date>" once Part B exists.
- Returns show as a loop marker on the In review step ("Returned 2 times"), expandable to each return's date, person and comment.
- Data: a `journey` block inside the risk detail (so it is always in step with the record after any action), derived only from records: the risk's version history (state changes), approvals (approved / returned rows with comment and approver), and the risk's current fields. Same visibility as the risk itself.

### 3.4 Risk picture on home

- A new home section, shown only to viewers holding `risks.read`, titled "Risk picture":
  - a compact version of the map (inherent, open risks) that links to `/risks?view=map`;
  - plain statements: risks by state ("3 waiting for approval"), above appetite, and from Part B overdue actions and reviews due;
  - **Movement**: the last 12 weeks as small paired bars per week, reported and approved (and closed, from Part B), with a "Show as table" alternative. Weeks start on Monday, in UTC.
- Data comes from the workspace home endpoint, extended with an optional `riskPicture` block that is present only when the viewer holds `risks.read`, using the same visibility rules.
- No gauges, no totals turned into scores.

## 4. Part B — Closing the loop (Plan 6)

### 4.1 States and actions

`RiskState` gains `closed`. The state machine (in `@isms/domain`) becomes:

| Action | From | To | Who (at the risk's scope) | Conditions |
|---|---|---|---|---|
| submit | proposed, returned | in_review | unchanged | unchanged |
| approve / return | in_review | approved / returned | unchanged (SoD rules) | unchanged |
| **close** | approved | closed | holds `risks.review` | no open treatment actions; a closing note (1–2000 chars) |
| **reassess** | approved, closed | proposed | holds `risks.review` | a reason (1–2000 chars); the risk becomes editable and goes through submit and approval again |
| **confirmReview** | approved, closed | (unchanged) | holds `risks.review` | records that the periodic review found no change; a note (optional, up to 2000 chars) |

Every action writes a risk version, an audit event, and (for close) `closedAt` and `closedById`. Plain words: close = **"Mark as treated"**, reassess = **"Reassess"**, confirmReview = **"Confirm still accurate"**.

### 4.2 Treatment plan

- `TaskKind` gains `treatment_action`. A treatment action has a title, an optional description, an assignee, a **required** due date, and optionally one of the risk's accepted controls.
- Created from a new "Treatment plan" part of the treatment section by anyone holding `risks.review` at the risk's scope, in any state except closed, and only when the treatment is not accept.
- Completed by the assignee or a `risks.review` holder, with an optional completion note; cancelled by a `risks.review` holder with a reason. Completion and cancellation record who and when.
- Assignees can see the action and the risk's title and reference in their task list, as with evidence requests today; it does not widen their risk visibility.
- Overdue: open and due date before today. The risk detail shows progress ("2 of 5 done, 1 overdue") with a bar and words; the tasks page and home statements include treatment actions.

### 4.3 Periodic re-review

- Organisation setting `reviewIntervalMonths` (1–36, default 12), edited on the risk appetite setup page.
- A risk gets `nextReviewDue` (a date) when approved, when its review is confirmed, and when closed: today + interval. Reassessing clears it until the next approval.
- A daily worker job finds approved or closed risks whose `nextReviewDue` is today or past and that have no open `periodic_review` task (new `TaskKind`), and creates one assigned to the risk owner (due on `nextReviewDue`). It is idempotent per risk and due date.
- The `periodic_review` task completes automatically on confirmReview or on the next approval after a reassess. Home statement: "3 risks are due for review".

### 4.4 Controls in operation

- New append-only record `ControlTest`: control, date tested, result (`effective`, `partially_effective`, `ineffective`), what was checked (required, up to 4000 chars), notes, tester, and links to existing evidence items that support that control.
- New permission `controls.test`, held by CISO and risk owner. Reading tests follows `library.read`.
- The control detail page (`/library/[code]`) gains an **"In operation"** panel: the risks that use the control (respecting risk visibility), its evidence count, its test history, the latest result in words and icon, a "test due" flag when never tested or last tested longer ago than the review interval, and a "Record a test" form.
- The library list gains an "In use" filter (controls accepted on at least one risk) showing the latest test result per control.
- The home "controls" dimension adds "tested within the review interval" as a plain count.

## 5. Part C — Reports (Plan 7)

### 5.1 Access and the reports area

- New permission `reports.read`: CISO, risk approver, auditor. New permission `soa.manage`: CISO.
- `/reports` lists the reports available to the viewer with a one-line purpose each. Every report applies the viewer's risk visibility, so a scoped role holder gets a scoped report, and says so on its cover ("Scope: Riga site").
- Every file download is an audit event (`report.exported`, with the report kind, format and filters, never the content).
- Files are generated on request in the API, synchronously; the expected sizes (hundreds of risks) do not need a job. Every file carries the brand ("ComplAIent ISMS"), the organisation's name, "Generated <date time> by <name>", page numbers (PDF), and a "Confidential: internal use" marking.

### 5.2 Risk register

- On screen: the existing risk list. Export buttons on `/reports` and on the list: **Excel (.xlsx)** and **PDF** (A4 landscape), with the list's current filters.
- Columns: reference, title, owner, site, department, state, likelihood, impact, score, above appetite (yes/no), treatment, expected likelihood, impact and score, accepted control codes, open and overdue actions, next review due, approved by and on, closed on.
- XLSX: one sheet, header row frozen, filters on, dates as real dates, a second "About" sheet with scope, filters, the appetite threshold and generation details.

### 5.3 Statement of Applicability

- Rows are the requirements of a confirmed framework version (ISO 27001:2022 Annex A by default; a picker when several are confirmed). Only reference IDs and paraphrased titles appear, never licensed text, unless the installation imported its own `fullText`.
- New record `RequirementApplicability`: requirement, applicable (yes / no), justification (required, up to 2000 chars), decided by and when. Changes are audited, with before and after.
- For each row the SoA shows: applicability and justification (or "Not decided yet"), the mapped controls, the implementation status per control in words (**Implemented and tested** / **Implemented, not tested** / **Not implemented**, from accepted risk controls and the latest control test), and the references of the risks using them.
- When undecided, the SoA suggests "Applicable: used by R-0003, R-0007" or "No risk uses its controls yet" as a hint, never as a decision.
- `soa.manage` holders edit applicability inline. Export as XLSX and PDF.
- (added 2026-11-07, #19) Rows sit under collapsible group headings when the framework's library content has groups: NIST CSF 2.0 by Function, then Category; ISO 27001:2022 Annex A by its four themes. Each heading says "Govern · 12 of 31 decided" (decided means the row has a decision, the opposite of the "Only undecided" filter). The filter keeps working inside the groups: groups with nothing left are hidden, counts stay whole. GDPR and NIS2 stay flat. The Excel file leads with a column per group level (Function and Category; Theme), and the PDF has a heading per group with its count.

### 5.4 Board pack

- `/reports/board`: a one-page, executive-readable summary for a period (default: the last calendar month; a period picker offers the last full months and "last 30 days").
- Content, all from records: headline facts (open risks, above appetite, reported, approved and closed in the period, overdue actions, reviews due), the top five open risks by inherent score with owner, treatment, action progress and expected score, the risk map in both bases side by side, the 12-week movement, and the approved narrative for the period, if there is one.
- PDF export of the same page (A4 portrait, one or two pages).
- The Executive view's home shows the headline facts and links to the board pack.

### 5.5 AI board narrative

- New AI purpose `summarisePosture`. It uses the model chosen for the existing "conversation" setting (no new model setting), and is off when AI is off.
- Input: only the board pack's facts for the period (the numbers and the top risks' references, titles, owners and treatments the viewer may see). Output, validated with Zod: 1–4 short paragraphs.
- **Number guard:** every number in the output must appear among the input facts; otherwise the call is retried once, then refused with "The draft used figures that are not in the records, so it was discarded." This enforces the anti-goal.
- The draft appears marked as an AI draft. A `reports.read` holder who also holds `risks.approve` or is CISO edits it and selects **"Use in board pack"**, which saves a `BoardNarrative` (period, text, AI interaction reference, approved by and when). Later approvals for the same period replace it; each is audited. The PDF prints "Summary drafted with AI assistance and approved by <name> on <date>".

### 5.6 AI test steps for a control

- New AI purpose `draftControlTest`, using the model chosen for the existing "controls" setting. In the "Record a test" form, **"Suggest how to test"** asks for 3–7 concrete test steps based only on the control's library text (title, description, guidance). No organisation data is sent.
- Steps appear as an AI suggestion that the tester can insert into "What was checked" and edit. Hidden when AI is off.

## 6. Cross-cutting rules

- All rules (state transitions, who may act, overdue and due calculations, the number guard) live in `@isms/domain` or the API, never in the web app.
- New routes are Zod contracts in `@isms/contracts`, included in the OpenAPI document and its snapshot.
- All new copy goes in message files; the copy hash test is updated deliberately per plan.
- New tables follow the existing database conventions: check constraints for ranges, append-only grants for history records (`ControlTest`, audit), and the app role's least privilege.
- Every new state change writes an audit event with actor, action, object and request ID.
- End-to-end tests per plan cover the happy path and the main refusal of each new action.

## 7. Left to the builder

The exact XLSX and PDF libraries (current, pinned, maintained, pure JavaScript), PDF layout details, component structure, query shapes and indexes, how the daily job is scheduled with BullMQ, exact message copy within the tone above, and test fixture content.

## 8. Calls made in this design (owner to check)

- Three plans, shipped in order A → B → C, each on its own branch and merged after CI is green.
- Residual must not exceed inherent; not used for accept; not a submit blocker; approval still uses the inherent score.
- No charting library; grids and bars from the design system.
- "Closed" means treatment is done; closed risks are still re-reviewed periodically. Reassess sends a risk back to proposed and through approval again.
- Closing requires no open treatment actions; there is no override.
- Review interval per organisation, default 12 months; due reviews become tasks for the risk owner.
- Control tests are append-only records with a three-level result; no effectiveness score.
- Reports for CISO, risk approver and auditor; SoA editing for CISO; reports respect scope.
- Synchronous file generation; no scheduling or emailing.
- The AI narrative may only repeat numbers it was given, and appears in the board pack only after a person approves it.
