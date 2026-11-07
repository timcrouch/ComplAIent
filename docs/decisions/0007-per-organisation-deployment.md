# ADR-0007: One installation per organisation, on a portable deployment shape

Status: Accepted (2026-11-04)

## Context

The ISMS holds an organisation's risk register, evidence, incidents and audit history. Customers are regulated organisations that answer to auditors for where that data lives, who can reach it, and how it is backed up and restored. Some will run it in an EU cloud account they control. Others need it on their own premises. The first customer's hosting is not decided yet, and the product must not depend on any one provider (foundation design §3; architecture directive §12).

A multi-tenant service would mix organisations' data in one database and one blast radius, and would need tenant isolation in every query, cache key, job and log line. It would also make each customer's data-residency, retention and key-management answers depend on everyone else's.

## Decision

- **One installation per organisation.** Each organisation gets its own installation: its own API, worker and web processes, its own PostgreSQL database, Redis, object-storage bucket and identity-provider client, and its own secrets. Installations share code and images, never data or credentials. The application is single-entity: there is no tenant id in the schema and no cross-organisation code path.
- **The deployable unit is three container images** built by CI from `infrastructure/docker/Dockerfile.{api,worker,web}`:
  - `isms-api`, `isms-worker` and `isms-web`, on `node:26-alpine` (pinned to a minor tag), running as the non-root uid 10001, with production dependencies only and a `HEALTHCHECK` each (`/api/v1/health`, `:9465/healthz`, `/`).
  - The images hold no configuration and no secrets. Everything comes from environment variables at run time, validated at start-up by the Zod schemas in `@isms/config` (`.env.example` lists them).
  - Workspace packages ship TypeScript source. The image build compiles them and the apps to JavaScript with SWC (`isms-build-js` in `@isms/tooling`, transpile only, decorator metadata on). The runtime selects that output through the `isms-dist` export condition (`node --conditions=isms-dist`). Development and tests keep running the source. The web app uses the Next.js `standalone` output.
- **Backing services are standard and replaceable.** PostgreSQL 17 with pgvector, Redis 7, any S3-compatible object store, and any OpenID Connect provider that issues JWT access tokens with the claims in ADR-0004. Each is reached through a URL or endpoint in the environment, so a managed service and a self-run one look the same to the application.
- **Three supported shapes, one set of images:**
  - **Plain Docker host** (a single VM, or on-premises): the three images plus self-run backing services, for example with Docker Compose. `infrastructure/docker/compose.yaml` is the local development stack and is not a production template. Plan 4 adds a production compose example.
  - **Any EU cloud:** the images on the provider's container runtime, with managed PostgreSQL, Redis and object storage in an EU region.
  - **On-premises:** the plain Docker host shape inside the customer's network, with the customer's IdP (for example Microsoft Entra ID) through OIDC.
- **Migrations are an explicit step.** `prisma migrate deploy` runs with the owner role (`DATABASE_OWNER_URL`) before a new API version starts. The runtime services connect only as the application role (`DATABASE_URL`) and never hold owner credentials (Ruling R1).
- **Infrastructure as code comes in Plan 4.** Terraform modules for one organisation's installation are written so that the provider can be swapped without touching application code. The first provider target and the production object store are chosen there, with their own ADR. The local MinIO image (`bitnamilegacy/minio`, Ruling R8) is for development only and is not a production choice.
- **No Kubernetes for now** (architecture directive §12). Three stateless containers and their backing services do not need it. Nothing in the images prevents it later.

## Consequences

- Data isolation between organisations is physical: separate databases, buckets, Redis instances and secrets. A compromise or a restore affects one organisation.
- Each organisation is upgraded on its own. Releases must therefore stay backward compatible for one migration step, and an installation can stay on an older version until it chooses to upgrade.
- Operating cost per organisation is a small fixed set of services. That is the price of the isolation, and regulated customers expect it.
- Fleet concerns (rolling out a release to many installations, collecting version and health data) are operational tooling outside the application, planned with Plan 4.
- Dependabot keeps the base image and dependencies current. CI builds and scans the images on every change (gitleaks, `pnpm audit`, osv-scanner, Trivy) but does not publish them yet: a registry and a release workflow come with Plan 4, and must publish only images that passed these gates.
