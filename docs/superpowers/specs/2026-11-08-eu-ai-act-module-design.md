# EU AI Act module — design

Date: 2026-11-08. Issue: #16. Plans: one per slice (§9).

## Problem

Regulation (EU) 2024/1689 (the AI Act) puts duties on organisations that build, sell or use AI systems in the EU. Our first clients are German financial firms. Credit scoring and life and health insurance pricing are high-risk uses under Annex III, point 5. These firms must keep an inventory of their AI systems and classify each one. They must also show they meet the duties of their role, next to their ISO 27001, NIS2, GDPR and DORA work. Today ComplAIent has nothing for this.

Many organisations need none of it. Organisations outside the EU, and those that neither place AI on the EU market nor use it there, don't. So the AI Act is an **optional module**. It is off until an administrator turns it on, and invisible while off.

## Decisions

### 1. Modules are a platform concept; the AI Act is the first one

- A new table `OrganisationModule (key, enabledAt, enabledById)` holds the modules switched on. `key` is the enum `ModuleKey`, which today has the single value `eu_ai_act`. A row present means on; a row absent means off. This is a mutable table, and a later module (for example DORA) adds an enum value.
- `PUT /organisation/modules/{key}` with `{ enabled: boolean }` turns a module on or off. It needs `organisation.manage`, and each change is audited as `organisation.module_enabled` or `organisation.module_disabled`. `GET /organisation` returns `modules: ModuleKey[]`, and so does `GET /me`, so the shell can build the navigation without a second call.
- **Off means it does not exist.** Every module route answers 404 (`NOT_FOUND`), not 403. This is the same rule as demo mode, Plan 9, and the check runs before the permission check. The navigation item and the Setup summary line are hidden. Turning a module off keeps its data, and turning it back on restores it unchanged.
- **The Setup screen:** a new **Modules** page (`/setup/modules`). It is not a required step, so it never appears in `setup.missing`. It shows one card per module, giving what the module is for, who needs it, who doesn't, and a switch. Turning a module off asks for confirmation and explains that the data is kept.

### 2. Permissions

There are two new permissions, both organisation-scoped only: `aiact.read` and `aiact.manage`.

| Role | aiact.read | aiact.manage |
|---|---|---|
| administrator | ✓ | |
| ciso | ✓ | ✓ |
| risk_owner | ✓ | ✓ |
| risk_approver | ✓ | |
| auditor | ✓ | |
| viewer | ✓ | |
| contributor | | |

`risk_owner` gets `aiact.manage` because the owner of an AI system is usually a business owner, not the CISO. Neither permission is added to `DEFAULT_SCOPED_PERMISSIONS`, so a site- or department-scoped assignment does not grant them.

### 3. The AI system register

A new schema file, `ai-act.prisma`.

- **`AiSystem`:**
  - `name` (unique ignoring case, through `nameKey`, the same pattern as `Asset`) and `description`;
  - `intendedPurpose`;
  - `role` (`AiActRole`: `provider | deployer | importer | distributor`);
  - `supplier?` and `model?` (free text, for example "vendor scoring engine v4");
  - `usesGeneralPurposeModel: boolean`;
  - `status` (`AiSystemStatus`: `planned | in_use | retired`);
  - `ownerId` → User and `departmentId?` → Department;
  - `riskClass` (`AiRiskClass`, see §4; default `unclassified`), plus `classification` (JSONB: the answers, validated by the contract schema), `classifiedAt?` and `classifiedById?`;
  - `createdById`, `createdAt` and `updatedAt`.
- **`AiSystemObligation`:** `aiSystemId`, `key` (a catalogue key, §5), `applicable: boolean`, `status` (`AiObligationStatus`: `open | in_progress | met | not_applicable`), `note` (≤ 2000 characters), `updatedById?` and `updatedAt`. It is unique on `(aiSystemId, key)`.
- **`AiSystemRisk`:** a join table (`aiSystemId`, `riskId`, `linkedById`, `linkedAt`), unique on the pair. It links a system to ISMS risks in the register.
- All three are mutable tables. History lives in the audit trail, as for assets. The audit actions are:
  - `ai_system.created`, `ai_system.updated`, `ai_system.classified` and `ai_system.obligation_updated`;
  - `ai_system.risk_linked` and `ai_system.risk_unlinked`.

  Each payload carries the changed field names and values, never free-text notes in full: the note is recorded as `noteChanged: true`.
- Retiring a system is a status change, never a delete. There is no DELETE route.

