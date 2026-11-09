# Local development

## Prerequisites

- Docker Desktop (Compose v2 or later), with roughly 4 GB of RAM free. Keycloak is the heaviest service; its JVM heap is capped at 640 MB.
- [nvm](https://github.com/nvm-sh/nvm) with Node 26: `nvm install 26 && nvm use 26` (the repo pins it in `.nvmrc`).
- pnpm through corepack: `corepack enable` (the version is pinned by `packageManager`).

## Steps

```sh
nvm use 26
pnpm install
cp .env.example .env     # dev-only placeholders; .env is gitignored, never commit it
pnpm infra:up            # compose up -d, wait for every service, seed the dev users
pnpm db:migrate          # apply the database migrations (as isms_owner)
pnpm db:seed             # load the control library: frameworks, requirements, controls (safe to re-run)
pnpm dev                 # API on 4000, web app on 3000, worker
```

Or in one go after `cp .env.example .env`: `pnpm run setup && pnpm dev`. (`pnpm run setup` runs `infra:up`, `db:migrate` and then `db:seed`. Type `run`: a bare `pnpm setup` is pnpm's own built-in command, which sets up pnpm itself.)

Then open <http://localhost:3000> and sign in as `admin@example.test` with `DEV_USER_PASSWORD` from `.env`. Because `.env` sets `BOOTSTRAP_ADMIN_EMAIL=admin@example.test`, the first sign-in makes Anna organisation administrator (ADR-0004). Unset `BOOTSTRAP_ADMIN_EMAIL` once an administrator exists. The other dev users below sign in with only the baseline permissions until roles are assigned.

`pnpm infra:up` exits 0 and prints `ok` for postgres, redis, minio, keycloak and prometheus once everything is usable. It fails after 120 s and names the service that never became ready.

The API's readiness check (`GET /api/v1/ready`) includes the evidence object store (MinIO locally) as well as Postgres and Redis, so with MinIO stopped or its bucket missing the API reports `503` and is out of rotation until storage is back.

| Command            | Effect                                                                    |
| ------------------ | ------------------------------------------------------------------------- |
| `pnpm run setup`   | `infra:up`, then `db:migrate`, then `db:seed`                             |
| `pnpm db:migrate`  | Apply pending migrations to `isms` (safe to repeat)                       |
| `pnpm db:seed`     | Sync the shipped control library into `isms` (safe to re-run)             |
| `pnpm infra:up`    | Start the stack, wait for it, seed users (safe to repeat)                 |
| `pnpm infra:down`  | Stop the stack and keep the data                                          |
| `pnpm infra:reset` | Stop, delete all volumes, start fresh (recreates databases, realm, users) |

Postgres and Keycloak both use named volumes. Keeping the Keycloak volume matters because the
application identifies a person by the OIDC issuer and subject, not by email; an ordinary
container recreation therefore preserves the dev users' identities and their role assignments.
`pnpm infra:reset` deliberately deletes both volumes and starts both sides fresh together.

If a host port is already in use (for example another Postgres on 5432), override `POSTGRES_PORT`, `MINIO_PORT`, `MINIO_CONSOLE_PORT` or `KEYCLOAK_PORT` in `.env` and update `DATABASE_URL` / `OIDC_ISSUER_URL` to match. The check and seed scripts read those values. If port 4000 is taken, set `API_PORT` and `API_BASE_URL` together (for example `4010` and `http://localhost:4010`), in `.env` or on the command line: `API_PORT=4010 API_BASE_URL=http://localhost:4010 pnpm dev`.

The database role passwords in `.env` are applied by `infrastructure/docker/postgres/init.sql` on the **first** start of the Postgres volume only. Changing them later has no effect on the existing roles; run `pnpm infra:reset` (deletes all local data) to apply new values.

## AI, evidence storage and embeddings

These variables are in `.env.example`; each service reads only the ones it needs, and the e2e config passes its own values on the command line.

| Variable                                   | Used by     | Default / local value                | Notes                                                                                                                                                                                                                                              |
| ------------------------------------------ | ----------- | ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AI_PROVIDER`                              | API, worker | `openrouter`                         | `mock` answers from fixtures without any network call; for tests and e2e only, and refused when `NODE_ENV=production`.                                                                                                                             |
| `AI_SECRETS_KEY`                           | API, worker | unset                                | Base64 of exactly 32 bytes (`openssl rand -base64 32`). Seals the OpenRouter key stored from Settings → AI assistant (AES-256-GCM). Unset, a key cannot be saved or opened and AI stays unavailable.                                               |
| `AI_ALLOW_NON_EU_ROUTING`                  | API, worker | `false`                              | Development only, refused when `NODE_ENV=production`. `true` lets AI run with EU-only routing off (zero retention stays required), for an OpenRouter account without a Business plan; the settings page then warns that requests may leave the EU. |
| `S3_ENDPOINT`                              | API         | `http://localhost:9000`              | The local MinIO. Its port is `MINIO_PORT`: if you change `MINIO_PORT`, change the port in `S3_ENDPOINT` to the same value.                                                                                                                         |
| `S3_REGION`, `S3_BUCKET`                   | API         | `eu-central-1`, `isms-evidence`      | Compose creates the bucket.                                                                                                                                                                                                                        |
| `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | API         | the MinIO root user and password     | Dev placeholders locally; a bucket-scoped credential in production.                                                                                                                                                                                |
| `S3_FORCE_PATH_STYLE`                      | API         | `true` locally (default `false`)     | MinIO needs path-style addressing.                                                                                                                                                                                                                 |
| `EVIDENCE_MAX_BYTES`                       | API, web    | `26214400` (25 MiB; at most 100 MiB) | Larger uploads get 413 from the API; the web applies the same limit.                                                                                                                                                                               |
| `EMBEDDINGS_CACHE_DIR`                     | worker      | `.cache/models`                      | Where the worker downloads the embedding model on its first start (relative to its working directory). The worker image sets its own path with the model baked in.                                                                                 |

With `AI_PROVIDER=openrouter` and `AI_SECRETS_KEY` set, an administrator turns AI on in Settings → AI assistant (key, both privacy switches, a model per purpose, the master switch). Everything works with AI off: reporting uses the form, controls are added from the library and frameworks are chosen by hand.

## Dev users

All users are in the Keycloak realm `isms` and share the password in `DEV_USER_PASSWORD` (`.env`). All but `noemail@example.test` have verified emails.

| User                                        | Name          |
| ------------------------------------------- | ------------- |
| `admin@example.test`                        | Anna Admin    |
| `ciso@example.test`                         | Carl Ciso     |
| `owner@example.test`                        | Olga Owner    |
| `approver@example.test`                     | Adam Approver |
| `reporter@example.test`                     | Rita Reporter |
| `auditor@example.test`                      | Arno Auditor  |
| `noemail@example.test` (username; no email) | Nora Noemail  |

`noemail@example.test` exists for the e2e test of the "account can't be used here" screen: Keycloak signs her in, but the API rejects a token without an email claim. To let her reach the app, the seed script makes `email` optional in the dev realm's user profile.

## Services and ports

| Service        | Port | Notes                                                                                                           |
| -------------- | ---- | --------------------------------------------------------------------------------------------------------------- |
| Postgres 17    | 5432 | pgvector; databases `isms`, `isms_test`; roles `isms_owner` (migrations), `isms_app` (runtime)                  |
| Redis 7        | 6379 |                                                                                                                 |
| MinIO API      | 9000 | bucket `isms-evidence`                                                                                          |
| MinIO console  | 9001 | root credentials from `.env`                                                                                    |
| Keycloak       | 8080 | realm `isms`, client `isms-web`; admin credentials from `.env`                                                  |
| OTel collector | 4318 | OTLP/HTTP                                                                                                       |
| Prometheus     | 9090 | scrapes the collector and, once running, the API (9464) and worker metrics (9466; worker `/healthz` is on 9465) |
| Grafana        | 3001 | Prometheus datasource provisioned; admin credentials from `.env`                                                |

The dev placeholder credentials are only safe because every published port is bound to `127.0.0.1`; never change the bindings to expose the stack on other interfaces.

## Testing from other devices (phone, tablet)

The app accepts plain http only on localhost, so other devices reach the dev stack over [Tailscale](https://tailscale.com) HTTPS instead, private to your tailnet. Install Tailscale on the Mac and on the device, signed in to the same account (MagicDNS and HTTPS certificates enabled for the tailnet). With the stack running:

```bash
bash scripts/dev-tailnet.sh on     # prints the pnpm dev command to (re)start the app with
```

The script runs `tailscale serve`, which proxies `https://<mac>.<tailnet>.ts.net` to the web app on 3000 and port 8443 to Keycloak. The ports stay bound to `127.0.0.1`. It then sets the `isms` realm's Frontend URL so that Keycloak issues its URLs and tokens for that address, and allows the address as a redirect URI of `isms-web`. Keycloak is not restarted. Users are keyed on (issuer, subject), so the script also moves existing users' `idpIssuer` to the new issuer. Start the app with the printed `WEB_BASE_URL`, `OIDC_ISSUER_URL` and `DEV_ALLOWED_ORIGINS`: shell variables override `.env`. `DEV_ALLOWED_ORIGINS` is read only by `next dev` (`allowedDevOrigins`): without it, Next.js blocks its dev resources for the other host and pages never become interactive. While tailnet access is on, `http://localhost:3000` also signs in through the tailnet address.

```bash
bash scripts/dev-tailnet.sh off    # back to localhost only; restart pnpm dev without the variables
```

`pnpm infra:reset`, or anything else that recreates the Keycloak container, re-imports the realm without the Frontend URL. Run `on` again afterwards.

## Demo mode (sample data and reset)

Demo mode adds "Demo and training" at the bottom of every Setup step, for local development and for hosted demo or training instances (spec §5). It has two actions, each confirmed by typing the organisation name (or `RESET` when no organisation is set up yet):

- **Load sample data** replaces everything with a year of activity for "Isarwerk Finanz AG (sample)": about 120 risks, 16 people, evidence files, control tests, Statement of Applicability decisions and board narratives. It always resets first, so sample data never mixes with real data. No AI interactions or AI settings are generated.
- **Reset everything** returns the instance to a fresh install: every table is emptied except the migrations, and the control library is synced again.

Both sign everyone out, the administrator who pressed the button included. Whoever pressed the button keeps administrator after loading. After a reset, the next sign-in with `BOOTSTRAP_ADMIN_EMAIL` becomes administrator again, as on a new install.

| Setting                 | Default | Notes                                                                                                                                                                                            |
| ----------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `DEMO_TOOLS_ENABLED`    | `false` | `true` turns demo mode on. With `false` the demo routes do not exist (404), Setup shows nothing about them, and the API never reads `DATABASE_OWNER_URL`.                                        |
| `BOOTSTRAP_ADMIN_EMAIL` | unset   | **Required** when demo mode is on, so a reset can never leave the instance without an administrator. The API refuses to start without it.                                                        |
| `DATABASE_OWNER_URL`    | unset   | **Required** when demo mode is on. This is the owner role, the only role allowed past the audit trail's append-only rule. Only the demo module receives it. The API refuses to start without it. |

**Every demo instance is its own deployment: own database, bucket and Redis.** Never point a demo instance at a real instance's database, evidence bucket or Redis. A reset truncates the whole database. It deletes every object under `evidence/` in the bucket and every `sess:*` key in Redis, which signs out everyone who uses that Redis. It also drains the waiting and delayed jobs of every queue. Demo mode is a deploy-time choice and is allowed in production builds, because a hosted demo runs one. The guard is the explicit setting plus the separate deployment.

**Sign-in accounts on a hosted demo.** The sample roles belong to six `@example.test` accounts. Locally, `pnpm infra:up` seeds them in Keycloak (see [Dev users](#dev-users)). A hosted demo's operator creates the same six accounts, with verified emails, in that instance's sign-in service:

| Email                   | Name          | Sample role                  |
| ----------------------- | ------------- | ---------------------------- |
| `admin@example.test`    | Anna Admin    | Administrator                |
| `ciso@example.test`     | Carl Ciso     | Security lead (CISO)         |
| `owner@example.test`    | Olga Owner    | Risk owner, scoped to Munich |
| `approver@example.test` | Adam Approver | Risk approver                |
| `reporter@example.test` | Rita Reporter | Contributor                  |
| `auditor@example.test`  | Arno Auditor  | Auditor                      |

The sample's user rows are placeholders until each person signs in. In demo mode, a verified sign-in with an `@example.test` address (or the `BOOTSTRAP_ADMIN_EMAIL` address) takes over the matching placeholder. Other addresses never do.

**From the command line** (local use; both refuse unless `DEMO_TOOLS_ENABLED=true`):

```sh
DEMO_TOOLS_ENABLED=true pnpm demo:load    # reset, then load the sample year
DEMO_TOOLS_ENABLED=true pnpm demo:reset   # reset everything
```

Both ask `[y/N]` before they change anything. `--yes` (`-y`) skips the question, and a run that is not in a terminal (a script, CI) refuses without it. With `NODE_ENV=production` both refuse unless `--allow-production` is given (they still ask). Any other option is refused.

They read the root `.env`. They act on the database in `DATABASE_OWNER_URL` (the dev database `isms` with the `.env.example` values), the bucket in `S3_BUCKET` and the Redis in `REDIS_URL`, and print the database name first. Queued jobs are drained, so jobs waiting in a running `pnpm dev` worker's queues are dropped. After a load, sign in as any of the six accounts with `DEV_USER_PASSWORD`. To get the buttons in the app instead, set `DEMO_TOOLS_ENABLED=true` in `.env` and restart `pnpm dev`.

## Background jobs (`@isms/jobs`)

- Job ids are `name__idempotencyKey` (BullMQ forbids `:`). Keys must be non-empty and contain no `:`.
- Idempotency window: an id stays reserved while its job exists. Completed jobs are kept (last 1000) and failed jobs are never removed, so enqueueing the same key again is a silent no-op until the old job is removed. To re-run on purpose, use a new key or remove the old job.
- A job whose final attempt fails (or that throws `UnrecoverableError`, or whose payload breaks its contract) is copied to the `dead-letter` queue with `{ originalQueue, jobId, failedReason (max 1000 chars), payload }`, under id `<jobId>__<failure time>`: a duplicate `failed` event for the same failure adds nothing, but a re-run job that fails again gets a new entry. The `isms_jobs{queue="dead-letter"}` gauge shows its depth.
- Jobs added to BullMQ directly without `attempts` get one attempt (BullMQ default).
- `@isms/jobs` pins ioredis 5 because bullmq 5 ships it; `apps/api` uses ioredis 6 separately.

## End-to-end tests (Playwright)

```sh
pnpm infra:up
pnpm db:migrate:test                           # after new migrations
pnpm exec playwright install chromium webkit   # once
pnpm e2e
```

- **e2e uses `isms_test`, never the dev database (P2-R6).** The API it starts gets `DATABASE_URL` set to `DATABASE_TEST_URL`. The `setup` project empties `isms_test` and loads the shipped control library before anyone signs in, so each run starts from a fresh installation. Your dev data is untouched.
- **Stop `pnpm dev` first.** Playwright reuses servers that are already running, and a dev API uses the dev database. After the admin signs in, the setup project checks that the user exists in `isms_test`, and fails with "The API is not using isms_test — stop `pnpm dev` and re-run `pnpm e2e`" otherwise.

- `pnpm e2e` (`playwright test -c e2e/playwright.config.ts`) starts the API (on `E2E_API_PORT`, else `API_PORT`, default 4000), a second API with demo mode off (on `E2E_DEMO_OFF_API_PORT`, default 4001; metrics on 9477), the worker (health on 9475) and the web app on 3000 itself, or reuses them when they are already running. It passes `API_PORT`, `API_BASE_URL`, `OIDC_ISSUER_URL` (from `KEYCLOAK_PORT`, default 8080), `WEB_BASE_URL`, `METRICS_PORT=9474`, `BOOTSTRAP_ADMIN_EMAIL=admin@example.test` and `DATABASE_URL` (the test database) on the command line, so they override `.env`. The main API also gets `DEMO_TOOLS_ENABLED=true` and `DATABASE_OWNER_URL` set to `DATABASE_OWNER_TEST_URL`. `e2e/playwright.config.ts` refuses to start when that URL is not a `*_test` database. The API itself has no such check: in demo mode it uses whatever owner URL it is given. The second API gets `DEMO_TOOLS_ENABLED=false`. Keycloak accepts only the one web origin (localhost:3000), so the one web app talks to the demo-on API, and the demo-off API exists for the check that the demo routes are 404 without demo mode. Evidence goes to its own bucket, `isms-evidence-test`, which the `setup` project creates: the demo spec's reset empties it, and the dev bucket `isms-evidence` is never touched. Every e2e server (both APIs, the worker and the web app's session store) and every e2e helper uses Redis database `1` (`E2E_REDIS_DB` to change it) on the host and port of `REDIS_URL`, never the dev database `0`. The root `.env` is loaded for `DEV_USER_PASSWORD`, `REDIS_URL` and the test database URLs.
- Projects run serially: `setup` resets `isms_test`, then signs in Anna (admin), Rita (reporter) and Carl (ciso) and stores their sessions in `e2e/.auth/` (gitignored); `chromium` runs `shell.spec.ts`; then `org-setup`, `library`, `ai-settings`, `report`, `review`, `approval`, `workspace` and `ai-disabled` each run the spec of the same name; `chromium-login` and then `webkit` run `login.spec.ts`; `demo` runs `demo.spec.ts` last of all. It loads the sample year from Setup, explores it as Carl and Olga, and resets everything. That wipes `isms_test`, the e2e bucket, and every session and job queue in e2e's Redis database `1`, so the next run's `setup` project starts from a fresh database again. The e2e API and worker run `AI_PROVIDER=mock` with a test-only `AI_SECRETS_KEY` and the local MinIO, so no AI request leaves the machine. Docs: `docs/security/architecture.md` section 13 maps each required end-to-end test (foundation design §8.5) to its spec. The login spec deletes every `sess:*` key in e2e's Redis database (the expired-session case). Your dev sessions and dev job queues, in database `0`, are untouched.
- The web `dev` script loads the root `.env` through `apps/web/scripts/next-with-root-env.mjs`: `node --env-file` cannot be used with `next dev`, which passes Node flags to its server process via `NODE_OPTIONS`, where Node rejects `--env-file`.
