# Phase 3: Above-appetite in Red, Board Pack Graphics, Sample Data and Reset — Design

**Date:** 2026-11-06
**Owner:** Tim Crouch, Global Software AI
**Status:** Approved by owner 2026-11-06 ("Go, ship both plans"). The owner's choices (2026-11-06) are marked *owner*; everything else is the builder's call and listed in §7.

This document extends the foundation spec (`2026-11-03-isms-foundation-design.md`) and the Phase 2 spec (`2026-11-06-phase-2-visuals-loop-reports-design.md`). Everything there still binds, especially the anti-goals: no figure that does not come from records, colour never the only carrier of meaning, every visual has a table or list alternative, reports respect the viewer's scope, no charting library.

---

## 1. Intent

The owner reviewed Phase 2 and asked for four things:

1. **Above appetite must read as danger.** Today it is orange with a warning triangle, the same colour used for ordinary warnings. *Owner:* the text and the sign become red, everywhere the app calls out "above appetite".
2. **The board pack is too plain.** *Owner:* the status row becomes icon tiles, each with its own icon and colour that people learn to recognise, the number, and the change against the previous period. The weekly movement becomes a chart: bars for reported, approved and treated, plus a line for how many risks were open. A new section below it shows each risk owner's numbers, neutrally, so the board can see who is moving security forward.
3. **The Expected map looked like risks disappear.** They do not: a risk with no expected score yet cannot be placed. The empty state must say so on the grid itself.
4. **A full year of sample data, and a way back to a clean start.** *Owner:* an admin can load a realistic year of activity for a fictional company (for demos and training, and to check every screen and report), and can reset the application to a fresh install, with a confirmation. *Owner:* both buttons exist only on instances switched into demo mode by a server setting, because the reset deletes the audit trail, which the database is deliberately set up to protect.

Shipped as two plans: **Plan 8 — Red and board pack graphics** (§3, §4) and **Plan 9 — Sample data and reset** (§5). Plan 9 does not depend on Plan 8, but its sample data should make every Plan 8 graphic show something.

## 2. Goals, non-goals, anti-goals

### Goals

- One "above appetite" look, red text and a red triangle-with-exclamation sign, on every screen, PDF and spreadsheet that calls it out.
- A board pack that a board member can read at a glance, on screen and in the PDF, with the same icons and colours in both.
- A truthful Expected-map empty state.
- One click from an empty demo instance to a realistic year of data covering every role, state, report and chart; one confirmed click back to a fresh install.

### Non-goals (later)

- Charts anywhere other than the board pack (home stays a workspace of statements).
- Versioning the appetite threshold over time.
- Demo tools on production instances; partial resets; choosing among several sample companies.
- Sample data in languages other than English.

### Anti-goals (in addition to the earlier specs')

- **A ranking or labelling of people.** The owner breakout states numbers; it does not call anyone "lagging", "delaying" or "top performer", and it does not colour an owner red except for overdue actions, which are facts.
- **A demo tool that can run on a real customer instance.** The buttons, the routes and the privileged database connection all exist only when demo mode is on.
- **A reset without a deliberate confirmation**, or a reset that leaves the instance unusable (no administrator, no control library).
- **Sample data that could be mistaken for real records.** The company name says it is sample data, and every sample person is fictional, apart from the dev sign-in users.
- **A change figure that is estimated.** A tile shows a change only when the previous value comes from records (§4.2); otherwise it shows none.

## 3. Plan 8, part 1 — Above appetite in red, and the Expected-map empty state

### 3.1 One "above appetite" look

- The design tokens already have a red pair (`critical` / `critical-soft`, light `#b42318` on `#fde5e3`, dark `#ff8f8a` on `#3a1618`). Above appetite uses it. The orange `attention` token is **not** changed, because it also carries unrelated warnings (returned risks, AI settings, overdue tasks, and others).
- The sign stays the triangle with an exclamation point (*owner*), now red. Add one named variant (for example `StatusBadge status="aboveAppetite"`: triangle icon, `critical` colours) and one shared class/icon constant for places that are not badges, so every call site stays in step.
- Call sites to move to red (from the code survey): risk list rows and risk detail scores (`risk-badges.tsx`), the risk detail header scores (`header-scores.tsx`), the risk map's above-appetite cells, appetite boundary edges and legend (`risk-map.tsx`), the appetite grid preview in setup (`appetite-grid.tsx`), and the "N risks above appetite" statement on home (`home/statements.tsx`: the icon and number in red).
- Reports: the board pack map's above-appetite cells use the red soft fill with red text; the register PDF and XLSX "Above appetite" column shows "Yes" in red bold text. The Excel cell keeps the word, so meaning never depends on colour.
- Contrast: each red text / background pair must reach WCAG AA (4.5:1 for text) in light and dark themes; the token comments record the measured ratios.

