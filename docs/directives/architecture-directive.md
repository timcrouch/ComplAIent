# TECHNICAL ARCHITECTURE DIRECTIVE
## AI-Native ISMS — Mandatory Technology Stack and Engineering Standards

### 1. Objective

Design and build a production-grade, enterprise-quality Information Security Management System (ISMS) using a modern, industry-standard technology stack that prioritizes:

1. **Maintainability:** Clean architecture, modularity, readable code, and long-term ease of modification.
2. **Security:** Enterprise-grade authentication, authorization, encryption, auditability, and secure development practices.
3. **Flexibility:** Ability to add regulatory frameworks, ISMS modules, AI capabilities, and integrations without substantial architectural changes.
4. **Performance:** Responsive interfaces, efficient backend operations, and reliable background processing.
5. **Exceptional UX/UI:** A visually impressive, highly intuitive interface usable by non-technical individuals.
6. **Operational simplicity:** Straightforward deployment, monitoring, troubleshooting, backup, recovery, and upgrades.
7. **AI-assisted development:** A consistent, strongly typed architecture that multiple AI development agents can work on safely and efficiently.

This is a **single-entity application**, not a multitenant SaaS platform. It must support multiple departments, business locations, jurisdictions, roles, and users within one organization.

The application must be designed for long-term production use, not merely rapid MVP delivery.

---

### 2. Mandatory Technology Stack

Use the following technology stack unless a documented architectural decision demonstrates a compelling reason for an exception.

| Layer | Technology |
|---|---|
| Primary language | TypeScript, strict mode |
| Frontend | React + Next.js (App Router) |
| Styling | Tailwind CSS |
| UI components | shadcn/ui + Base UI |
| Animation | Motion for React |
| Backend | NestJS on Node.js LTS |
| API | REST with OpenAPI specification |
| Runtime validation | Zod, with an explicit contract-validation strategy |
| Database | PostgreSQL |
| ORM / migrations | Prisma |
| Background processing | BullMQ + Redis |
| Document / evidence storage | S3-compatible object storage |
| Authentication | Enterprise OIDC/SAML through Keycloak or an existing IdP |
| Authorization | Server-enforced RBAC plus resource and contextual policies |
| Search | PostgreSQL full-text search |
| Semantic retrieval | PostgreSQL + pgvector |
| AI orchestration | TypeScript with provider abstraction |
| Specialized AI processing | Python services only when justified |
| Unit testing | Vitest or Jest, standardized per package |
| End-to-end testing | Playwright |
| API testing | Automated integration and contract tests |
| Observability | OpenTelemetry |
| Metrics / dashboards | Prometheus + Grafana or managed equivalents |
| Containerization | Docker |
| Infrastructure as code | Terraform |
| CI/CD | GitHub Actions |
| Repository management | pnpm workspaces / monorepo |

Use current stable, officially supported versions of these technologies, selecting versions based on compatibility and long-term support. Pin dependencies and maintain reproducible builds.

Avoid experimental packages in core production functionality.

### 3. Architectural Pattern: Modular Monolith

**The backend must initially be designed as a modular monolith, not a microservices architecture.**

Use one primary NestJS application, divided into independently maintainable business modules.

Required initial modules:

- Organization and Governance
- Regulatory Intelligence and Applicability
- Security Controls
- Risk Management
- Asset Management
- Policy and Document Management
- Evidence and Continuous Assurance
- Compliance Management
- Internal Audits
- Incident Management
- Third-Party Risk
- Tasks, Approvals, and Notifications
- AI Intelligence Gateway
- Integrations
- Identity and Authorization
- Reporting and Analytics

Each module must have:

- Clearly defined responsibilities
- Independent business logic
- Explicit interfaces
- Validated API boundaries
- Strongly typed domain objects
- Appropriate unit and integration tests
- Minimal coupling to other modules

Do not introduce circular dependencies.

Use domain-oriented organization rather than large, generic directories containing unrelated services and controllers.

