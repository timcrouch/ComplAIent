import {
  aiConfig,
  apiConfig,
  assertNotMockInProduction,
  bootstrapConfig,
  databaseConfig,
  databaseOwnerConfig,
  demoConfig,
  loadConfig,
  oidcConfig,
  redisConfig,
  storageConfig,
  telemetryConfig,
} from "@isms/config";
import { z } from "zod";

const appConfig = z.object({
  ...databaseConfig.shape,
  ...redisConfig.shape,
  ...telemetryConfig.shape,
  ...apiConfig.shape,
  // Resource server only: the API never needs the OIDC client id or secret.
  ...oidcConfig.pick({ OIDC_ISSUER_URL: true, OIDC_AUDIENCE: true, OIDC_ACCESS_TOKEN_TYP: true })
    .shape,
  ...bootstrapConfig.shape,
  ...aiConfig.shape,
  // P3-R15: evidence storage is required.
  ...storageConfig.shape,
  ...demoConfig.shape,
});

const REQUIRED_FOR_DEMO = "is required when DEMO_TOOLS_ENABLED=true";

/**
 * Demo mode on (spec §5.1): the owner URL joins the schema only in this branch, and it and the
 * bootstrap email become required, so a reset can never leave the instance without an
 * administrator. All missing settings are reported at once.
 */
const demoAppConfig = appConfig
  .extend({ DATABASE_OWNER_URL: databaseOwnerConfig.shape.DATABASE_OWNER_URL.optional() })
  .superRefine((config, ctx) => {
    if (config.BOOTSTRAP_ADMIN_EMAIL === undefined)
      ctx.addIssue({ code: "custom", path: ["BOOTSTRAP_ADMIN_EMAIL"], message: REQUIRED_FOR_DEMO });
    if (config.DATABASE_OWNER_URL === undefined)
      ctx.addIssue({ code: "custom", path: ["DATABASE_OWNER_URL"], message: REQUIRED_FOR_DEMO });
  });

/** Demo mode settings for the demo module only; null when demo mode is off. */
export type DemoConfig = { ownerUrl: string };

export type AppConfig = z.infer<typeof appConfig> & { demo: DemoConfig | null };

/**
 * Loads and checks the configuration; the mock AI provider is refused in production (P3-R9).
 * `DATABASE_OWNER_URL` is read only when DEMO_TOOLS_ENABLED is true, and then lives only at
 * `config.demo.ownerUrl`.
 */
export function loadAppConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const { DEMO_TOOLS_ENABLED } = loadConfig(demoConfig, env);
  if (!DEMO_TOOLS_ENABLED) {
    const config = loadConfig(appConfig, env);
    assertNotMockInProduction(config, env["NODE_ENV"]);
    return { ...config, demo: null };
  }
  const { DATABASE_OWNER_URL, ...config } = loadConfig(demoAppConfig, env);
  assertNotMockInProduction(config, env["NODE_ENV"]);
  // The refinement guarantees it; the check keeps the type honest.
  if (DATABASE_OWNER_URL === undefined) throw new Error("DATABASE_OWNER_URL missing");
  return { ...config, demo: { ownerUrl: DATABASE_OWNER_URL } };
}