### 3.2 Expected-map empty state

- When the Expected map has no placed risks but some risks are unplaced, the grid shows a message in its centre: "No risks have an expected score yet. A risk appears here once its expected score after treatment is entered." with a link to the risk list filtered to those risks.
- When some risks are placed and others are not, the existing note under the grid stays, made more visible (above the grid, with the count as a link to the same filtered list).
- This needs a list filter for "no expected score" (open risks, not accepted, residual likelihood or impact missing), defined once in the API next to the map's own rule (`mapPosition` / `MAP_*_RESIDUAL_SQL`) so the count and the list cannot disagree.

## 4. Plan 8, part 2 — Board pack graphics (screen and PDF)

### 4.1 Status tiles

*Owner:* "Icon tiles + change". Seven tiles, in this order, each with a fixed icon (lucide on screen; the same glyph drawn as SVG in the PDF), a fixed colour, a label, the big number, and a change line:

| Tile | Icon (lucide) | Colour | Number |
|---|---|---|---|
| Open risks | `CircleDot` | accent (brand violet) | open now |
| Above appetite | `TriangleAlert` | critical (red) | open and above appetite now |
| Reported | `FilePlus2` | info / blue | reported in the period |
| Approved | `BadgeCheck` | teal | approvals in the period |
| Treated | `ShieldCheck` | success / green | marked as treated in the period |
| Overdue actions | `AlarmClock` | attention (orange) | open treatment actions past due, now |
| Reviews due | `CalendarClock` | neutral / slate | reviews due now |

The builder picks the exact token for each colour from the design system; the mapping above is fixed once chosen and documented in one shared constant used by the web page and the PDF renderer. Colour is never the only carrier: every tile has its label and icon.

### 4.2 The change line

- **Period facts** (reported, approved, treated): change against the **previous period** of the same kind, from records. The previous period of a month is the month before. The previous period of "last 30 days" is the 30 days before it. Shown as "▲3 vs Sep" or "▼2 vs previous 30 days". "No change vs Sep" when equal.
- **Open risks** and **above appetite**: change since the **start of the selected period**, computed from the risk version history (the latest version of each risk at that moment, and its state and scores then). The appetite threshold is today's; this is noted in small print under the tiles ("Above appetite uses today's appetite").
  - These two numbers are "now" today, so for a past month the period start is earlier than the previous period's end. The label states the date: "▲2 since 1 Oct".
- **Overdue actions** and **reviews due**: no change line. Their past values cannot be rebuilt exactly (task due dates can be edited, cancellations have no date), and the anti-goal forbids estimates. The tile shows "now" instead.
- Arrows do not judge. An increase in open risks is not automatically bad, so the arrow is neutral (no green or red) for every tile except **above appetite**, where an increase is shown in red and a decrease in green, always with the word "more" or "fewer" as well.
- Visibility: all change figures go through the same visibility rules as the facts (`riskVisibilitySql` / `riskVisibilityWhere`). Note: version-history queries judge visibility on the risk's **current** site and department, which is acceptable and documented.

### 4.3 Movement chart

*Owner:* "Bars + open-risk line".

- The movement covers the **12 weeks ending with the selected period's end** (today, it always ends now: change it to follow the period, so the chart and the tiles describe the same time).
- Per week: grouped bars for reported, approved, treated (each in its tile's colour and with its tile's icon in the legend), and a line with point markers for **open risks at the end of that week** (from version history, same rule as §4.2), on the same axis when the scales allow, otherwise on a labelled second axis on the right.
- Hand-drawn SVG (no charting library), with a visible legend, week labels, and the existing accessible table of the same numbers kept below the chart (it may be visually collapsed on screen behind "Show as table", but always present for assistive technology). In the PDF, the same SVG via pdfmake's `svg` node, plus the numbers table in small print.

### 4.4 Owner breakout

*Owner:* "Neutral table + bars". A section "By risk owner" below the movement.

- One row per risk owner with at least one visible risk, plus an "Unassigned" row when any visible risk has no owner. Columns:
  - **Owner** (display name).
  - **Owned:** all risks they own, any state, including closed.
  - **Open:** not closed.
  - **Treated:** marked as treated in the selected period (from version history, same rule as the Treated tile).
  - **Overdue actions:** open treatment actions past due on their risks, now. Shown in red when above zero (a fact, not a label).
  - A small horizontal bar of **Owned** split into its current states: open (accent) and treated now, meaning closed today (green), with the numbers beside it. The two parts always add up to Owned. The bar shows where each owner's risks stand **now**. The Treated column shows activity **in the period**, so a risk treated in the period and later reassessed counts in the column but sits in the open part of the bar. The column header and a footnote say "in the period" and "now" respectively.
