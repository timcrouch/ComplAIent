# Plan 8 — Red Above Appetite and Board Pack Graphics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Above appetite reads as danger (red text, red triangle) on every screen, PDF and spreadsheet. The Expected map's empty state tells the truth. The board pack gets:
- icon tiles with exact change lines;
- a movement chart (bars and an open-risk line) that follows the selected period;
- a neutral "By risk owner" table with bars.

All of this appears on screen and in the PDF.

**Architecture:**
- **UI:**
  - two new chart tokens (blue and teal) in `@isms/ui`;
  - one `aboveAppetite` badge variant and one shared class/icon constant;
  - a pure-TS `@isms/ui/tokens` export so the API's PDF renderer uses the same hex values.
- **Domain:**
  - `previousBoardPeriod`;
  - `weekStartsEnding`;
  - `changeLine` (sign, size, and whether the arrow is coloured);
  - `BOARD_TILES`, the one tile constant (key, lucide icon name, token).
- **API:**
  - a `noExpectedScore` risk list filter beside the map rule;
  - version-history counts at an instant ("open" and "above appetite" as of t), in `apps/api/src/reports/history.ts`;
  - `BoardService` adds change figures, a period-following movement with an open-risk line, and owner rows.
- **Renderers:**
  - hand-drawn SVG builders (`movementSvg`, `ownerBarSvg`, `tileIconSvg`) shared by nothing but the PDF;
  - the web draws its own SVG in React from the same numbers.

**Tech Stack:** As in Plan 7. No new dependencies. The PDF uses pdfmake's built-in `svg` node. The seven lucide glyphs used in the PDF are copied as SVG path strings into `apps/api/src/reports/render/icons.ts` (lucide is ISC; keep the licence line in the file header).

**Spec:** `docs/superpowers/specs/2026-11-06-phase-3-board-visuals-and-demo-design.md`, §3, §4, §6 and §7. The foundation and Phase 2 specs still bind. Plan 5–7 rulings still bind. This plan's rulings are P8-R*.

## Global Constraints

- Everything in Plan 7's Global Constraints.
- Colour is never the only carrier of meaning. Every red "above appetite" mark keeps its word ("Above appetite", "Yes") and its triangle icon. Every tile keeps its label and icon.
- **Contrast:** every new or changed text/background pair reaches WCAG AA, 4.5:1, in light and dark. `packages/ui/test/contrast.test.ts` proves it, and the token comments record the measured ratios.
- **No charting library.** Charts are hand-drawn SVG.
- **Every chart has a table alternative.** The movement table always exists in the DOM; it is visually collapsed behind "Show as table". The owner table *is* the data.
- **No estimated figures** (spec §2):
  - a change line appears only for reported, approved, treated, open and above appetite;
  - overdue actions and reviews due show "now".
- **Arrows:** neutral colour, except above appetite, where more = `critical` and fewer = `ok`, always with the word "more" or "fewer".
- **No ranking or labelling of people.** The owner table is sorted by open count, descending, then name. Its only colour is red for overdue actions above zero.
- **The AI narrative input is unchanged.** `narrative.service.ts` `input()` and `allowedNumbers` must not see owner rows, change figures or movement.
- **Visibility:**
  - every new query uses `riskVisibilitySql(actor)` / `riskVisibilityWhere(actor)`;
  - version-history counts judge visibility on the risk's **current** site and department (P8-R2, documented in the history module's header).
- **Names:** the board fact stays `closed` in DTOs and the AI input (no churn to the narrative). Its user-facing label is "Treated" everywhere (P8-R1).
- Copy goes in `apps/web/messages/en/reports.json`, `insights.json` and `risks.json`. No literal user-facing strings in components.

## Review Focus

1. **A month in the past with no history before it**, for example the board pack for a month before the first risk existed. Open and above appetite at the period start are 0, so the change lines read "▲N since 1 Sep". A previous period with no records gives "▲N vs Aug". Nothing is NaN, and nothing is blank. *(Task 3 test.)*
2. **A risk created mid-week, closed, then reassessed (reopened) within the same period.** It counts once in Treated for the period. It sits in the open part of the owner bar, and in the open-risk line at weeks after the reassessment. *(Task 3 test.)*
3. **A site-scoped auditor's board pack.** The owner rows, the change figures and the open-risk line include only visible risks. An owner with no visible risks has no row. *(Task 3 test.)*
4. **An owner whose display name is long, or contains characters that break PDF layout or SVG** (`<`, `&`, quotes, 80 characters). The PDF and screen render it escaped and truncated with an ellipsis in the bar label; the full name is in the table cell. *(Task 4 and Task 5 tests.)*
5. **Movement chart scale.** A week with 0 everywhere, and a period where open risks (for example 120) dwarf weekly bars (for example 3). The line goes on a labelled right-hand axis when `max(open) > 3 × max(bars)` (P8-R4). It never draws an axis with max 0 (use max 1). *(Task 4 test on the SVG builder, Task 5 test on the web chart.)*