### 4. Classification is a questionnaire, decided by a pure function

`packages/domain/src/ai-act/` holds the questionnaire answer type, `classifyAiSystem(answers)` and the obligation catalogue. The function is pure and fully unit-tested. The API stores its result, and the web app shows its reasons.

**Questions** (the answers are a Zod schema in `@isms/contracts`):
1. `isAiSystem`: is it an AI system as defined in Art. 3(1), a machine-based system that infers from input how to generate outputs? `false` gives `out_of_scope`.
2. `prohibitedPractices`: the Art. 5(1) practices that apply. The enum is `subliminal_manipulation`, `exploiting_vulnerabilities`, `social_scoring`, `crime_prediction_profiling`, `untargeted_face_scraping`, `emotion_recognition_work_education`, `biometric_categorisation_sensitive` and `realtime_remote_biometric_id`. Any value gives `prohibited`.
3. `annexISafetyComponent`: the system is a safety component of, or is itself, a product under the Annex I harmonisation legislation that needs third-party conformity assessment (Art. 6(1)). `true` gives `high_risk`.
4. `annexIIIAreas`: the Annex III uses that apply.
   - The enum: `biometrics`, `critical_infrastructure`, `education`, `employment`, `essential_public_services`, `creditworthiness`, `life_health_insurance`, `emergency_triage`, `law_enforcement`, `migration_border`, `justice_democracy`.
   - The web app says that fraud detection is excluded from creditworthiness, as point 5(b) states.
5. Asked only when an Annex III area is chosen:
   - `profilesPeople`: does the system profile natural persons? `true` always gives `high_risk` (Art. 6(3), last subparagraph).
   - `derogation`: one of `none`, `narrow_procedural_task`, `improves_completed_human_activity`, `detects_patterns_without_replacing_review` or `preparatory_task` (Art. 6(3)(a)–(d)).
   - Rule: an area chosen, no profiling and a derogation other than `none` gives **not high-risk**, with `derogationApplied: true`. Any other answer gives `high_risk`.
6. `transparency` (Art. 50), several may apply:
   - `interacts_with_people`;
   - `generates_synthetic_content`;
   - `emotion_recognition_or_biometric_categorisation`;
   - `deep_fake`;
   - `public_interest_text`.

**Result:** `{ riskClass, transparencyDuties: string[], derogationApplied: boolean, reasons: Reason[] }`.
- `riskClass` is one of `out_of_scope | prohibited | high_risk | limited_risk | minimal_risk`. `unclassified` exists only on a stored system before its first classification.
- The precedence is prohibited > high_risk > limited_risk (at least one transparency duty, and not high-risk) > minimal_risk.
- Transparency duties apply on top of high-risk, too.
- Each `Reason` is `{ code, article }`. The web app turns codes into sentences.

### 5. Obligations follow from class, role and answers

The catalogue is a constant in `packages/domain/src/ai-act/obligations.ts`. It gives each obligation a `key`, an `article`, and an `appliesTo(result, role, answers)` predicate. The keys:

- **Any role and any class except `out_of_scope`:** `ai_literacy` (Art. 4). It applies to providers and deployers only.
- **`prohibited`:** `stop_prohibited_practice` (Art. 5).
- **`high_risk`, provider:**
  - `risk_management_system` (Art. 9), `data_governance` (Art. 10) and `technical_documentation` (Art. 11);
  - `automatic_logging` (Art. 12), `instructions_for_deployers` (Art. 13), `human_oversight_by_design` (Art. 14) and `accuracy_robustness_security` (Art. 15);
  - `quality_management_system` (Art. 17), `conformity_assessment` (Art. 43), `eu_declaration_and_ce_marking` (Art. 47–48) and `eu_database_registration` (Art. 49(1));
  - `post_market_monitoring` (Art. 72), `serious_incident_reporting` (Art. 73) and `corrective_actions` (Art. 20).
- **`high_risk`, deployer:**
  - `use_per_instructions` (Art. 26(1)), `assign_human_oversight` (Art. 26(2)) and `input_data_quality` (Art. 26(4));
  - `monitor_and_report` (Art. 26(5)), `keep_logs_six_months` (Art. 26(6)), `inform_workers` (Art. 26(7)), `inform_affected_people` (Art. 26(11)) and `dpia_where_required` (Art. 26(9));
  - `right_to_explanation` (Art. 86);
  - `fundamental_rights_impact_assessment` (Art. 27), only when `annexIIIAreas` includes `creditworthiness`, `life_health_insurance` or `essential_public_services`.