- Sorted by open, descending, then name. All rows on screen; in the PDF, the top 15 and an "All other owners (N)" summary row.
- The owner's name and the row figures are **not** passed to the AI narrative and are not part of the number guard's allowed numbers, so the AI summary stays about the organisation, not people.
- *Builder's call on "reported":* the owner asked for "how many have been reported" per owner. A risk's reporter and its owner are different people. The table uses **Owned** (risks assigned to that owner) because that is what an owner is accountable for; the reporter is not shown. Flagged in §7.

### 4.5 Placement and PDF

- Screen order: status tiles, maps (unchanged, now red above appetite), movement chart, owner breakout, top risks, narrative. The PDF follows the same order and stays A4 portrait; it may now run to three pages.
- The AI narrative input does not change (§4.4), so the posture-summary purpose and its number guard are untouched.

## 5. Plan 9 — Sample data and reset

### 5.1 Demo mode

- A new server setting `DEMO_TOOLS_ENABLED` (default false), parsed in `@isms/config`. When true:
  - `BOOTSTRAP_ADMIN_EMAIL` must be set (config parse fails otherwise), so a reset can never leave the instance without an administrator.
  - `DATABASE_OWNER_URL` must be set; it is passed **only** to the demo module. Without demo mode the API still never receives it.
- When false, the demo routes are not registered, the setup page shows nothing about them, and no privileged connection exists.
- The demo routes require `organisation.manage` and a recent sign-in (the existing `recent-auth` rule used for role changes).
- **Where demo mode runs:** local development, and hosted demo or training instances. Every demo instance is its **own deployment**: its own database, evidence bucket and Redis, never shared with a real instance. The reset deletes whole-bucket and whole-Redis keys on that basis, and the operations doc says so. Demo mode is a deploy-time choice and is **not** refused in production builds, because a hosted demo runs one. The guard is the explicit setting plus the documented separate deployment.
- **Sign-in accounts on a hosted demo:** the sample roles belong to the six `@example.test` accounts. Locally the dev Keycloak seed creates them. A hosted demo's operator creates the same six accounts in that instance's sign-in service, and the operations doc gives the list.

### 5.2 Where the buttons live

- A new section at the bottom of the admin **Setup** area: "Demo and training". It shows that demo mode is on, and two actions:
  - **Load sample data**: "Replace everything with a year of sample activity for Isarwerk Finanz AG (sample)." This always starts with a reset (§5.4), so loading twice gives the same result and never mixes sample data with real data.
  - **Reset everything**: "Delete all data and settings and return to a fresh install."