---

### Task 1: Tokens, the above-appetite look, and red everywhere

**Files:**
- Modify:
  - `packages/ui/src/tokens/tokens.ts` and `tokens.css` (light, dark and the media-query copy): add `chartBlue`, `chartBlueSoft`, `chartTeal`, `chartTealSoft` and the Tailwind `--color-chart-blue` etc. Pick values that pass AA as text on `surface` and as text on their soft pair; record the ratios in the comment block.
  - `packages/ui/package.json`: export `"./tokens": "./src/tokens/tokens.ts"`. It must stay React-free; add a boundaries rule that `packages/ui/src/tokens/` imports nothing.
  - `packages/ui/src/components/status-badge.tsx`: add the status `"aboveAppetite"` (`TriangleAlertIcon`, `bg-critical-soft text-critical`).
  - Create `packages/ui/src/above-appetite.ts`, exported from the index:
    ```ts
    export const ABOVE_APPETITE_TEXT = "text-critical";
    export const ABOVE_APPETITE_CELL = "bg-critical-soft text-critical";
    export const ABOVE_APPETITE_EDGE = { left: "border-l-critical", below: "border-b-critical" };
    export { TriangleAlertIcon as AboveAppetiteIcon } from "lucide-react";
    ```
  - Web call sites, from attention to the constants/variant:
    - `apps/web/components/risks/risk-badges.tsx:59`;
    - `header-scores.tsx` `ScorePart`;
    - `risk-map.tsx` cells (lines 120–128), edges (122–123) and legend (215–228);
    - `components/setup/appetite-grid.tsx:79-95`;
    - `components/home/statements.tsx` (the above-appetite icon and number in `text-critical`).
  - API:
    - `apps/api/src/reports/render/board-pdf.ts`: `ABOVE` becomes the light `criticalSoft` fill with `critical` text, read from `@isms/ui/tokens`.
    - `render/pdf.ts` register "Above appetite" column: "Yes" in `critical`, bold.
    - `render/xlsx.ts:125`: "Yes" cell in bold, font colour `critical`; the word stays.
- Test:
  - `packages/ui/test/contrast.test.ts`: the new pairs, plus `critical` on `critical-soft` and on `surface`, in both themes;
  - `packages/ui/test/components.test.tsx`: the variant renders the triangle and `text-critical`;
  - web tests `test/risks/risk-map.test.tsx`, `residual.test.tsx`, `risk-detail.test.tsx`, `test/setup/*appetite*`, `test/home/*statements*`: assert above-appetite elements carry `text-critical` (or the cell class) and never `text-attention`;
  - `apps/api/test/reports/render-pdf.test.ts`: the doc definition's above-appetite cell has the critical colours;
  - an xlsx render test: the "Yes" cell is bold, with the critical font colour and the text "Yes".

