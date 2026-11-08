import { createHash } from "node:crypto";
import { databaseTestConfig, loadConfig } from "@isms/config";
import { assertTestDatabaseUrl } from "@isms/database/testing";
import { defineConfig, devices } from "@playwright/test";
import {
  ADMIN_EMAIL,
  API_PORT,
  API_URL,
  DEMO_OFF_API_PORT,
  DEMO_OFF_API_URL,
  E2E_S3_BUCKET,
  OIDC_ISSUER_URL,
  REDIS_URL,
  REPORTER_STATE,
  S3_ENDPOINT,
  WEB_URL,
} from "./env";

const repoRoot = new URL("..", import.meta.url).pathname;
const ci = Boolean(process.env.CI);

/**
 * Environment for the API and web server processes. Playwright spreads `process.env` under
 * it, so every value here wins over the parent environment, and the servers' dev scripts let
 * these command-line values win over the root .env.
 *
 * NODE_OPTIONS is cleared: Playwright sets it for its own TypeScript loader, and the servers'
 * `node --watch` / `next build` / `next start` would inherit those flags.
 */
function serverProcessEnv(values: Record<string, string>): Record<string, string> {
  return { ...values, NODE_OPTIONS: "" };
}

/** Test-only AI secrets key: base64 of 32 bytes derived from a constant seed, not a real secret. */
const E2E_AI_SECRETS_KEY = createHash("sha256").update("isms-e2e-ai-secrets-key").digest("base64");

const testDatabase = loadConfig(databaseTestConfig);
// The demo spec resets and loads through this connection: it must be a *_test database.
assertTestDatabaseUrl(testDatabase.DATABASE_OWNER_TEST_URL);

const webServerEnv = serverProcessEnv({
  API_PORT,
  API_BASE_URL: API_URL,
  OIDC_ISSUER_URL,
  WEB_BASE_URL: WEB_URL,
  // Away from the default 9464, which another local process may hold.
  METRICS_PORT: "9474",
  BOOTSTRAP_ADMIN_EMAIL: ADMIN_EMAIL,
  // Every e2e user reaches the API through the one local BFF: keep them out of a shared
  // per-IP bucket (each token still has its own).
  THROTTLE_TRUSTED_IPS: "127.0.0.1,::1,::ffff:127.0.0.1",
  // P2-R6: the API runs on isms_test, which the setup project resets and seeds.
  DATABASE_URL: testDatabase.DATABASE_TEST_URL,
  // e2e's own Redis database (env.ts): sessions, rate limits and job queues stay apart from dev.
  REDIS_URL,
  AI_PROVIDER: "mock",
  // Hermetic: a local .env may opt in to non-EU routing; the AI settings spec expects it off.
  AI_ALLOW_NON_EU_ROUTING: "false",
  AI_SECRETS_KEY: E2E_AI_SECRETS_KEY,
  // Local MinIO from compose, in a bucket of its own that the setup project creates: the
  // demo spec's reset empties it, and the dev bucket must never be touched.
  S3_ENDPOINT,
  S3_REGION: "eu-central-1",
  S3_BUCKET: E2E_S3_BUCKET,
  S3_ACCESS_KEY_ID: process.env.MINIO_ROOT_USER ?? "",
  S3_SECRET_ACCESS_KEY: process.env.MINIO_ROOT_PASSWORD ?? "",
  S3_FORCE_PATH_STYLE: "true",
});

/**
 * The API the web app uses runs with demo mode on (spec §6: Plan 9's e2e tests run with demo
 * mode on), on the test database's owner connection. Keycloak only accepts the one web origin
 * (localhost:3000), so there is one web app and it talks to this API. Before the demo project,
 * nothing in the suite creates a placeholder user, so demo mode on changes nothing else they
 * see except the "Demo and training" section in Setup.
 */
const apiEnv = serverProcessEnv({
  ...webServerEnv,
  DEMO_TOOLS_ENABLED: "true",
  DATABASE_OWNER_URL: testDatabase.DATABASE_OWNER_TEST_URL,
});