- Both open a confirmation dialog that states what will be deleted (risks, evidence files, history and audit trail, settings including the AI provider key, everyone's sign-in) and requires typing the organisation name (or `RESET` when no organisation is set up yet). The button stays disabled until the text matches.
- Afterwards everyone, including the admin, is signed out. On the next sign-in the bootstrap admin is made administrator again.

### 5.3 The sample company and its year

A deterministic generator (fixed seed, dates relative to "now", so every load looks current) in a new package or module that the API demo module and a CLI (`pnpm demo:load`, `pnpm demo:reset`, for local use) both call.

- **Company:** "Isarwerk Finanz AG (sample)", a fictional mid-sized German payments and lending firm. Sites: Munich (head office), Frankfurt, Riga (development centre). Departments: IT Operations, Information Security, Finance, HR, Customer Service, Software Development, Compliance, Facilities. Frameworks confirmed: ISO/IEC 27001:2022, NIS2 and GDPR, all from the shipped control library. Risk scale and appetite set; review interval 12 months.
- **People:**
  - The six dev sign-in users with these roles: Anna Admin (administrator), Carl Ciso (CISO), Olga Owner (risk owner, scoped to Munich), Adam Approver (risk approver), Rita Reporter (contributor), Arno Auditor (auditor).
  - About ten fictional people who own risks and do actions but never sign in (names visibly fictional, emails at `example.test`), so the owner breakout has a realistic spread. This includes at least one owner with many open risks and overdue actions, and at least one who treats steadily.
  - Their roles, scopes and departments are spread so that a scoped viewer sees a smaller picture than an organisation-wide one.
- **A year of activity** (about 120 risks, 12 months, irregular weekly rhythm with a few busy weeks after an incident and a quiet holiday period). Every state and path appears:
  - risks proposed and never submitted;
  - submitted, returned with concern messages, resubmitted and approved;
  - approved with treatment actions done, some open, some overdue;
  - marked as treated, some reassessed later;
  - accepted risks;
  - periodic reviews done, due and overdue.
  - Expected scores on most treated or approved risks, none on some proposed ones, so both maps are populated and the empty-state note appears.
  - Above-appetite risks, falling over the year.
  - Assets linked, controls accepted on risks.
  - Evidence with small generated files stored in object storage (so downloads work), linked to controls.
  - Control tests with all three results.
  - Statement of Applicability decisions, including some "Not applicable" with reasons.
  - Approved board narratives for some past months (written as plain text in the generator, marked as sample, no AI interaction).
  - Tasks for every kind.
  - **No AI interactions** are generated (the AI log would be fake); AI settings stay empty.
- **History is real history:** every change writes its `RiskVersion` and `AuditEvent` with the backdated time and the acting person, in the same order the app itself would write them. Backdated rows get UUIDv7 ids generated for their backdated time.
- **Linking sample users to sign-ins:** dev users have no fixed Keycloak ids. The generator first reuses an existing `User` row with that email (for someone who has signed in). Otherwise it creates a placeholder `User` whose subject is marked as pending. A placeholder is claimed (the real issuer and subject are set on it, instead of a second user being created) only when **all** of these hold:
  - demo mode is on;
  - the sign-in's email is verified;
  - the email ends in `@example.test`, the reserved sample domain.

  Real-looking addresses are never claimable.
- **The person who loads keeps admin:** the generator always gives the administrator role to the `BOOTSTRAP_ADMIN_EMAIL` user, and to the user who pressed the button, in addition to Anna Admin. So loading sample data never locks the loader out, whatever the bootstrap email is.
- Size check: loading completes in under 30 seconds on a laptop; a progress state ("Loading sample data…") is shown, and the request is synchronous.

### 5.4 Reset

- One transaction, as the owner role: `TRUNCATE` every table in the public schema except `_prisma_migrations`, `RESTART IDENTITY CASCADE` (this is the only way past the audit trail's append-only trigger, which is the point of demo mode). Then:
  - re-sync the control library (the same `syncControlLibrary` the seed uses);
  - enqueue the library embedding job;
  - delete every object under `evidence/` in the evidence bucket;
  - delete every `sess:*` key in Redis;
  - remove pending BullMQ jobs that reference deleted records (or let them fail harmlessly; the builder decides and documents).
- The reset itself is recorded after the fact as the first audit event of the fresh instance (`demo.reset` with the actor's email, not their deleted user id), so the new trail starts with how it began. Loading sample data records `demo.sample_loaded` the same way.
- The existing test-database reset (`resetTestDatabase`) is reused where possible. Its "only `*_test` databases" guard stays for tests; the demo path uses its own guard (demo mode on).

## 6. Cross-cutting rules

As in Phase 2 §6: rules in `@isms/domain` or the API; new routes as Zod contracts with the OpenAPI snapshot updated; all copy in message files; audit events for every state change; end-to-end tests for the happy path and the main refusal of each new action. Plan 9's end-to-end tests run against the test database with demo mode on; one test checks that the routes do not exist with demo mode off.

## 7. Calls made in this design (owner to check)

- **Reds:** above appetite uses the existing red token; the orange token stays for ordinary warnings; the triangle sign is kept, now red.
- **Change lines:** exact change figures only, for reported, approved, treated, open and above appetite. Overdue actions and reviews due show "now" with no change, because their history cannot be rebuilt exactly. Above appetite in the past uses today's appetite threshold.
- **Arrow colours:** neutral everywhere except above appetite (more = red, fewer = green).
- **Movement:** follows the selected period (12 weeks ending at the period's end) instead of always ending today.
- **Owner table:** "Owned / Open / Treated (this period) / Overdue actions". "Reported" became "Owned", since an owner is accountable for the risks they own, not those they reported. No labels or rankings; sorted by open.
- **Owner data stays out of the AI summary.**
- **Load sample data always resets first**, so it never mixes with real data.
- **Reset clears the AI provider key**, along with all other settings, signs everyone out, and re-creates the administrator from `BOOTSTRAP_ADMIN_EMAIL`.
- **Sample company** "Isarwerk Finanz AG (sample)", with ISO 27001, NIS2 and GDPR, about 120 risks, about 16 people. No fake AI history.
- **Placeholder users** are claimed by email on first sign-in, only in demo mode and only for `@example.test` addresses. The loader and the bootstrap admin always keep administrator. *As implemented (P9-R3):* the `BOOTSTRAP_ADMIN_EMAIL` address may also claim its placeholder, under the same conditions (demo mode on, email verified). Config already trusts that address, and without the claim the bootstrap admin would become a second user without roles after a load.
- **Demo instances are separate deployments** (local, or hosted demo/training). Demo mode is allowed in production builds; the explicit setting and the separate deployment are the guard.
- **Owner bar** shows where owned risks stand now (open plus treated now = owned); the Treated column counts treated in the period.