- [ ] **Step 1: Write the failing tests above.**
- [ ] **Step 2: Run** `pnpm --filter @isms/ui test`, `pnpm --filter web test`, `pnpm --filter api test`. Expected: FAIL on the colour assertions.
- [ ] **Step 3: Implement.** Grep `apps/web` for every `text-attention` / `bg-attention-soft` next to an appetite usage and move it. Leave the other attention uses alone.
- [ ] **Step 4: Run** the same tests, then `pnpm -r typecheck`, `pnpm lint` and `pnpm boundaries`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(ui): above appetite in red everywhere`.

### Task 2: Expected-map empty state and the `noExpectedScore` filter

**Files:**
- Modify:
  - `packages/contracts/src/routes/risks.ts:75-87`: add `"noExpectedScore"` to `RiskListFilterSchema`. Update the `RiskListQuery` doc comment: closed risks are excluded for this filter too.
  - `apps/api/src/risks/risk-cell.ts`: export `NO_EXPECTED_SCORE_WHERE: Prisma.RiskWhereInput`, meaning state not closed, `treatment` not `accept` (null treatment counts as not accepted), and (`residualLikelihood` null OR `residualImpact` null). Put it next to `MAP_*_RESIDUAL_SQL`, with a comment that it is the null branch of `mapPosition` (`packages/domain/src/residual.ts:32`).
  - `apps/api/src/risks/risk-query.service.ts` `filterWhere`: `case "noExpectedScore"` uses it, ignoring `includeClosed`.
  - `apps/api/src/risks/risk-insights.service.ts` `map()`: unchanged in logic, but the integration test proves `unplaced` equals the filter's count.
  - `apps/api/src/reports/render/common.ts:72`: add the label "No expected score".
  - `apps/web/messages/en/risks.json`: the filter label. Show it in `risk-filters.tsx` only when it is the current filter; it is not a new chip.
  - `apps/web/components/risks/risk-map.tsx`:
    - when `map.basis === "residual"`, `cells` are all zero and `map.unplaced > 0`, render an overlay centred on the grid (`role="note"`). It holds `insights.map.noExpectedYet` ("No risks have an expected score yet. A risk appears here once its expected score after treatment is entered.") and a link, `insights.map.noExpectedLink` ("Show the {count} risks"), to `/risks?filter=noExpectedScore`.
    - when some risks are placed and `unplaced > 0`, move the existing `unplaced` note **above** the grid and make the count a link to the same URL.
  - Regenerate the OpenAPI snapshot: `pnpm --filter @isms/contracts test -u`, then review the diff (only the enum grows).
- Test:
  - `apps/api/test/risks/risk-map.int.test.ts`: seed open risks (accepted without residual, unaccepted without residual, closed without residual, and with residual). Then `list(filter=noExpectedScore)` length == residual map `unplaced`; the accepted and closed risks are excluded; a site-scoped viewer sees fewer.
  - `apps/web/test/risks/risk-map.test.tsx`:
    - all unplaced → the overlay text and the link href `/risks?filter=noExpectedScore`;
    - mixed → the note precedes the grid in the DOM, with the link;
    - inherent basis never shows the overlay.

- [ ] **Step 1: Write the failing tests.**
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the risks integration tests, contracts, web tests and typecheck. Expected: PASS.
- [ ] **Step 5: Commit** `feat(risks): no-expected-score filter and a truthful Expected map`.

### Task 3: Board data — change lines, period movement with open line, owner rows

**Files:**
- Create: `packages/domain/src/board-change.ts`, exported from the index.
- Modify: `packages/domain/src/board-period.ts` and `weeks.ts`.
- Create:
  - `apps/api/src/reports/history.ts`: the instant counts;
  - `apps/api/src/reports/owners.ts`: owner rows.
- Modify:
  - `apps/api/src/reports/board.service.ts`;
  - `apps/api/src/risks/risk-insights.service.ts`: `movement(actor, until: Date)`, where home passes `now`;
  - `packages/contracts/src/routes/reports.ts`;
  - the OpenAPI snapshot.

**Interfaces (Produces):**
```ts
// @isms/domain
/** The period of the same kind just before p: the month before, or the 30 days before "last-30-days". key "prev-30-days" for the latter. */
export function previousBoardPeriod(p: BoardPeriod): BoardPeriod;
/** count Monday week starts ending with the week containing `end` (YYYY-MM-DD), oldest first. recentWeekStarts(now,n) = weekStartsEnding(isoDate(now),n). */
export function weekStartsEnding(end: string, count: number): string[];
export type ChangeTone = "neutral" | "worse" | "better";
export type Change = { delta: number; direction: "up" | "down" | "same"; tone: ChangeTone };
/** tone is "neutral" unless judged; judged (above appetite): up → "worse", down → "better", same → "neutral". */
export function changeLine(now: number, before: number, judged: boolean): Change;
export type BoardTileKey = "openRisks" | "aboveAppetite" | "reported" | "approved" | "closed" | "overdueActions" | "reviewsDue";
export type TileToken = "accent" | "critical" | "chartBlue" | "chartTeal" | "ok" | "attention" | "fgMuted";
/** In display order. icon = the lucide component name. */
export const BOARD_TILES: readonly { key: BoardTileKey; icon: "CircleDot"|"TriangleAlert"|"FilePlus2"|"BadgeCheck"|"ShieldCheck"|"AlarmClock"|"CalendarClock"; token: TileToken }[];

