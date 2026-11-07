# ISMS Foundation and First Vertical Slice — Design

**Date:** 2026-11-03
**Owner:** Tim Crouch, Global Software AI
**Status:** Approved by owner 2026-11-03

This document describes what to build first: the platform foundation and one working path from a reported concern to an approved risk shown on the home workspace. It is written for a builder who has not seen the conversation that produced it.

Two directives from the owner are binding inputs, stored in full at `docs/directives/ux-directive.md` and `docs/directives/architecture-directive.md`, and summarised in §4 and §5. Where this document and a directive disagree, the directive wins unless this document explicitly records an exception. Section references like "directive §15" point into the architecture directive.

---

## 1. Intent

Global Software AI is building an AI-native Information Security Management System (ISMS) as its own product.

- **Generic, not bespoke.** One codebase, installable for any organisation, from a mid-sized manufacturer to a heavily regulated bank. Company specifics (sites, departments, systems, frameworks) live in data, never in code or UI copy.
- **One installation per organisation ("copy/paste").** Each company runs its own single-entity installation with its own database and storage. It is *not* multitenant SaaS. Inside one installation: many departments, sites, jurisdictions, roles and users.
- **First real user: a launch customer** (named privately). It must be able to use the product **for real from day one**, not as a demo. Nothing in the product may name or be shaped around a specific customer.
- **AI as translator in both directions.** People describe things in plain words; AI turns them into correct, structured ISMS records. CISOs then get records that are complete enough to plan, manage and act on.
- **Product standard:** *A sophisticated security system should not require a sophisticated user.*

### Why this first slice

The architecture directive requires the foundation plus one complete vertical slice before any broad feature work. The slice proves the whole chain — UI, API, database, authorisation, AI, audit trail — on the workflow that matters most for day-one use.

## 2. Goals, non-goals, anti-goals

### Goals (this phase)

1. All 14 foundation deliverables of the architecture directive (§15 there), listed in §7 below.
2. The vertical slice in §8, working end-to-end through real frontend, backend, database, auth and AI.
3. A bespoke design system in the chosen visual direction (§6), light and dark.
4. A seeded in-house control library mapped to ISO 27001:2022 Annex A, NIS2 and GDPR (§9), and NIST CSF 2.0 (added 2026-11-07, Plan 10), and NIST SP 800-53 Rev. 5, Moderate baseline (added 2026-11-07, Plan 12).
5. A first-run organisation setup that is enough to run the slice (§8.0).
6. One-command local setup and a documented one-command installation per organisation.

### Non-goals (later phases — do not build now)

- Policy/document management, internal audits, incidents, third-party risk, regulatory change intelligence, integrations (Entra, M365, AWS, GitHub), reporting/analytics beyond the home workspace.
- Compliance graph, regulation coverage explorer, risk landscape visualisation.
- Full Executive view (only the view-switching mechanism and a stub).
- Full AI onboarding wizard that builds a whole ISMS configuration (only the minimal setup in §8.0).
- DORA, BAIT/MaRisk and other framework mappings (the data model must support them; content comes later).
- Languages other than English.
- Python services, Rust components, Kubernetes.

The modules of the directive's §3 that are out of scope should exist only where the slice needs them; do not scaffold empty modules for the rest.

### Anti-goals (failure even if it "works")

- AI-generated numbers, statuses or positive statements presented as fact. Every figure on screen comes from records.
- AI saving, approving or changing anything official without a human decision.
- A reporter needing to know words like "residual risk", "treatment" or "Annex A" to finish reporting.
- Generic admin-template look: dense tables, random coloured cards, decorative gauges, composite "security scores".
- Any customer-specific wording, assets or logic in code.
- Shipping copyrighted ISO standard text.
- Colour as the only carrier of status.

## 3. Constraints