Modules must not directly manipulate another module's internal data structures or bypass its business rules.

When cross-module interactions are required, use explicit application services, interfaces, or transactional domain events.

Background workers may run as separate processes while sharing the same application codebase and domain contracts.

Design modules so that individual capabilities can be extracted into separate services in the future if justified by operational requirements.

Do not prematurely introduce distributed systems complexity.

### 4. Repository Structure

Use a single pnpm monorepo with a structure similar to:

```text
isms/
├── apps/
│   ├── web/               # Next.js frontend
│   ├── api/               # NestJS backend
│   └── worker/            # Background job processing
│
├── packages/
│   ├── ui/                # Shared design system
│   ├── contracts/         # API contracts and schemas
│   ├── database/          # Prisma schema and migrations
│   ├── domain/            # Shared domain primitives
│   ├── config/            # Shared configuration
│   └── tooling/           # ESLint, TypeScript, testing
│
├── infrastructure/
│   ├── docker/
│   └── terraform/
│
├── docs/
│   ├── architecture/
│   ├── decisions/
│   ├── api/
│   ├── security/
│   └── operations/
│
└── .github/
    └── workflows/
```

Shared packages must contain genuinely reusable code, not become dumping grounds for unrelated business logic.

Maintain clear dependency direction and package ownership.

Use automated linting and architecture checks to enforce these boundaries.

### 5. Frontend Engineering Standards

Use Next.js, React, TypeScript, Tailwind CSS, and a bespoke design system built on shadcn/ui and Base UI.

The interface must be premium, visually distinctive, intuitive, and accessible to non-technical users.

Take inspiration from the design craftsmanship of the best modern software products without copying their interfaces.

Requirements:

- Beautiful light and dark themes
- Consistent design tokens and typography
- Responsive desktop, tablet, and mobile layouts
- WCAG 2.2 AA accessibility target
- Guided workflows and progressive disclosure
- Context-sensitive explanations
- Exceptional loading, empty, success, and error states
- Smooth, purposeful microinteractions
- Keyboard navigation and command palette
- Intelligent contextual search
- Clear and actionable dashboards
- Interactive risk and compliance visualizations
- Reusable, tested UI components

Use Motion for React selectively for meaningful transitions and interactions.

Do not introduce animations that compromise performance or accessibility.

Keep frontend components focused on presentation and interaction.

**All authoritative business rules, permission checks, regulatory determinations, and risk calculations must be enforced by the backend.**

Do not duplicate critical business logic in the frontend.

Use server components where appropriate, client components for genuine interactivity, and a disciplined data-fetching strategy.

Avoid unnecessary global state management libraries.

### 6. Backend Engineering Standards

Use NestJS with strict TypeScript configuration.

Apply:

- Dependency injection
- Modular domain boundaries
- Explicit application services
- Consistent exception handling
- Structured logging
- Runtime input validation
- Centralized security middleware and guards
- API versioning
- OpenAPI documentation
- Consistent response and error contracts

Define a clear strategy for translating Zod schemas into validated API contracts and OpenAPI documentation.

Do not maintain conflicting validation schemas in multiple layers.

Use idempotent operations where appropriate, particularly for external integrations, evidence collection, and job processing.

Long-running tasks must execute outside synchronous HTTP request handling.

Apply reasonable rate limits, request size restrictions, timeouts, and resource controls.

### 7. Database and Persistence

Use PostgreSQL as the authoritative system of record.

Use Prisma for type-safe persistence and database migrations, with explicit SQL where advanced PostgreSQL capabilities require it.

The database must support:

- Strong referential integrity
- Transactions
- Domain-specific constraints
- Appropriate indexing
- Versioned regulatory requirements
- Historical compliance snapshots
- Point-in-time auditability
- Evidence and control relationships
- Structured and semi-structured data
- Full-text search
- Semantic search using pgvector

Keep the core domain relational.