// contracts (reports.ts)
BoardChangeDto = { delta: int, direction: "up"|"down"|"same", tone: "neutral"|"worse"|"better",
                   basis: { kind: "previousPeriod", period: BoardPeriodDto } | { kind: "since", date: iso.date } }
BoardTileDto = { key: BoardTileKey, value: int, change: BoardChangeDto | null }   // null for overdueActions, reviewsDue
BoardMovementWeekDto = { weekStart: iso.date, reported: int, approved: int, closed: int, openAtEnd: int }
BoardOwnerRowDto = { ownerId: uuid | null /* null = Unassigned */, owner: string | null, owned: int, open: int, closedNow: int, treatedInPeriod: int, overdueActions: int }
BoardPackResponse += { tiles: BoardTileDto[] /* 7, BOARD_TILES order */, movement: BoardMovementWeekDto[] /* length 12, replaces the old field */, owners: BoardOwnerRowDto[] }
// `facts` stays (the AI input and existing consumers read it).

// apps/api/src/reports/history.ts
/** Counts over each visible risk's latest RiskVersion with createdAt < at. open = snapshot state <> 'closed'; above = open and the snapshot's (likelihood, impact) pair is above threshold. */
export async function countsAt(db: PrismaClient, actor: Actor, at: Date, threshold: number): Promise<{ open: number; aboveAppetite: number }>;
/** The same rule's `open`, at many instants in one query (a VALUES list of instants joined LATERAL). */
export async function openAt(db: PrismaClient, actor: Actor, instants: readonly Date[]): Promise<number[]>;
// apps/api/src/reports/owners.ts
export async function ownerRows(db: PrismaClient, actor: Actor, from: Date, until: Date, today: string): Promise<BoardOwnerRowDto[]>;
```

Rules:
- **Above-appetite pairs in SQL:** build the `(likelihood, impact)` pair list from `riskScore` / `isAboveAppetite`, exactly as `aboveAppetiteWhere` does, and compare `(snapshot->>'likelihood')::int` and `(snapshot->>'impact')::int` against the list. Export a shared `aboveAppetitePairs(threshold): [number, number][]` from `risk-query.service.ts` (through `risks/index.ts`) so both use one list.
- **Change basis:**
  - reported, approved and closed compare with `previousBoardPeriod(period)` facts (reuse `facts()`'s SQL with that period's bounds);
  - openRisks and aboveAppetite compare the current value with `countsAt(periodStart 00:00Z)`. `basis.since` = the period start.
- **Movement:** `weekStartsEnding(period.end, 12)`. Each week counts events in `[weekStart, min(weekStart+7d, now))`. `openAtEnd` = `openAt` at `min(weekStart + 7d, now)`.
  - **P8-R3:** the open line uses version history for every week, including the current one. It is never `Risk.state`. One rule, so the line's last point can trail the tile only when a change lands after `now` was read.
- **Owner rows:**
  - group visible risks by current `ownerId`: owned, open (state ≠ closed), `closedNow` = owned − open;
  - `treatedInPeriod` = the Treated rule (a RiskVersion closing in the period) attributed to the risk's current owner;
  - `overdueActions` = `overdueTaskWhere(today)` treatment actions on their visible risks;
  - display name from `User.displayName`;
  - sort by open descending, then owner name (`localeCompare`, "Unassigned" last on ties).
- `insights.movement` keeps its home contract (`RiskPictureDto.movement`, no `openAtEnd`). Board builds its own weeks via the helper `movementCounts(actor, weekStarts, until)`, extracted from `movement()`, which both call.

- [ ] **Step 1: Write failing tests.**
  - Domain:
    - `previousBoardPeriod({key:"2026-10",…})` → `2026-09` with 1–30 Sep; `previousBoardPeriod(last-30-days ending 2026-11-06)` → `prev-30-days`, 2026-09-08 … 2026-10-07;
    - January → the previous December;
    - `weekStartsEnding("2026-10-31", 12)` ends with `"2026-10-26"`;
    - `changeLine(5,3,false)` → `{delta:2, direction:"up", tone:"neutral"}`, `changeLine(2,4,true)` → `down/better`, `(4,4,true)` → `same/neutral`;
    - `BOARD_TILES` keys in the spec §4.1 order.
  - `apps/api/test/reports/board.int.test.ts`, with a fixed clock 2026-11-06 and period `2026-10`. Seed versions with backdated `createdAt` via direct Prisma writes in the fixture.
    - tiles in order; reported, approved and treated change vs September with `basis.previousPeriod.key === "2026-09"`;
    - open and above appetite change `since: "2026-10-01"`;
    - above appetite's tone is `worse` when it rose;
    - overdue actions and reviews due have `change: null`;
    - movement length 12, last `weekStart` `2026-10-26`; an event on 2026-11-03 is **not** in it;
    - `openAtEnd` follows a risk closed in week 5 and reassessed in week 8 (Review Focus 2);
    - owner rows: counts, the Unassigned row, sort, `closedNow + open === owned`, treated counted once although closed → reassessed → closed twice within the period. Count distinct risks. **P8-R5:** Treated in the tile and the owner column count distinct risks closed in the period; check whether `facts().closed` counts versions, and if so change it to distinct risks, noting it in the commit;
    - a site-scoped auditor sees only that site's owners and figures (Review Focus 3);
    - a month before any data → zeros with `delta` 0 or positive, never null (Review Focus 1);
    - `narrative.service.ts` input is deep-equal to before (snapshot the input object for a fixture).
- [ ] **Step 2: Run** `pnpm --filter @isms/domain test` and the reports integration tests. Expected: FAIL.
- [ ] **Step 3: Implement.** Update the OpenAPI snapshot with `-u` and review it.
- [ ] **Step 4: Run** the domain, reports, risks and workspace integration tests, contracts, typecheck and boundaries. Expected: PASS. Home's movement is unchanged.
- [ ] **Step 5: Commit** `feat(reports): board change lines, period movement and owner rows`.

### Task 4: Board PDF graphics

**Files:**
- Create:
  - `apps/api/src/reports/render/icons.ts`: `TILE_ICON_SVG: Record<BoardTileKey, string>`, the seven lucide glyphs as `<svg viewBox="0 0 24 24">…` strings with `stroke="{colour}"` filled at call time. Keep the ISC licence header.
  - `apps/api/src/reports/render/svg.ts`:
    ```ts
    export function escapeXml(s: string): string;
    /** 12 weekly groups of three bars (reported/approved/closed in tile colours) and an openAtEnd polyline with point markers; legend, week labels (d MMM), left axis; right axis labelled "Open risks" when max(open) > 3 × max(bars) (P8-R4); axis max ≥ 1. */
    export function movementSvg(weeks: BoardMovementWeekDto[], colours: TileColours, width: number, height: number): string;
    /** One horizontal stacked bar: open (accent) then closedNow (ok), with numbers beside. */
    export function ownerBarSvg(row: BoardOwnerRowDto, maxOwned: number, colours: TileColours, width: number): string;
    export type TileColours = Record<TileToken, string>; // light hex values from @isms/ui/tokens
    ```
- Modify: `apps/api/src/reports/render/board-pdf.ts`:
  - **Order:** header, tiles, maps (red above appetite, from Task 1), movement chart plus a small-print numbers table, "By risk owner" table, top risks, narrative.
  - **Tiles:** a 4 + 3 table of cells. Each holds the icon (`{svg}` node, 14 pt), the label, the big number, and the change text. Change copy is the same as on screen: "▲3 vs Sep", "▼2 vs previous 30 days", "No change vs Sep", "▲2 since 1 Oct", "now". Above appetite adds "more" or "fewer" and the tone colour. Small print: "Above appetite uses today's appetite."
  - **Owners:**
    - columns Owner, Owned, Open, Treated (in the period), Overdue actions (red when > 0), and the bar (`svg`);
    - the top 15 rows, then "All other owners (N)" with summed figures;
    - footnote: "Bar: where owned risks stand now (open and treated). Treated column: in the selected period."
    - Owner name cells are escaped and truncated at 40 characters with "…"; the bar SVG carries no names.
  - Put the change copy formatter in `apps/api/src/reports/render/common.ts` as `changeText(tile: BoardTileDto, monthName: (key) => string): string`, so the PDF and its tests share it. The web has its own formatter from messages.
- Test: `apps/api/test/reports/render-pdf.test.ts` and a new `render-svg.test.ts`:
  - `movementSvg` with zeros → valid XML (parse with a tiny XML check: balanced tags; no `NaN`, no `Infinity`), axis max 1;
  - open 120 vs bars 3 → contains the right-axis label "Open risks";
  - `escapeXml('<A & "B">')`;
  - the board doc has tiles before maps, maps before movement, and movement before owners;
  - 20 owners → 15 rows plus "All other owners (5)";
  - a long `<&>` name is truncated and escaped;
  - `boardPdf(fixture)` returns a non-empty buffer starting `%PDF`.

- [ ] **Step 1: Write failing tests.**
- [ ] **Step 2: Run** `pnpm --filter api test -- render`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the render tests, typecheck and lint. Then generate a sample PDF with the fixture into the scratchpad and look at it (3 pages max, A4 portrait). Expected: PASS, and the layout reads cleanly.
- [ ] **Step 5: Commit** `feat(reports): board pack PDF tiles, movement chart and owner table`.

### Task 5: Board pack screen

**Files:**
- Create in `apps/web/components/reports/`:
  - `board-tiles.tsx`: `BoardTiles({ tiles, periodLabel })`. It maps `BOARD_TILES` to lucide components, token classes (`text-chart-blue` etc.) and messages. It has a `<ul>` of tiles, each `<li>` with icon (`aria-hidden`), label, value and change text, plus the small print.
  - `board-movement-chart.tsx`: `BoardMovementChart({ weeks })`. Hand-drawn React SVG with the same rules as `movementSvg` (P8-R4), `role="img"` with `aria-labelledby` a visually hidden summary, a legend with the tile icons, and a `<details>` "Show as table" containing the numbers table. The table stays in the DOM, so screen readers reach it.
  - `board-owners.tsx`: `BoardOwners({ owners })`. A table with columns and footnote as in the PDF, all rows, a bar per row (inline SVG, `aria-hidden`; the numbers are in the cells), and overdue > 0 in `text-critical`. Long names are truncated with CSS and carry `title` with the full name.
- Modify:
  - `board-pack.tsx`: section order tiles, maps, movement, owners, top risks, narrative. Remove `board-facts.tsx` if nothing else uses it (check the Executive home "At a glance" block first; if it uses `BoardFacts`, switch that to `BoardTiles` too).
  - `apps/web/messages/en/reports.json`: tile labels ("Open risks", "Above appetite", "Reported", "Approved", "Treated", "Overdue actions", "Reviews due"); change copy (`vsPeriod`, `sincePeriod`, `noChange`, `now`, `more`, `fewer`); "By risk owner", column headers, footnote, "Unassigned", "Show as table", the chart legend and axis labels.
- Test: `apps/web/test/reports/board-pack.test.tsx` and new `board-tiles.test.tsx`, `board-movement-chart.test.tsx`, `board-owners.test.tsx`, with updated `board-fixtures.ts`:
  - 7 tiles in order, each with a label and an icon;
  - "▲3 vs Sep";
  - above-appetite fewer → green class and the word "fewer";
  - overdue tile shows "now";
  - the chart's table exists when collapsed;
  - the right axis appears when the scale requires it;
  - owners sorted as given, overdue red only above 0, "Unassigned" row;
  - no element text contains "lagging", "top" or "best" (guard against labels);
  - axe passes on the board pack in jsdom (if the suite already uses jest-axe; otherwise leave it to e2e).

- [ ] **Step 1: Write failing tests.**
- [ ] **Step 2: Run** `pnpm --filter web test -- reports`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the web tests, typecheck and lint. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): board pack tiles, movement chart and owner breakout`.

### Task 6: End-to-end and final gate

**Files:**
- Modify:
  - `e2e/reports.spec.ts`: as CISO, open the board pack for last month. Expect:
    - 7 tiles;
    - the movement chart's "Show as table" reveals 12 week rows;
    - the "By risk owner" table has at least one row;
    - the PDF downloads.
  - `e2e/insights.spec.ts` (or the spec that covers the maps): a risk with no expected score makes the Expected map show the empty-state message. Its link lands on `/risks?filter=noExpectedScore` listing that risk. An above-appetite map cell has the computed colour of `critical`.
- Run axe on `/reports/board`, `/risks` and the risk detail page (the red badges).

- [ ] **Step 1: Write the specs.**
- [ ] **Step 2: Run** the full e2e suite. Expected: PASS.
- [ ] **Step 3: Run the full gate:** `pnpm typecheck && pnpm lint && pnpm format:check && pnpm test && pnpm test:integration && pnpm boundaries && pnpm e2e`. Expected: all PASS.
- [ ] **Step 4: Commit** `test(e2e): red above appetite and board pack graphics`.