- **Single-entity application**, deployed once per organisation.
- **English only** for now. All UI strings live in message files (not inline in components) so translation is a later content task.
- **AI provider:** OpenRouter, configured for EU-hosted model endpoints and zero data retention. These settings are per-installation configuration, enforced in the AI gateway, and visible to administrators in the UI. AI can be fully disabled per installation; every workflow in the slice must still be completable without AI (manual entry).
- **No custom password authentication.** Keycloak (bundled for self-hosting) or the organisation's existing IdP (e.g. Microsoft Entra ID) via OIDC/SAML.
- **Security baseline:** OWASP ASVS Level 2.
- **Accessibility:** WCAG 2.2 AA.
- **Owner's global standards:** TypeScript strict; files under 500 lines; tests first (TDD); no secrets in code; feature branches only; never force-push `main`.
- **Repository:** GitHub repo `timcrouch/ComplAIent`.
- **Hosting target unknown (owner, 2026-11-03).** The launch customer's hosting is not decided. Everything must stay portable: plain Docker host, any EU cloud, or on-premises. Terraform modules are written so the provider can be swapped without touching application code.
- **Sign-in:** bundled Keycloak for local/dev and self-hosting, plus a **built and tested Microsoft Entra ID connection** (most likely enterprise IdP), via standard OIDC.
- **No deadline (owner).** Build the foundation fully first, then the slice. Do not cut foundation corners for an early pilot.
- **OpenRouter access:** via an API key the owner supplies through the admin AI settings screen (§11.1). EU routing and zero retention are not yet confirmed for the owner's account. Build and test the AI path against a mocked provider; the gateway refuses real calls until the privacy settings are on. Confirming the account setting is an owner action before AI is switched on for a real installation.

## 4. Technology stack (from the architecture directive — mandatory)

TypeScript strict · Next.js App Router + React · Tailwind CSS · shadcn/ui + Base UI · Motion for React · NestJS on Node LTS · REST + OpenAPI · Zod · PostgreSQL · Prisma · BullMQ + Redis · S3-compatible storage (MinIO locally) · Keycloak / external IdP via OIDC/SAML · server-enforced RBAC + resource/contextual policies · PostgreSQL full-text search · pgvector · TypeScript AI orchestration with provider abstraction · Vitest · Playwright · OpenTelemetry · Prometheus + Grafana · Docker · Terraform · GitHub Actions · pnpm monorepo.

Architecture: **modular monolith** (one NestJS API, separate worker process sharing code), domain-organised modules, no circular dependencies, cross-module calls through explicit application services or transactional domain events. Repository layout as in directive §4 (`apps/web`, `apps/api`, `apps/worker`, `packages/{ui,contracts,database,domain,config,tooling}`, `infrastructure/{docker,terraform}`, `docs/{architecture,decisions,api,security,operations}`, `.github/workflows`).

All authoritative business rules — permissions, risk scoring, approval rules, state transitions — live in the backend. The frontend never decides them.

Decisions recorded as ADRs from day one (at minimum: modular monolith, Zod→OpenAPI contract strategy, authorization model, AI gateway and data handling, control library licensing, per-organisation deployment model, audit history design).

## 5. UX principles (from the UX directive — summarised)

- Premium, distinctive, "wow within 10 seconds"; benchmarked against the best modern software products — not copied.
- Plain language first, correct terminology preserved underneath (progressive disclosure).
- Home is a living workspace answering: *How secure are we? Are we meeting obligations? What needs attention? What should I do next?* — not a chart dashboard.
- Three contextual experiences over one data model: **Guided**, **Professional**, **Executive**. View preference is independent of permissions.
- AI always shows uncertainty and distinguishes suggestions from approved decisions.
- Purposeful motion, reduced-motion respected; excellent loading, empty, error and success states.
- Keyboard navigation and ⌘K command palette; responsive desktop/tablet/mobile.
- Every complex visual has a text/table alternative.

## 6. Visual direction — "Clear Glass" (chosen by owner)

Chosen from three mockups. Characteristics:

- Cool neutral surfaces (very light blue-grey background with a faint cool-to-lilac gradient), soft layered depth: white translucent cards with subtle two-step shadows, 12px radius.
- Rounded, friendly geometric sans-serif (mockup used Plus Jakarta Sans; builder may pick an equivalent with good tabular numerals and licensing).
- Single indigo-violet accent (~`#4F3FD9`) for primary actions and AI markers; semantic colours for status (green ok, amber attention, red critical, indigo info) always paired with an icon and words.
- Most approachable, consumer-like of the options — closest to a polished consumer-app feel.
- An equally polished dark theme must be designed (not auto-inverted): deep cool slate surfaces, same accent tuned for contrast.
- Design tokens (colour, type scale, spacing, radius, shadow, motion durations/easings) defined once in `packages/ui` and consumed by Tailwind.
- Avoid: heavy gradients, glassmorphism blur everywhere, emoji in product chrome (the 👋 in the mockup is not a requirement).

The approved mockups are in `.superpowers/brainstorm/` (local only, not committed).

## 7. Foundation deliverables

From directive §15, each must work, not just exist:

1. Monorepo structure and package boundaries, enforced by lint/architecture checks (e.g. dependency-cruiser or eslint boundaries).
2. Working Next.js frontend.
3. Working NestJS backend with versioned REST API (`/api/v1`), OpenAPI generated from Zod contracts.
4. PostgreSQL with initial Prisma migrations, pgvector enabled.
5. Authentication (Keycloak OIDC, bundled realm for local/dev; external IdP by configuration) and authorization foundation (§10).
6. Shared API contracts in `packages/contracts` — single source of validation truth for API and web.
7. UI component library and design tokens (§6).
8. Background worker (BullMQ) with retries, idempotency keys, dead-letter queue.
9. Centralised configuration (validated at startup) and structured logging; OpenTelemetry traces.
10. Local Docker environment: Postgres, Redis, MinIO, Keycloak, API, worker, web, plus Prometheus/Grafana — up with one command.
11. CI on GitHub Actions: typecheck, lint, format, unit, DB integration, API contract, Playwright critical paths, dependency/container/secret scanning, migration validation, build.
12. Initial domain model (§9).
13. Security architecture documentation (`docs/security/`).
14. ADRs (`docs/decisions/`).

Production readiness for the first real installation (design call, from directive §12): health/readiness checks, automated database and object-storage backups with a **tested restore procedure**, documented disaster recovery and rollback, monitoring with basic alerting, and an OWASP ASVS Level 2 self-assessment checklist in `docs/security/`. An external penetration test is recommended before go-live but sits outside this build.

Terraform: a minimal module set for one organisation's installation on a managed EU provider. **Builder's call** which provider is the first target, provided nothing is hardcoded to it; record it as an ADR. Container images must also run on a plain Docker host (for on-premises clients).

## 8. The vertical slice

> A person reports a concern → AI helps turn it into a risk → controls are linked → evidence is attached → an authorised, different person approves → the home workspace reflects the new state.

### 8.0 Minimal first-run setup

Before the slice can run, an administrator (signed in via IdP) sets up the organisation in a short guided flow:

- Organisation name, what it does (free text), countries/sites (list), approximate headcount.
- Which frameworks apply — AI may *suggest* from the answers (e.g. "operates in the EU and handles customer photos → GDPR; ISO 27001 if you want certification; NIS2 may apply — needs checking"), each shown as a suggestion with reasoning; admin confirms.
- Risk appetite: a default 5×5 likelihood × impact scale with plain-language labels and a default appetite threshold; admin may accept defaults.
- Assign roles to users who have signed in.

Each suggestion is stored as unverified until confirmed. This is deliberately small; the full AI onboarding wizard is a later phase.

### 8.1 Report a concern (anyone, Guided view) — **conversation style** (chosen by owner)

- Entry points: "Report a concern" in the app header on every page, ⌘K palette, and a persistent shortcut.
- A chat thread. First prompt: *"What are you worried might happen?"*
- AI follows up with a small number of plain-language questions (target ≤ 6), offering tap-to-answer chips where possible (site, asset type, "is this already protected?"). "Not sure" is always a valid answer and becomes a flagged *to confirm* item — never a silent guess.
- AI questions are driven by what is missing for a complete risk record (asset, threat/scenario, consequence, existing safeguards, location/owner), so the outcome is useful to a CISO.
- The chat ends with a plain summary card — "Here's what I understood" — editable by the reporter.
- Submitting creates a risk in state **Proposed**, marked "drafted with AI assistance", with the full chat transcript linked.
- Without AI: the same questions as a simple step form.

### 8.2 Review (risk owner / CISO, Professional view)

- Review queue shows proposed risks.
- Detail view shows the technical record: title, scenario, affected assets, threat, consequence, likelihood and impact (on the configured scale) with AI's estimate and its reasoning, existing safeguards, to-confirm items, owner.
- AI suggests controls from the library with a short reason each and the mapped framework references; reviewer accepts or rejects each suggestion individually. Reviewer can also search and add controls manually.
- Treatment choice in plain words with the correct term underneath: **Fix the problem** (avoid), **Reduce the risk** (mitigate), **Transfer responsibility** (transfer), **Accept the risk with approval** (accept).
- Evidence: upload a file (stored in S3 with SHA-256 hash, uploader, timestamp) or request it from a named person (creates a task). Evidence links to the control(s) it supports.
- Inline editing of every field; changes are versioned.

### 8.3 Approval

