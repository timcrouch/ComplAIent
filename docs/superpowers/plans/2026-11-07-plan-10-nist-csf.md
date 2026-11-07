# Plan 10 — NIST Cybersecurity Framework 2.0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The control library ships NIST CSF 2.0 as a fourth framework, next to ISO/IEC 27001:2022, GDPR and NIS2. All 106 CSF 2.0 subcategories are listed with own-words titles, and every one is mapped to at least one library control. An organisation with US operations can choose NIST in Setup (the AI may suggest it), see NIST mappings in the library, and get a Statement of Applicability for it.

**Why:** a customer operates globally, including the US, where NIST CSF is the common reference.

**Architecture:** content only, plus the library's own tests and docs.
- The app is data-driven: Setup, the library, the SoA and the AI framework suggestion all read frameworks from the synced library. No API, web, schema or migration change.
- New content: `content/frameworks/nist-csf-2.0.json`, three new governance controls (GOV-14 to GOV-16) for CSF outcomes no control covers today, and `nist-csf-2.0` mappings added to existing controls.
- `references.ts` gains `NIST_CSF_2_REFS` (IDs only). `themes.ts` gains a `nist` list per theme that partitions the 106 refs.
- Existing installations get the content through the owner-run sync (`pnpm db:seed`), as ADR-0008 says.

**Tech Stack:** as in Plan 9. No new dependencies.

**Source:** NIST CSWP 29, *The NIST Cybersecurity Framework (CSF) 2.0*, 26 February 2024, Appendix A. The 106 IDs below were extracted from the official PDF (GV 31, ID 21, PR 22, DE 11, RS 13, RC 8). Rulings for this plan are P10-R*.

## Global Constraints

- **Keys and labels, exactly:** framework key `nist-csf`, name `NIST CSF`, publisher `NIST`, version key `nist-csf-2.0`, version label `2.0`. The manifest lists the file after NIS2. `libraryVersion` becomes `2026.11.1`.
- **References are the official CSF 2.0 IDs** (`GV.OC-01` … `RC.CO-04`), in the Core's order, exactly the 106 in `NIST_CSF_2_REFS` below. No withdrawn IDs (for example no `ID.AM-06`).
- **Titles are our own words (ADR-0008).** NIST text is a US government work and free to reuse, but the library reads the same across frameworks, so each title is an own-words sentence: starts with a capital, ends with a full stop, 5 to 16 words (the existing content test). Do not copy the NIST sentence.
- **Summary** at most 300 characters, plain language, saying who it is for (US and global organisations; voluntary; widely used by US regulators, customers and insurers).
- **Every one of the 106 refs is mapped** to at least one control, and each is mapped by a control in the theme the partition below assigns it to. Extra mappings to controls in other themes are allowed where clearly right.
- **Control authoring rules (existing tests):** title 3 to 12 words, no full stop; description at most 400 characters, 1 to 3 sentences; 2 to 6 guidance steps, each at most 200 characters; codes numbered without gaps; at most 20 controls per file; every content file under 500 lines. Same voice as the existing controls: plain, concrete, second person, no jargon.
- **Mappings ship unreviewed**, as all mappings do. A mapping claims the control helps meet the outcome; prefer fewer, defensible mappings over many weak ones.
- **No change** to the AI mock (`packages/ai/src/mock/framework-suggestion.ts`), the demo sample company (German; stays ISO 27001, NIS2, GDPR), or any app code.

### NIST_CSF_2_REFS (in this order)

GV.OC-01..05, GV.RM-01..07, GV.RR-01..04, GV.PO-01..02, GV.OV-01..03, GV.SC-01..10,
ID.AM-01, ID.AM-02, ID.AM-03, ID.AM-04, ID.AM-05, ID.AM-07, ID.AM-08, ID.RA-01..10, ID.IM-01..04,
PR.AA-01..06, PR.AT-01..02, PR.DS-01, PR.DS-02, PR.DS-10, PR.DS-11, PR.PS-01..06, PR.IR-01..04,
DE.CM-01, DE.CM-02, DE.CM-03, DE.CM-06, DE.CM-09, DE.AE-02, DE.AE-03, DE.AE-04, DE.AE-06, DE.AE-07, DE.AE-08,
RS.MA-01..05, RS.AN-03, RS.AN-06, RS.AN-07, RS.AN-08, RS.CO-02, RS.CO-03, RS.MI-01, RS.MI-02,
RC.RP-01..06, RC.CO-03, RC.CO-04.

(`..` means every number in the range, two digits.) The official outcome text for each ID, for paraphrasing only, is in the workspace file `nist-outcomes.txt`.