Do not introduce a separate graph database unless PostgreSQL becomes demonstrably insufficient for required relationship queries.

Do not use JSON fields as a substitute for well-designed relational schemas.

Use JSONB selectively for flexible, well-bounded metadata.

Every schema change must be implemented through a reviewed, version-controlled migration.

Do not make destructive production migrations without a documented rollout and recovery strategy.

### 8. Identity, Access Control, and Security

Use an established identity provider supporting OIDC and enterprise SSO.

Keycloak is the preferred self-hosted option. Existing enterprise identity providers such as Microsoft Entra ID must also be supported through standard protocols.

Do not build custom password authentication.

Requirements:

- MFA support
- Enterprise SSO
- Secure session handling
- Role-based access control
- Resource-level authorization
- Separation of duties
- Privileged action approval
- Secure credential and token management
- Strong audit logging
- Least-privilege service identities
- Secrets management
- Encryption in transit and at rest

Enforce authorization on the server for every sensitive operation, including object-level access.

Avoid relying solely on broad roles. Include ownership, scope, classification, and workflow state where relevant.

Prevent users from approving their own restricted changes when separation of duties is required.

Design for OWASP ASVS Level 2 as the baseline verification target, with stronger controls for particularly sensitive functionality.

### 9. AI Architecture

Implement AI through a dedicated, provider-agnostic intelligence module.

Do not tightly couple business modules to a particular LLM provider, model, or SDK.

AI functionality must support:

- Model provider configuration
- Retrieval-augmented generation
- Source-grounded regulatory analysis
- Document understanding
- Semantic search
- Policy drafting assistance
- Risk and control recommendations
- Natural-language ISMS queries
- Explainable conclusions
- Human approval workflows

Use TypeScript for primary AI orchestration.

Introduce Python only where specialized libraries, document-processing capabilities, or ML workloads justify it.

AI must not directly modify approved regulatory obligations, accept risks, approve controls, or execute sensitive actions without explicit authorization and applicable human review.

Treat retrieved content as untrusted input.

Protect against prompt injection, unauthorized data disclosure, and cross-user information leakage.

Preserve source references, model identifiers, relevant execution metadata, and appropriate audit records.

Avoid recording sensitive prompts or document contents in unrestricted operational logs.

### 10. Background Processing and Integrations

Use BullMQ with Redis for asynchronous and scheduled jobs.

Typical workloads include:

- Evidence collection
- Scheduled compliance reviews
- Control testing
- Regulatory update processing
- AI document analysis
- Notifications
- Report generation
- Supplier reassessments
- Risk review reminders

Ensure retry policies, idempotency, failure monitoring, dead-letter handling, and operational visibility.

Use S3-compatible object storage for documents, policies, evidence files, and generated reports.

Support evidence integrity verification, encryption, retention rules, and controlled access.

External integrations must use dedicated adapters with clearly defined interfaces.

Initial integrations should prioritize actual ISMS value, such as Microsoft Entra ID, Microsoft 365, Azure, AWS, GitHub, and common security platforms.

Favor read-only integrations for security evidence collection.

### 11. Rust Usage Policy

**Rust is not required for the main application.**

Do not introduce Rust merely for perceived performance or security advantages.

The primary application must remain TypeScript-first.

Rust may be introduced for isolated components where it has a clear technical benefit, such as:

- Native endpoint evidence collection agents
- Low-level security inspection tools
- High-volume parsing of untrusted data
- Resource-constrained background agents
- Specialized cryptographic or performance-critical processing

Any Rust component must have a clearly documented justification, defined API boundary, testing strategy, and operational ownership.

Avoid creating a polyglot architecture without measurable benefits.

### 12. Deployment and Operations

The application must be containerized using Docker.

Maintain separate configurations for development, testing, staging, and production.

Use Terraform for reproducible infrastructure.

Prefer managed infrastructure services wherever practical, including:

- Managed PostgreSQL
- Managed Redis
- Managed object storage
- Managed container hosting
- Managed secrets and key storage
- Centralized logs, metrics, and traces

Support private-cloud or on-premises deployment as a future deployment option without hardcoding dependencies on a single cloud provider.

Do not introduce Kubernetes unless deployment scale or operational requirements justify it.

Implement:

- Automated deployment pipelines
- Health and readiness checks
- Database backup and restoration
- Disaster recovery procedures
- Centralized monitoring
- Structured logs
- Distributed tracing
- Security vulnerability scanning
- Dependency updates
- Deployment rollback procedures

Use OpenTelemetry as the primary observability instrumentation standard.

### 13. Testing and Code Quality

Enforce automated quality gates through GitHub Actions.

At minimum, require:

- TypeScript type checking
- ESLint and formatting checks
- Unit tests
- Database integration tests
- API contract tests
- Critical end-to-end tests using Playwright
- Dependency vulnerability scanning
- Container image scanning
- Secrets scanning
- Migration validation
- Build verification

Use realistic test fixtures.

Never expose production secrets or real sensitive evidence in test environments.

Security-critical business workflows must have stronger test coverage than purely presentational functionality.

Required end-to-end coverage includes:

- User login and authorization
- Organizational configuration
- Regulatory applicability assessment
- Control creation and mapping
- Risk assessment and approval
- Evidence upload and verification
- Audit preparation
- Corrective action tracking
- AI recommendation review
- Restricted approval workflows

### 14. Engineering Rules for AI Development Agents

All AI development agents must use the agreed architecture consistently.

Do not independently introduce:

- Alternative backend frameworks
- Additional ORMs
- Unapproved state management libraries
- Separate databases
- Duplicate authorization systems
- Incompatible UI component frameworks
- Unnecessary microservices
- Redundant business logic
- New programming languages without justification

Before implementing a feature:

1. Identify its owning domain module.
2. Review existing interfaces and shared contracts.
3. Identify required database and API changes.
4. Reuse existing components and established patterns.
5. Document material architectural decisions.
6. Implement tests alongside the feature.
7. Verify compatibility with other modules.

Maintain architecture decision records (ADRs) for significant technology or design changes.

Prefer straightforward, readable implementations over clever abstractions.

Do not overengineer for speculative future requirements.

### 15. Required Initial Architecture Deliverables

Before major feature development, establish:

1. Monorepo structure and package boundaries.
2. Working Next.js frontend.
3. Working NestJS backend.
4. PostgreSQL configuration and initial migrations.
5. Authentication and authorization foundation.
6. Shared API contracts.
7. UI component library and design tokens.
8. Background worker infrastructure.
9. Centralized configuration and logging.
10. Local Docker development environment.
11. CI/CD and automated testing.
12. Initial domain model.
13. Security architecture documentation.
14. Architecture decision records.

Then implement one fully functioning vertical slice demonstrating:

**A user identifies a security risk → the system creates a risk assessment → relevant controls are linked → evidence is associated → an authorized person reviews the assessment → the dashboard reflects the resulting state.**

This must operate through the actual frontend, backend, database, and authorization system.

Do not build a large collection of disconnected UI screens before this vertical slice works.

### 16. Final Engineering Standard

The goal is not to use the maximum number of technologies.

The goal is to build an application that remains secure, flexible, understandable, and maintainable for many years.

Prioritize:

**Consistency over novelty.**

**Modularity over unnecessary distribution.**

**Security over convenience.**

**Readable code over clever abstractions.**

**Verified functionality over visual mockups.**

**Excellent usability over feature density.**

**Operational simplicity over infrastructure complexity.**

The final product must feel like an exceptional modern enterprise application while maintaining the architectural discipline expected of security-critical software.

Build a platform that a future engineering team can understand, extend, secure, and maintain without requiring its original developers.

**This technology stack and these engineering standards are mandatory defaults for the ISMS project. Any material deviation requires a documented justification and architectural review.**