- Reviewer submits for approval; state **In review → Approved** (or **Returned** with a comment).
- Separation of duties, enforced server-side (design call):
  - The **reporter** can never approve a risk they reported.
  - The **reviewer** (the person who submitted it for approval) can approve only risks that are within appetite and not treated by *Accept*.
  - Risks **above appetite** or treated by **Accept** need approval by a user holding the risk-approver role who is neither the reporter nor the reviewer.
  - There is **no override**. If no eligible approver exists, the system says so plainly ("No one else can approve this yet — an administrator can give the approver role to someone") and the risk waits. Banks require this strictness; small organisations resolve it by assigning one more approver.
- Approval is an explicit action with the approver's identity, timestamp and what they approved (a snapshot of the record version).

### 8.4 Home workspace reflects the state

- Greeting and a short set of plain statements derived only from records, e.g. "2 decisions need your approval", "5 risks are above your appetite", "4 evidence items are missing". Each opens the underlying records.
- Four plain dimensions as in the mockup: controls, evidence, risks, tasks — counts and simple bars, each with a text explanation. No composite score.
- The reporter sees the status of their own concerns ("your concern was reviewed").
- Empty state for a brand-new installation is designed, not blank.

### 8.5 Required end-to-end tests for this phase

Login and authorization · organisation setup · risk report via conversation (with AI mocked) and via manual form · control suggestion accept/reject · evidence upload with hash verification · separation-of-duties rejection · approval · home workspace counts update · AI disabled mode · admin AI settings (key write-only, never returned by the API).

## 9. Domain model and control library

Core relational entities (Prisma). Names are indicative; the builder owns exact modelling.

- **Organisation** (single row), **Site**, **Department**, **User** (IdP subject), **RoleAssignment** (role + optional scope: site/department).
- **Framework** (e.g. ISO 27001:2022, NIS2, GDPR) → **FrameworkVersion** → **Requirement** (reference ID, short paraphrased title, optional full text where legally allowed; ISO text never shipped).
- **Control** (in-house library: ID, plain-language title, description, guidance, category) ↔ **ControlRequirementMapping** (many-to-many, to requirement references).
- **OrganisationFramework** (which frameworks apply; status: suggested / confirmed; reasoning).
- **Asset** (minimal for slice: name, type, site, owner).
- **Risk** (title, scenario, threat, consequence, likelihood, impact, scale reference, treatment, state, owner, reporter, ai_assisted flag) → **RiskVersion** (immutable snapshots) ↔ **RiskControl** (status: suggested / accepted / rejected, reason, suggested_by) ↔ **RiskAsset**.
- **Evidence** (object key, SHA-256, size, mime, uploader, collected_at, classification) ↔ **EvidenceControl**.
- **Task** (assignee, due date, link to object) and **Approval** (object, version, approver, decision, comment, timestamp).
- **AiInteraction** (purpose, model ID, provider, routing settings, prompt/response stored with restricted access, linked object, accepted/rejected outcome).
- **AuditEvent** (append-only: actor, action, object, before/after reference, timestamp, request/trace ID). Application DB role cannot update or delete audit rows.

**Control library content:** an in-house set of plainly worded controls (initially covering what ISO 27001:2022 Annex A addresses — ~93 reference points — plus GDPR Art. 5, 24, 25, 28, 30, 32–35 and NIS2 Art. 21 measures), each mapped by reference ID only. NIST CSF 2.0 (106 subcategories, own-words titles) was added on 2026-11-07 (Plan 10), with three governance controls for the subcategories nothing else covered. NIST SP 800-53 Rev. 5 (the 177 base controls of the Moderate baseline, grouped by family, own-words titles) was added on 2026-11-07 (Plan 12), mapped to existing controls. Seeded via versioned seed files. Installations can import their own licensed ISO text into `Requirement.full_text`. The library must be authored/reviewed with care — wrong mappings are a credibility risk. **Builder's call** how to source it; document provenance in an ADR.

Mapping review (design call): each mapping carries a review status (*unreviewed / reviewed by <name, date>*). Shipped mappings start *unreviewed* and the UI shows this to Professional users. A CISO can review and confirm mappings in-app; the library can be exported as CSV for an external reviewer. Go-live does **not** wait for review, but the status is never hidden.

## 10. Authorization

