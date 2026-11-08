# ADR-0008: Control library provenance and licensing

Status: Accepted (2026-11-04)

Amended 2026-11-07 (Plan 10): NIST CSF 2.0 added. Amended 2026-11-07 (#19): requirement groups. Amended 2026-11-07 (Plan 12): NIST SP 800-53 Rev. 5, Moderate baseline, added. Amended 2026-11-08 (#16): the EU AI Act added.

## Context

The product ships a library of security controls, each mapped to the requirements of the frameworks a regulated organisation answers to (ISO/IEC 27001, GDPR, NIS2, and since 2026-11-07 NIST CSF 2.0 and NIST SP 800-53 Rev. 5). The text of ISO standards is copyrighted and licensed, so it cannot ship with the product. EU law (GDPR, NIS2) and NIST publications can be reused, but the library should read the same across frameworks. Mappings between controls and requirements are judgements that an auditor will want to see someone has checked.

## Decision

- **The ISO content is authored in-house, with AI assistance, from general knowledge of the topics each reference point addresses.** The standard's text was not used. The NIST CSF 2.0 titles are different: they were paraphrased in our own words from the published CSF 2.0 Core (NIST CSWP 29, 26 February 2024).
- **ISO is referenced by number only.** A requirement carries its reference (for example `A.8.13`) and a title that is our own sentence-form paraphrase. No `fullText` ships (P2-R3), and the content schemas reject the field.
- **GDPR and NIS2 are EU law**, reusable under Commission Decision 2011/833/EU. We still ship paraphrases, for consistency with the ISO entries.
- **NIST CSF 2.0 is a NIST publication**, not subject to copyright in the United States (17 U.S.C. §105), so it can be reused. NIST asks for attribution, and we credit NIST CSWP 29 as the source. We still ship own-words titles, for consistency with the other entries. It is referenced by subcategory ID (for example `GV.OC-01`).
- **Grouping is library data (#19), not parsed from references.** A framework file may list `groups` (`key`, `title`, optional `parent`), and then every requirement names its `group`. NIST CSF 2.0 has two levels: the six Functions (Govern to Recover), then the 22 Categories (for example `GV.OC` Organisational context), with NIST's names in sentence case and British spelling. ISO 27001:2022 Annex A has one level, its four themes (`A.5` Organisational controls to `A.8` Technological controls); the theme names describe the clause structure and are not licensed text. GDPR and NIS2 stay flat and omit `groups`. `validateLibrary` checks the shape: unique keys per version, at most two levels, a parent listed before its children, requirements only in leaf groups, groups listed in display order and each group's requirements together in that order, and no empty group. Sync upserts the groups (`RequirementGroup`, parents first) before the requirements and sets `Requirement.groupId`; like everything else, a group the content drops stays in the database. The Statement of Applicability shows a heading per group with its decided-of-total count.
- **NIST SP 800-53 Rev. 5 is also a NIST publication** (17 U.S.C. §105), reused on the same terms. We ship the 177 base controls of the SP 800-53B Moderate baseline, referenced by control ID (for example `AC-2`) and grouped by family. Titles are our own words, paraphrased from NIST's OSCAL catalogue (github.com/usnistgov/oscal-content, retrieved 2026-11-07), which we credit as the source; the family names are NIST's. No control text ships; importing it is a separate decision. Its mappings to our controls sit in a separate mapping file (`content/mappings/`), which the loader merges into the controls.
- **The EU AI Act (Regulation (EU) 2024/1689) is EU law**, reusable on the same terms as GDPR and NIS2 (#16). Its version key is `eu-ai-act-2024-1689`. We ship the 36 obligation-bearing provisions that the AI system register's obligation catalogue uses, referenced in the NIS2 form (`Art. 4`, `Art. 26(1)`) and grouped by the Regulation's Chapters (I, II, III, IV and IX, with their official titles). Titles are our own words, for consistency. Its controls are the `AIG-` controls (category `ai_governance`, `controls/ai-governance.json`); its mappings to existing controls sit in a mapping file (`mappings/eu-ai-act-2024-1689.json`). The general-purpose AI model duties (Art. 53 to 55) are not included.
- **Installations may later import their licensed text** into `Requirement.fullText` through an owner-run import. Sync never touches that column.
- **Mappings ship unreviewed** (`reviewedById` and `reviewedAt` are both NULL). They are reviewed in the app or through a CSV review. A database check requires both fields or neither.
- **Versioning is `YYYY.MM.patch`** (for example `2026.11.0`), set in `content/manifest.json` and stored on each control as `libraryVersion`.
- **Sync is owner-run and never deletes (P2-R11).** `pnpm db:seed` validates the content, then upserts frameworks, versions, requirement groups, requirements (title, order and group only) and controls, and creates missing mappings as unreviewed. Rows and mappings that the content no longer lists stay, and the summary reports the mappings as orphaned. Every foreign key is `ON DELETE RESTRICT`. After a sync adds controls, restart the worker so `library.embed` embeds them for AI suggestions.
- **The runtime role cannot change library content (P2-R2).** `isms_app` can read the library tables and may update only `reviewedById` and `reviewedAt` on a mapping. The init migration's default privileges give new tables full DML, so each library migration restricts its tables explicitly (the deferred T5 minor: new tables must state their grants).
- **Shared definitions live once.** The control categories, the code pattern and the code-prefix map are in `@isms/domain`. The content schemas derive from them, and a test asserts the Prisma enum matches.

## Consequences

- The library can be published and audited without licence exposure, and the AI-assisted origin is stated.
- A customer with a licence can add the standard's text without a schema change.
- Content corrections reach installations only through an owner-run sync, never at runtime.
- Removing a control or mapping from the content is not propagated. A later, explicit retirement mechanism would be needed.