- **`high_risk`, importer:** `importer_verification` (Art. 23). **Distributor:** `distributor_verification` (Art. 24).
- **`derogationApplied`:** `document_not_high_risk_assessment` (Art. 6(4)) and `register_not_high_risk` (Art. 49(2)), provider only.
- **Transparency:**
  - providers: `disclose_ai_interaction` (Art. 50(1)) when `interacts_with_people`, and `mark_synthetic_content` (Art. 50(2)) when `generates_synthetic_content`;
  - deployers: `inform_emotion_or_biometric_exposure` (Art. 50(3)), `disclose_deep_fake` (Art. 50(4)) and `disclose_ai_generated_text` (Art. 50(4)), each when its matching transparency duty applies.

**Saving a classification** runs `classifyAiSystem` on the server. It never trusts a class sent by the client. The save updates the system and reconciles the obligations in one transaction:
- a new applicable key is inserted as `open`;
- an existing row keeps its status and note, and gets `applicable` set to true or false;
- a no-longer-applicable row is never deleted, so that work done on it isn't lost.

A role change re-runs the reconciliation when a classification exists.

General-purpose AI **model** provider duties (Art. 53–55) are out of scope: they fall on model providers, not on our clients. `usesGeneralPurposeModel` is recorded for context only.

### 5a. AI assistance, never required

The module is fully usable with AI turned off: the questionnaire, the rules and the obligation catalogue decide everything. AI only makes the work quicker. AI never decides a class, and a person always reviews and saves.

There are two new AI purposes, `ai_act_classification` and `ai_act_obligation_guidance`. They are synchronous gateway calls from the API, following the `control_test_steps` pattern: a structured-output schema, an `AiInteraction` row, the mock provider replies, and the readiness check. Both use the `controls` model key.

1. **Draft the answers** (`POST /ai-act/systems/{id}/classification/draft`, `aiact.manage`):
   - **Input:** the system's name, description, intended purpose, role, supplier, model and `usesGeneralPurposeModel`. The text fields are wrapped as untrusted, as with the existing purposes.
   - **Output:** a full answers object (§4) that validates against the same contract schema, plus one short rationale per question.
   - **Use:** the wizard pre-fills its answers and shows each rationale under its question with an "AI suggestion" label. The user changes what they want and saves. The saved classification records `source: "manual" | "ai_assisted"` in the `classification` JSON, and the audit event records it too.
   - **Validation:** output that fails the schema returns `AI_INVALID_OUTPUT`, as the other purposes do. The wizard then simply stays empty.
2. **Suggest steps for an obligation** (`POST /ai-act/systems/{id}/obligations/{key}/guidance`, `aiact.manage`):
   - **Input:** the same profile fields plus the obligation key, its article and the system's class.
   - **Output:** 3 to 6 short practical steps and an optional evidence hint.
   - **Use:** the steps are shown in the obligation row. **Add to note** appends them to the note, which the user then saves. Nothing is stored until the user saves.

**Data minimisation:** no person names, emails, owner or department names, linked risk titles or notes are sent; only the system profile fields above go to the provider. ADR-0009 and `docs/security/architecture.md` §9 and §12.1 list both purposes and their data classes.

**AI off or not ready:** the AI buttons are not rendered, and the routes return the same `AI_UNAVAILABLE` / `AI_DISABLED` error the other purposes return. Every page reads and works the same without AI. The obligation descriptions in `ai-act.json` are written so that a person can act on them unaided.

### 6. Linked to the rest of the ISMS

- **The control library:**
  - A new framework: key `eu-ai-act`, name `EU AI Act`, publisher `European Union`, version key `eu-2024-1689`, label `Regulation (EU) 2024/1689`.
  - Its requirements are the articles listed in §5, plus Art. 6. Refs use the NIS2 form (`Art. 26(1)`), and titles are in our own words in the library's sentence style (EU law could ship as text, but we keep the library's style).
  - There is a new control file, `controls/ai-governance.json`, with about 10 `AIG-` controls: an AI system inventory, classification, AI literacy, human oversight, transparency notices, logging and monitoring, AI supplier due diligence, impact assessment, AI incident reporting, and data governance for AI.
  - Every requirement maps to at least one control. Existing controls are reused where they fit, for example incident, supplier and privacy controls.
  - The framework is ordinary library content. It appears in Setup → Frameworks and the SoA for everyone, as GDPR and NIS2 do. Turning the module on does **not** add it to the scope. The module overview shows a hint linking to Setup → Frameworks while it is not in scope.