/**
 * A second API with demo mode off, for the one check that the demo routes do not exist then
 * (404). Explicitly off: the root .env may turn it on. It never reads DATABASE_OWNER_URL.
 */
const demoOffApiEnv = serverProcessEnv({
  ...webServerEnv,
  API_PORT: DEMO_OFF_API_PORT,
  API_BASE_URL: DEMO_OFF_API_URL,
  METRICS_PORT: "9477",
  DEMO_TOOLS_ENABLED: "false",
});

/** The worker's liveness port in e2e, away from its default 9465 and the API's metrics port. */
const WORKER_HEALTH_PORT = "9475";

const workerEnv = serverProcessEnv({
  ...webServerEnv,
  WORKER_HEALTH_PORT,
  WORKER_METRICS_PORT: "9476",
  // The repository's model cache, so the embeddings model downloads once (on the first run).
  EMBEDDINGS_CACHE_DIR: `${repoRoot}.cache/models`,
});

/**
 * Needs the local stack (`pnpm infra:up`). Starts the API, the worker (control suggestions and
 * library embeddings) and a production build of the web app, or reuses them when already
 * running locally (a reused API must already be on isms_test; the setup project checks).
 *
 * The web app runs as `next build` + `next start`, locally and on CI, not `next dev`: the dev
 * server compiles each route on its first request and disposes a compiled route after 60 s
 * without a request (onDemandEntries), so a warm-up cannot keep routes compiled. On the CI
 * runners a recompile under load took longer than the test timeouts (a client-side navigation
 * or a server action waited > 15 s), and a compile finishing mid-navigation aborted page.goto.
 * A production build answers every route without compiling, as the deployed app does. Runs serially: login.spec
 * deletes every session in Redis, so it runs after the shell and setup tests (project
 * dependencies), and WebKit runs after it. The demo project runs last of all: it resets the
 * whole test instance (database, evidence bucket, every session, the job queues), and the next
 * run's setup project starts from a fresh database again.
 */
