# EU AI Act

Status: current as of the EU AI Act module (#16, 2026-11-08). The design is in `docs/superpowers/specs/2026-11-08-eu-ai-act-module-design.md`. Keep this document in step with the code: a new AI purpose, a change to the classification rules or the obligation catalogue, or a change to what a purpose sends updates it in the same pull request.

This document covers three things:

- where ComplAIent itself stands under Regulation (EU) 2024/1689 (the AI Act);
- what an organisation that runs ComplAIent with AI turned on has to do;
- how the optional EU AI Act module works.

**It is not legal advice.** It records how we read the Regulation when we built the product. Each organisation decides its own position, with its own legal advice.

## 1. ComplAIent's own position

### 1.1 Its AI features, and why none of them is high-risk

ComplAIent calls a language model only through the AI gateway in `@isms/ai` (ADR-0009, `docs/security/architecture.md` §9). The purposes are in `packages/ai/src/purposes/`:

| Purpose                      | Feature                                                    | File                         |
| ---------------------------- | ---------------------------------------------------------- | ---------------------------- |
| `concern_turn`               | The conversational concern assistant, which drafts a risk  | `concern-turn.ts`            |
| `control_suggestion`         | Suggested controls for a risk (a worker job)               | `control-suggestion.ts`      |
| `framework_suggestion`       | Suggested frameworks for the organisation in Setup         | `framework-suggestion.ts`    |
| `posture_summary`            | The board report's narrative                               | `posture-summary.ts`         |
| `control_test_steps`         | Suggested steps for testing a control                      | `control-test-steps.ts`      |
| `ai_act_classification`      | Suggested questionnaire answers for an AI system (§3.5)    | `ai-act-classification.ts`   |
| `ai_act_obligation_guidance` | Suggested practical steps for one AI Act obligation (§3.5) | `ai-act-guidance.ts`         |
| `connection_test`            | The administrator's key test; no business data             | `packages/ai/src/gateway.ts` |

None of these is a use listed in Annex III. They structure security and compliance records. They do not identify or categorise people by biometrics, and they do not run critical infrastructure. They do not decide on access to education, on employment or on workers, and they do not assess creditworthiness, insurance or eligibility for public services. Nor do they touch law enforcement, migration or the administration of justice. None of them is a safety component of an Annex I product. So we classify ComplAIent as **not high-risk** under Art. 6, and its AI features carry no Chapter III duties.

None of the purposes is a practice that Art. 5 prohibits.

### 1.2 Art. 50(1): the concern assistant

The concern assistant holds a conversation with the person reporting a concern. That makes it an AI system intended to interact directly with natural persons, so Art. 50(1) applies: people must be told that they are talking to an AI system. The other purposes do not converse with anyone. They fill in a draft that the user asked for with a button.

How the web app discloses it:

- the reporter chooses the conversation ("Talk it through with the assistant instead") on the report page; the step form stays available ("Prefer a form?");
- every assistant message in the conversation carries an **AI assistant** badge, and suggested answer chips are labelled "Suggested by AI" (`apps/web/messages/en/report.json`, `report.chat`);
- the conversation's intro says that the reporter is talking to an AI, and that a person reviews everything (spec §7);
- the summary the assistant drafts is labelled "Written by the assistant", and nothing is reported until the reporter checks it and sends it.

Content drafted by AI elsewhere (risk drafts, control suggestions, test steps, the board narrative and the AI Act suggestions) carries an "AI-drafted" or "AI suggestion" label wherever it is shown (spec §7).

### 1.3 A person reviews every AI output

Model output is never a record by itself. It is stored only as a suggestion, a draft or a labelled estimate. A person's explicit action turns it into a record, and that action is audited as theirs (`docs/security/architecture.md` §9, "No official change from AI"). For example:

- a drafted concern becomes a risk only when the reporter sends it, and the risk is then reviewed and approved under separation of duties (§12 there);
- a suggested control is accepted or rejected by a person;
- a board narrative is approved before it appears in the board pack;
- an AI Act classification draft only pre-fills the questionnaire, and the class always comes from the rules (§3.1).

### 1.4 AI can be turned off entirely

AI is off on a fresh installation. It runs only when an administrator has saved a provider key, turned both privacy switches on, chosen the models and turned on the master switch in **Settings → AI assistant** (`AiSettings.enabled`; readiness order in ADR-0009). Turning the master switch off stops every business call. Every workflow works without AI: the step form for concerns, controls from the library search, frameworks chosen by hand, a narrative written by hand, and the AI Act questionnaire answered by hand. With AI off, no AI action is offered.

## 2. What a deploying organisation has to do

An organisation that runs ComplAIent with AI turned on is a deployer of an AI system (Art. 3(4)). Under our reading in §1, that brings these duties.

### 2.1 AI literacy (Art. 4)

The organisation must take measures so that the staff who use the AI features have a sufficient level of AI literacy. This means knowing what the assistant does and where it can be wrong, and that its output is a draft to check. Pointers:

- the European Commission's AI literacy questions and answers, and the AI Office's living repository of AI literacy practices;
- this document and the in-app labels (§1.2), as material for internal training;
- the module itself (§3): an organisation can register ComplAIent in its own AI register. As a deployer with the `interacts_with_people` duty and no Annex III area, the rules class it as limited risk, with `ai_literacy` as its obligation.

### 2.2 Knowing what each purpose sends

What each purpose sends to the provider, and what it never sends, is recorded in ADR-0009 (`docs/decisions/0009-ai-gateway-and-data-handling.md`) and in `docs/security/architecture.md` §9 and §12.1. We do not repeat it here. In short:

- reporter text, risk text and organisation answers go into user-role messages, wrapped as untrusted;
- the control library is shared content;
- `control_test_steps` sends only the library control (code, title, description, guidance);
- `posture_summary` sends the board period, the headline counts and the top risks' references, titles, owners and treatments (`packages/ai/src/purposes/posture-summary.ts`);
- the two AI Act purposes send the AI system's profile fields only (§3.5).

The organisation should reflect this in its records of processing (GDPR Art. 30) and, where it is required, in a DPIA.

### 2.3 EU-only routing and zero retention

With EU-only routing on, every call goes to OpenRouter's EU endpoint. Every request requires zero-data-retention endpoints (`zdr: true`) and denies data collection (`data_collection: "deny"`), and the model list shows only zero-retention models. The gateway refuses every business call while either privacy switch is off (ADR-0009, `docs/security/architecture.md` §9). Every call is recorded as an `AiInteraction` row in the organisation's own database, so the organisation can show what was sent and what came back.

## 3. How the module works

The AI Act module helps the organisation keep an inventory of the AI systems it provides, deploys, imports or distributes, classify each one and track the duties of its role. It is optional, and off until an administrator turns it on.

### 3.1 Classification rules

`classifyAiSystem(answers)` in `packages/domain/src/ai-act/classify.ts` is a pure function of the questionnaire's answers (`packages/domain/src/ai-act/answers.ts`). The precedence is:

1. **Not an AI system** under Art. 3(1): `out_of_scope`.
2. **Any Art. 5(1) practice:** `prohibited`. No transparency duties are added, since the only thing to do is to stop.
3. **High-risk:** an Annex I safety component (Art. 6(1)), or an Annex III use (Art. 6(2)). An Annex III use is not high-risk when the system does not profile people and one of the Art. 6(3)(a)–(d) conditions applies (`derogationApplied: true`). Profiling always keeps it high-risk (Art. 6(3), last subparagraph). An unanswered follow-up question counts as not established.
4. **Limited risk:** at least one Art. 50 transparency duty, and not high-risk.
5. **Minimal risk:** everything else.

Transparency duties also apply on top of high-risk. The result carries `reasons` (a code and an article each), which the web app turns into sentences. `answerProblems` rejects inconsistent answers (repeated values, follow-up questions answered without an Annex III area, or left blank with one), both in the contract and for AI output.

The server always runs the rules itself: the client sends only answers, never a class (`apps/api/src/ai-act/ai-system-classification.service.ts`).

### 3.2 The obligations catalogue

`AI_OBLIGATIONS` in `packages/domain/src/ai-act/obligations.ts` gives each obligation a key, an article and an `appliesTo(result, role, answers)` predicate. It covers AI literacy (Art. 4), stopping a prohibited practice (Art. 5), the provider duties for high-risk systems (Art. 9–17, 20, 43, 47–49(1), 72, 73), the deployer duties (Art. 26, Art. 86, and the FRIA of Art. 27 for Annex III point 5(a)–(c) uses), the importer and distributor checks (Art. 23, 24), the Art. 6(4) and 49(2) duties of a provider that relies on a derogation, and the Art. 50 transparency duties of each role.

Saving a classification reconciles the system's `AiSystemObligation` rows in the same transaction (`apps/api/src/ai-act/reconcile.ts`). A new applicable key is opened as `open`. A stored row keeps its status and note and gets `applicable` set. A row is never deleted, so recorded work is not lost. A role change re-runs the reconciliation when the system is classified. Catalogue keys are stored, so a key is never renamed or removed.

### 3.3 Off means it does not exist

`OrganisationModule` (`packages/database/prisma/schema/organisation.prisma`) holds the modules switched on: a row present means on. `PUT /api/v1/organisation/modules/{key}` turns a module on or off. It needs `organisation.manage`, and it is audited as `organisation.module_enabled` or `organisation.module_disabled`. While the module is off, every `/api/v1/ai-act/*` route answers **404 `NOT_FOUND`**, after authentication and before the permission check (`ModuleGate`, `apps/api/src/authorization/module-gate.ts`). The navigation item is hidden. Turning the module off keeps its data, and turning it back on shows that data unchanged.

Turning the module on does not put the EU AI Act framework (`eu-ai-act`, version `eu-ai-act-2024-1689`) in scope. It is ordinary library content in Setup → Frameworks and the SoA.

### 3.4 Permissions and audit

There are two permissions, both granted only by organisation-scoped assignments (`packages/contracts/src/permissions.ts`, role grants in `apps/api/src/authorization/roles.ts`):

- `aiact.read`: administrator, ciso, risk_owner, risk_approver, auditor and viewer;
- `aiact.manage`: ciso and risk_owner.

They are not in `DEFAULT_SCOPED_PERMISSIONS` (`apps/api/src/authorization/scoped-permissions.ts`), so a site- or department-scoped assignment grants neither. Linking a system to a risk also needs `risks.read`. Only a risk the actor may see can be linked, and a reader sees only links to risks they may see.

`AiSystem`, `AiSystemObligation` and `AiSystemRisk` (`packages/database/prisma/schema/ai-act.prisma`) are mutable, and their history is the audit trail. The actions are `ai_system.created`, `ai_system.updated`, `ai_system.classified`, `ai_system.obligation_updated`, `ai_system.risk_linked` and `ai_system.risk_unlinked`. Payloads carry field names and values. Free text is recorded by length only (description, intended purpose), and a note as `noteChanged: true`. A risk is recorded by its id and reference, never its title. There is no delete: retiring a system is a status change.

### 3.5 AI assistance, and what it sends

The module works fully with AI off. With AI on and ready, a holder of `aiact.manage` can ask for:

- **draft answers** (`POST /api/v1/ai-act/systems/{id}/classification/draft`): a full answers object, with a short rationale per question, that pre-fills the questionnaire. The draft must pass the same contract schema as a save. The user changes what they want and saves, and the saved classification records `source: "ai_assisted"`. The class still comes from the rules;
- **steps for one obligation** (`POST /api/v1/ai-act/systems/{id}/obligations/{key}/guidance`): 3 to 6 practical steps and an optional evidence hint. The user can append them to the note, which is stored only when they save.

Both purposes send **the AI system's profile fields only**: name, description, intended purpose, role, supplier, model and whether it uses a general-purpose AI model, with the text wrapped as untrusted. Guidance adds the obligation's key, its article and the stored class. No person names, emails, owner or department names, linked risk titles or notes are sent (`packages/ai/src/purposes/ai-act-classification.ts` and `ai-act-guidance.ts`; `packages/ai/test/ai-act.test.ts` asserts what the prompts contain and omit).

## 4. Limitations

- **Not legal advice.** The questionnaire, the rules and the catalogue are a structured reading of the Regulation that helps an organisation reason about it. They do not replace a legal assessment, and the organisation remains responsible for its own classification.
- **General-purpose AI model provider duties are out of scope.** Art. 53–55 fall on the providers of general-purpose AI models, not on the organisations that build on them. `usesGeneralPurposeModel` is recorded for context only.
- **No application dates.** The product shows no date by which an obligation applies. The European Commission's Digital Omnibus proposal may move the dates for the high-risk duties, so dates are left out until that is settled.
- **Later work:** a structured, versioned fundamental rights impact assessment, AI incident records with Art. 73 deadlines, AI literacy training records per person, a register export and an AI section in the board report (spec, "Out of scope").