- **Risks:** a system detail page lists linked risks. Users with `aiact.manage` and `risks.read` can link and unlink risks they can see. The API returns only links to risks the viewer may see, through the existing risk visibility rules, so scoped users never see titles outside their scope.
- **Audit:** every change is in the audit trail (§3).

### 7. Web

- **Navigation:** an **EU AI Act** item (icon `ScaleIcon`) appears when `modules` includes `eu_ai_act` and the viewer holds `aiact.read`. The page headers carry a small "Module" badge, so that it's clear this is an add-on.
- **`/ai-act`, the overview:**
  - counts by risk class, the unclassified systems, and the open obligations of high-risk systems;
  - the register table: name, role, status, class, owner, and open obligations;
  - a button to add a system, for `aiact.manage`;
  - the framework-scope hint.
- **`/ai-act/systems/new` and `/ai-act/systems/[id]/edit`:** the profile form.
- **`/ai-act/systems/[id]`:** the profile; the classification result with its reasons as sentences and article refs; the obligations checklist (status select and note), where applicable obligations come first and inapplicable ones are collapsed and greyed; and the linked risks.
- **`/ai-act/systems/[id]/classify`:** the questionnaire as a short wizard, one question group per step, with plain-language help for each option. It shows the server's result before leaving.
- Copy lives in `apps/web/messages/en/ai-act.json`: questions, options, reasons, and obligation titles and descriptions in plain words.
- **ComplAIent's own transparency** (Art. 50(1)):
  - the concern conversation already shows an "AI assistant" badge; its intro line also says the reporter is talking to an AI and that a person reviews everything;
  - AI-drafted content (risk drafts, control suggestions, test steps, board narrative) carries an "AI-drafted" label wherever it is shown, unless it already has one.

### 8. Documentation and sample data

- `docs/security/eu-ai-act.md` covers how ComplAIent classifies itself (not high-risk: no Annex III use; Art. 50(1) applies to the concern assistant). It also covers what that means for a deploying client: Art. 4 literacy, and the data each AI purpose sends, as in ADR-0009.
- The README gets a feature row and the planned-next line is updated. The architecture doc gets a short module paragraph, covering the new tables, the permissions, and 404-when-off.
- The demo company has the module on and four systems, so the sample shows every path:
  - a credit scoring engine: deployer, Annex III creditworthiness, high-risk, with the FRIA;
  - a customer service chatbot: deployer, limited risk, Art. 50;
  - a transaction fraud detector: deployer, minimal risk, with the 5(b) exclusion noted in its purpose;
  - a CV screening tool: deployer, `planned`, employment, high-risk.
  
  Some obligations are met, and one system links to an existing sample risk.

### 9. Delivery slices

Each slice is a PR that is green on CI and merged before the next one that depends on it.

1. **Library content:** the framework, the AIG controls and the mappings. It is independent of the others.
2. **Domain, schema, contracts and API:**
   - `classifyAiSystem` and the catalogue;
   - the two AI purposes (§5a): the enum migration, `packages/ai/src/purposes`, mock replies, readiness, and the ADR-0009 and architecture §9 and §12.1 entries;
   - the migration, with grants that follow the default privileges, all tables mutable;
   - the module table and its routes; `modules` on `/me` and `/organisation`;
   - the `ai-act` API module with 404-when-off;
   - the permissions;
   - the audit trail;
   - integration tests and the OpenAPI snapshot.
3. **Web:** Setup → Modules, the navigation, the pages and the wizard, the AI draft and the guidance UI (hidden when AI is off), the transparency labels, unit tests and an e2e spec. The e2e spec runs one path with the mock AI and one without. It depends on 2.
4. **Sample data and docs:** the demo company systems, `docs/security/eu-ai-act.md`, the README and the architecture paragraph. It depends on 2, and on #7/#8 for the demo package.

## Out of scope (later)

- Fundamental rights impact assessment as a structured, versioned record. For now it is an obligation with status and note.
- AI incident records and Art. 73 deadlines, which belong with the planned incident module (one record serving DORA and the AI Act).
- AI literacy training records per person.
- An AI register export (XLSX or PDF) and an AI section in the board report.
- ISO/IEC 42001 in the library.
- GPAI model provider duties.
- Application dates per obligation. The Digital Omnibus proposal may move the high-risk dates, so the product shows no dates until that is settled.