export default defineConfig({
  testDir: ".",
  outputDir: "../test-results/e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: ci,
  retries: ci ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: ci
    ? [["github"], ["list"], ["html", { open: "never", outputFolder: "../playwright-report" }]]
    : [["list"]],
  use: {
    baseURL: WEB_URL,
    trace: "retain-on-failure",
    // The (app) layout greets by time of day in the user's zone; keep it deterministic.
    timezoneId: "Europe/Riga",
    locale: "en-GB",
  },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts$/ },
    {
      name: "chromium",
      testMatch: /shell\.spec\.ts$/,
      dependencies: ["setup"],
      use: { ...devices["Desktop Chrome"], storageState: REPORTER_STATE },
    },
    {
      // Fresh sign-ins of its own (role changes need a recent sign-in, P2-R5).
      name: "org-setup",
      testMatch: /org-setup\.spec\.ts$/,
      dependencies: ["chromium"],
      use: { ...devices["Desktop Chrome"] },
    },
    {
      // After org-setup, which gives Carl Ciso the security lead role.
      name: "library",
      testMatch: /library\.spec\.ts$/,
      dependencies: ["org-setup"],
      use: { ...devices["Desktop Chrome"] },
    },
    {
      // After library; fresh admin sign-ins of its own (every AI settings write needs one).
      name: "ai-settings",
      testMatch: /ai-settings\.spec\.ts$/,
      dependencies: ["library"],
      use: { ...devices["Desktop Chrome"] },
    },
    {
      // After ai-settings, which leaves the AI assistant on; Rita Reporter reports concerns.
      name: "report",
      testMatch: /report\.spec\.ts$/,
      dependencies: ["ai-settings"],
      use: { ...devices["Desktop Chrome"] },
    },
    {
      // After report, which leaves Rita Reporter's concerns proposed; Carl Ciso reviews them.
      name: "review",
      testMatch: /review\.spec\.ts$/,
      dependencies: ["report"],
      use: { ...devices["Desktop Chrome"] },
    },
    {
      // After review; makes its own risks. Carl reviews, Adam Approver approves, and Rita
      // Reporter answers an evidence request from her tasks.
      name: "approval",
      testMatch: /approval\.spec\.ts$/,
      dependencies: ["review"],
      use: { ...devices["Desktop Chrome"] },
    },
    {
      // After approval, which leaves approved, returned and in-review risks; makes its own
      // risks and reads every count it checks from the API. Also asks for AI framework
      // suggestions (PF7: the AI is on by now, unlike in org-setup).
      name: "workspace",
      testMatch: /workspace\.spec\.ts$/,
      dependencies: ["approval"],
      use: { ...devices["Desktop Chrome"] },
    },
    {
      // After workspace; makes its own risk (unique title), moves it through review to approval.
      name: "insights",
      testMatch: /insights\.spec\.ts$/,
      dependencies: ["workspace"],
      use: { ...devices["Desktop Chrome"] },
    },
    {
      // After insights; makes its own approved risk (unique title) and walks it through
      // treatment actions, closing, a control test and reassessment.
      name: "loop",
      testMatch: /loop\.spec\.ts$/,
      dependencies: ["insights"],
      use: { ...devices["Desktop Chrome"] },
    },
    {
      // After loop; Carl Ciso decides a requirement and approves a board narrative (AI on).
      name: "reports",
      testMatch: /reports\.spec\.ts$/,
      dependencies: ["loop"],
      use: { ...devices["Desktop Chrome"] },
    },
    {
      // After reports (and so loop, insights, workspace, which resolved every framework suggestion). The
      // administrator switches AI off in the settings screen; every workflow is done by hand; AI is back on after.
      name: "ai-disabled",
      testMatch: /ai-disabled\.spec\.ts$/,
      dependencies: ["reports"],
      use: { ...devices["Desktop Chrome"] },
    },
    {
      // After ai-disabled, which switches the AI back on. Anna Admin turns the EU AI Act module
      // on; Carl Ciso classifies one system by hand and one with the mock AI draft; Anna turns
      // the module off again, so later projects see it off, as they always have.
      name: "ai-act",
      testMatch: /ai-act\.spec\.ts$/,
      dependencies: ["ai-disabled"],
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "chromium-login",
      testMatch: /login\.spec\.ts$/,
      dependencies: ["ai-act"],
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "webkit",
      testMatch: /login\.spec\.ts$/,
      dependencies: ["chromium-login"],
      use: { ...devices["Desktop Safari"] },
    },
    {
      // Last: loads the sample year and resets everything, sessions included (spec §5).
      name: "demo",
      testMatch: /demo\.spec\.ts$/,
      dependencies: ["webkit"],
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: [
    {
      command: "pnpm --filter @isms/api dev",
      cwd: repoRoot,
      url: `${API_URL}/api/v1/health`,
      env: apiEnv,
      reuseExistingServer: !ci,
      timeout: 120_000,
      stdout: "ignore",
      stderr: "pipe",
    },
    {
      command: "pnpm --filter @isms/api dev",
      cwd: repoRoot,
      url: `${DEMO_OFF_API_URL}/api/v1/health`,
      env: demoOffApiEnv,
      reuseExistingServer: !ci,
      timeout: 120_000,
      stdout: "ignore",
      stderr: "pipe",
    },
    {
      command: "pnpm --filter @isms/worker dev",
      cwd: repoRoot,
      url: `http://localhost:${WORKER_HEALTH_PORT}/healthz`,
      env: workerEnv,
      reuseExistingServer: !ci,
      timeout: 120_000,
      stdout: "ignore",
      stderr: "pipe",
    },
    {
      command: "pnpm --filter @isms/web build && pnpm --filter @isms/web start",
      cwd: repoRoot,
      url: `${WEB_URL}/auth/login?error=probe`,
      env: webServerEnv,
      reuseExistingServer: !ci,
      // Includes the production build (about 30 s locally, a few minutes on a CI runner).
      timeout: 600_000,
      stdout: "ignore",
      stderr: "pipe",
    },
  ],
});