- Roles (initial): **Administrator**, **CISO / Security lead**, **Risk owner**, **Risk approver**, **Contributor** (can report concerns and upload evidence when asked), **Viewer**, **Auditor** (read-only incl. audit history).
- Server-side policy checks on every operation combining role, scope (site/department), ownership, object state and separation-of-duties rules. One policy layer — no duplicate checks in the frontend beyond hiding unavailable actions.
- View mode (Guided / Professional / Executive) is a user preference, defaulted by role, and never grants access.
- Visibility (design call): reported concerns can be sensitive (named colleagues, weaknesses, personal data).
  - **Contributors** see only concerns they reported, and evidence requests assigned to them.
  - **Risk owners** see risks they own plus risks within their site/department scope.
  - **CISO, Risk approver, Auditor** see all risks in their scope (unscoped = whole organisation). **Viewer** sees approved risks in scope, not proposed ones.
  - **Chat transcripts and AI interaction content** are visible only to the reporter, CISO, Administrator and Auditor.
- Role source (design call): roles are assigned in the app. Mapping IdP groups to roles (e.g. Entra groups) is supported by configuration but optional.

## 11. AI gateway

- One NestJS module; business modules call typed functions (`draftRiskFromConversation`, `suggestControlsForRisk`, `suggestFrameworks`), never a provider SDK.
- Provider adapter for OpenRouter; configuration per installation: allowed models, EU-only provider routing, zero-data-retention flag, enabled/disabled. Refuse to call if required privacy settings are not met.
- Retrieval: control library and framework references embedded in pgvector; suggestions must cite control IDs that exist (validated server-side, unknown IDs discarded).
- Embeddings (design call): computed **inside the installation** with a small open embedding model run in the worker via a TypeScript/ONNX runtime (e.g. transformers.js). User text never leaves the installation for embedding, and no Python service is needed. Swappable later behind the same gateway interface.
- Structured outputs validated with Zod; invalid output → retry once → fall back to manual path with a clear message.
- Treat user text and retrieved content as untrusted; system prompts never include data the requesting user is not authorised to see.
- Every call recorded in `AiInteraction`; sensitive content excluded from operational logs.

### 11.1 Admin AI settings screen (owner requirement)

An **Administrator-only** screen ("Settings → AI assistant") where the OpenRouter API key is supplied to the running system. No redeploy or environment change is needed.

- **API key entry:** paste the OpenRouter key. It is write-only: after saving, the UI shows only that a key is set, its last 4 characters, who set it and when. It can be replaced or removed, never read back, by anyone.
- **Storage:** encrypted at rest in the database with authenticated encryption (AES-256-GCM). The encryption key comes from the installation's secret store or environment (`AI_SECRETS_KEY`), never from the database. The plaintext key is never written to logs, traces, API responses or audit payloads.
- **Model selection:** choose the model(s) used for each AI purpose from a list fetched from OpenRouter, filtered to models that meet the privacy settings.
- **Privacy settings:** EU-only provider routing and zero data retention, shown as on/off with a plain explanation of what each means. AI calls are refused while either required setting is off.
- **Test connection:** sends a harmless test request and reports success or a plain-language error ("The key was rejected by OpenRouter", "No EU-hosted provider available for this model").
- **Master switch:** turn AI on or off for the whole installation.
- **Audit:** every change (key set, replaced or removed, model changed, privacy or switch changed, test run) is an audit event with actor and time. The key itself is never recorded.
- Changing these settings counts as a privileged action. It requires a recent re-authentication (step-up via the IdP).
- Long calls run as jobs where they exceed request timeouts; the chat streams responses.

## 12. Left to the builder

Exact package versions (current LTS/stable, pinned), Prisma model details, component inventory, motion specifics, test fixture content, Terraform provider (with ADR), control-library authoring approach (with ADR), embedding model choice, specific OpenRouter models (must meet EU/ZDR constraints), Keycloak realm design, CI runtime optimisation.

## 13. Calls made during design (owner to check)

- English-only, but strings externalised for later translation.
- AI can be disabled per installation; all slice workflows have a manual path.
- Second-approver rule for high or accepted risks (§8.3).
- Minimal first-run setup instead of the full onboarding wizard in this phase.
- 5×5 likelihood × impact default scale with configurable appetite.
- Only modules required by the slice are scaffolded.
- Separation-of-duties rules with no override (§8.3).
- Visibility rules per role, transcripts restricted (§10).
- Roles assigned in-app; IdP group mapping optional (§10).
- Embeddings computed locally inside each installation (§11).
- Control mappings ship marked "unreviewed"; go-live does not wait for review (§9).
- Directive typos fixed when saved to `docs/directives/` ("Non-Technical Humans", "ORM / migrations"); no other changes.