### Theme partition and suggested primary controls

The partition is binding. The suggested controls are the expected mapping. The implementer may swap one for a clearly better control in the same theme, and must say so in the report.

**governance-privacy-suppliers (41):**

| Ref | Control(s) | Ref | Control(s) |
|---|---|---|---|
| GV.OC-01 | GOV-14 | GV.SC-01 | SUP-01 |
| GV.OC-02 | GOV-14 | GV.SC-02 | SUP-02, GOV-02 |
| GV.OC-03 | GOV-07 | GV.SC-03 | SUP-01 |
| GV.OC-04 | GOV-14 | GV.SC-04 | SUP-01 |
| GV.OC-05 | SUP-01 | GV.SC-05 | SUP-02 |
| GV.RM-01 | GOV-15 | GV.SC-06 | SUP-01, PRV-09 |
| GV.RM-02 | GOV-15 | GV.SC-07 | SUP-04 |
| GV.RM-03 | GOV-15 | GV.SC-08 | SUP-02 |
| GV.RM-04 | GOV-15 | GV.SC-09 | SUP-04 |
| GV.RM-05 | GOV-15 | GV.SC-10 | SUP-04 |
| GV.RM-06 | GOV-13 | ID.AM-04 | SUP-01 |
| GV.RM-07 | GOV-15 | ID.RA-02 | GOV-05 |
| GV.RR-01 | GOV-16 | ID.RA-03 | GOV-05, GOV-13 |
| GV.RR-02 | GOV-02 | ID.RA-04 | GOV-13 |
| GV.RR-03 | GOV-16 | ID.RA-05 | GOV-13 |
| GV.PO-01 | GOV-01 | ID.RA-06 | GOV-13 |
| GV.PO-02 | GOV-01 | ID.RA-09 | SUP-03 |
| GV.OV-01 | GOV-16 | ID.RA-10 | SUP-01 |
| GV.OV-02 | GOV-16 | ID.IM-01 | GOV-10, GOV-11 |
| GV.OV-03 | GOV-16 | DE.CM-06 | SUP-04 |
| | | DE.AE-07 | GOV-05 |

**assets-access-people-physical (17):** GV.RR-04 PPL-02, PPL-04 · ID.AM-01 AST-01 · ID.AM-02 AST-01 · ID.AM-05 AST-04 · ID.AM-07 AST-04 · ID.AM-08 AST-03, AST-07 · PR.AA-01 ACC-02 · PR.AA-02 PPL-01 · PR.AA-03 ACC-08 · PR.AA-04 ACC-03 · PR.AA-05 ACC-01, ACC-05 · PR.AA-06 PHY-02 · PR.AT-01 PPL-03 · PR.AT-02 PPL-03 · PR.PS-03 PHY-09 · PR.IR-02 PHY-04 · DE.CM-02 PHY-03.

**operations-resilience-incidents-development (48):** ID.AM-03 OPS-10 · ID.RA-01 OPS-03 · ID.RA-07 DEV-08 · ID.RA-08 DEV-11 · ID.IM-02 DEV-05 · ID.IM-03 INC-04 · ID.IM-04 INC-01, RES-01 · PR.DS-01 OPS-14 · PR.DS-02 OPS-14 · PR.DS-10 OPS-06 · PR.DS-11 RES-03 · PR.PS-01 OPS-04 · PR.PS-02 OPS-03 · PR.PS-04 OPS-08 · PR.PS-05 OPS-02 · PR.PS-06 DEV-01 · PR.IR-01 OPS-10, OPS-12 · PR.IR-03 RES-04 · PR.IR-04 RES-04 · DE.CM-01 OPS-09 · DE.CM-03 OPS-09 · DE.CM-09 OPS-09 · DE.AE-02 OPS-09 · DE.AE-03 OPS-09 · DE.AE-04 INC-02 · DE.AE-06 OPS-09 · DE.AE-08 INC-02 · RS.MA-01 INC-01 · RS.MA-02 INC-02 · RS.MA-03 INC-02 · RS.MA-04 INC-02 · RS.MA-05 INC-03 · RS.AN-03 INC-04 · RS.AN-06 INC-05 · RS.AN-07 INC-05 · RS.AN-08 INC-02 · RS.CO-02 INC-06 · RS.CO-03 INC-06 · RS.MI-01 INC-03 · RS.MI-02 INC-03 · RC.RP-01 INC-03 · RC.RP-02 RES-01 · RC.RP-03 RES-03 · RC.RP-04 RES-02 · RC.RP-05 INC-03 · RC.RP-06 INC-04 · RC.CO-03 RES-02 · RC.CO-04 RES-02.

### New governance controls (category `governance`, file `controls/governance.json`)

- **GOV-14**, on the organisation's mission and who depends on it (GV.OC-01, -02, -04): security decisions start from what the organisation must deliver, to whom, and what customers, regulators and partners expect.
- **GOV-15**, on risk appetite and the risk strategy (GV.RM-01 to -05 and -07): leadership sets objectives, an appetite and tolerances, ties security risk into enterprise risk, states the preferred responses, and also looks for opportunities. The product already records an appetite threshold on the risk scale, so the guidance can point at it.
- **GOV-16**, on leadership oversight and resourcing (GV.RR-01, -03, GV.OV-01 to -03): leadership is accountable, funds the programme, reviews results on a schedule and adjusts the strategy.

Each new control maps only to `nist-csf-2.0` refs unless an ISO, GDPR or NIS2 ref clearly fits. ISO clauses 4 to 10 are not in the library, so do not invent Annex A mappings.

## Review Focus

- Every NIST title is our own words, not NIST's sentence lightly edited, and says the same outcome.
- Mappings are defensible: a reviewer reading the control and the outcome agrees the control helps meet it.
- The three new controls match the existing voice and pass the authoring rules.

### Task 1: NIST CSF 2.0 framework, mappings and library tests

**Files:**
- Create: `packages/control-library/content/frameworks/nist-csf-2.0.json`
- Modify: `packages/control-library/content/manifest.json` (add the file after NIS2; `libraryVersion` `2026.11.1`)
- Modify: `packages/control-library/src/references.ts` (export `NIST_CSF_2_REFS`, IDs only, built so the order is exactly the list above)
- Modify: `packages/control-library/src/themes.ts` (`nist: string[]` on `Theme` and on each theme, from the partition)
- Modify: the control files under `content/controls/` (add mappings; add GOV-14 to GOV-16)
- Modify: `packages/control-library/test/content.test.ts`, `test/themes.test.ts`

- [ ] **Step 1: Tests first.**
  - `content.test.ts`:
    - the framework-versions test expects four rows, the fourth `["nist-csf-2.0", "nist-csf", "NIST CSF", "NIST", "2.0"]`;
    - new test "NIST CSF 2.0 lists the 106 subcategories in Core order": `refsOf(lib, "nist-csf-2.0")` equals `NIST_CSF_2_REFS`, which has length 106, with per-function counts GV 31, ID 21, PR 22, DE 11, RS 13, RC 8;
    - new test: the themes partition `NIST_CSF_2_REFS` (each ref in exactly one theme), the same way the Annex A partition test works.
  - `themes.test.ts`: the per-theme coverage test also asserts every `theme.nist` ref is mapped by that theme's controls (`nist-csf-2.0 <ref>`).
  - Run `pnpm --filter @isms/control-library test`. Expected: the new tests fail.
- [ ] **Step 2: `NIST_CSF_2_REFS` and the theme partition.**
- [ ] **Step 3: The framework file** with 106 own-words titles, following the Global Constraints, and the manifest entry and version.
- [ ] **Step 4: The mappings and GOV-14 to GOV-16**, following the partition table.
- [ ] **Step 5: Verify.**
  - `pnpm --filter @isms/control-library test`, typecheck and lint: all green, no warnings.
  - `pnpm db:seed` on the dev database: the summary shows the NIST version with 106 requirements and the new mappings created.
- [ ] **Step 6: Commit** `feat(library): NIST CSF 2.0`.

### Task 2: Docs and the full gate

**Files:**
- Modify: `docs/decisions/0008-control-library-provenance.md`: NIST CSF in the context; a bullet that NIST publications are US government works (not subject to US copyright, 17 U.S.C. §105), so they can be reused, and that we still ship own-words titles for consistency.
- Modify: `docs/superpowers/specs/2026-11-03-isms-foundation-design.md` §1 item 4 and §9: add NIST CSF 2.0, with a dated note "(added 2026-11-07, Plan 10)".

- [ ] **Step 1: Docs**, as above. Keep the existing style: short sentences, plain words.
- [ ] **Step 2: Full gate.** Run the whole workspace's typecheck, lint, unit and integration tests, and `pnpm e2e`. Fix anything the new framework breaks (for example a test that assumed three frameworks), without changing app behaviour. Report each command and its result.
- [ ] **Step 3: Commit** `docs: NIST CSF 2.0 in the library provenance and spec`.
