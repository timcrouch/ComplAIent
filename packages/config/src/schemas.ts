import { z } from "zod";

export const databaseConfig = z.object({
  DATABASE_URL: z.url(),
});

/** Owner role connection: migrations and test reset only, never runtime. */
export const databaseOwnerConfig = z.object({
  DATABASE_OWNER_URL: z.url(),
});

/** Integration tests only. */
export const databaseTestConfig = z.object({
  DATABASE_TEST_URL: z.url(),
  DATABASE_OWNER_TEST_URL: z.url(),
});

export const redisConfig = z.object({
  REDIS_URL: z.url(),
});

export const oidcConfig = z.object({
  OIDC_ISSUER_URL: z.url(),
  OIDC_AUDIENCE: z.string().min(1),
  OIDC_CLIENT_ID: z.string().min(1),
  OIDC_CLIENT_SECRET: z.string().min(1),
});

export const webConfig = z.object({
  WEB_BASE_URL: z.url(),
  API_BASE_URL: z.url(),
  SESSION_SECRET: z.string().min(32),
});

export const telemetryConfig = z.object({
  OTEL_EXPORTER_OTLP_ENDPOINT: z.url().optional(),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  METRICS_PORT: z.coerce.number().int().min(1).max(65535).default(9464),
});

export const apiConfig = z.object({
  API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).default(120),
  /** Per-IP ceiling across all bearer tokens, so rotating tokens cannot bypass throttling. */
  RATE_LIMIT_PER_IP_PER_MINUTE: z.coerce.number().int().min(1).default(600),
  /** Comma-separated IPs (e.g. the BFF) exempt from the per-IP limit only. */
  THROTTLE_TRUSTED_IPS: z
    .string()
    .default("")
    .transform((value) =>
      value
        .split(",")
        .map((entry) => entry.trim())
        .filter((entry) => entry !== ""),
    )
    .pipe(z.array(z.union([z.ipv4(), z.ipv6()]))),
  /**
   * "false", or the number of trusted reverse-proxy hops in front of the API (1-10), passed to
   * express `trust proxy` so `req.ip` is the right-most untrusted address. A client cannot
   * forge that; "true" would trust the left-most `X-Forwarded-For` entry, which it can.
   */
  TRUST_PROXY: z
    .string()
    .default("false")
    .transform((value, ctx): false | number => {
      if (value === "false") return false;
      if (/^\d+$/.test(value)) {
        const hops = Number(value);
        if (hops >= 1 && hops <= 10) return hops;
      }
      ctx.addIssue({
        code: "custom",
        message:
          value === "true"
            ? 'TRUST_PROXY=true is not accepted: set the proxy hop count (1-10), e.g. "1"'
            : 'must be "false" or a proxy hop count between 1 and 10',
      });
      return z.NEVER;
    }),
});

export const bootstrapConfig = z.object({
  BOOTSTRAP_ADMIN_EMAIL: z.email().optional(),
});

/**
 * Demo and training tools (spec §5.1): sample data and reset. Off by default. When on, the API
 * also requires BOOTSTRAP_ADMIN_EMAIL and DATABASE_OWNER_URL (apps/api/src/config.ts); when
 * off, the owner URL is never read.
 */
export const demoConfig = z.object({
  DEMO_TOOLS_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
});

export const workerConfig = z.object({
  /** Liveness endpoint (`GET /healthz`). */
  WORKER_HEALTH_PORT: z.coerce.number().int().min(1).max(65535).default(9465),
  /** Prometheus scrape port; separate from health, and from the API's METRICS_PORT. */
  WORKER_METRICS_PORT: z.coerce.number().int().min(1).max(65535).default(9466),
});

/**
 * AI gateway. `mock` is for tests and e2e only; production refuses it (assertNotMockInProduction).
 * `AI_ALLOW_NON_EU_ROUTING` is a development-only opt-in; production refuses it too.
 */
export const aiConfig = z.object({
  AI_PROVIDER: z.enum(["openrouter", "mock"]).default("openrouter"),
  /** Development only: lets AI run with EU-only routing off (zero retention stays required). */
  AI_ALLOW_NON_EU_ROUTING: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  /** Base64 of exactly 32 bytes (`openssl rand -base64 32`); encrypts stored provider keys. */
  AI_SECRETS_KEY: z
    .string()
    .optional()
    .transform((value, ctx): Buffer | undefined => {
      if (value === undefined) return undefined;
      const decoded = Buffer.from(value, "base64");
      // Round-trip rejects stray characters and bad padding that Buffer.from silently skips.
      if (decoded.length === 32 && decoded.toString("base64") === value) return decoded;
      ctx.addIssue({ code: "custom", message: "must be base64 of exactly 32 bytes" });
      return z.NEVER;
    }),
});

/** Evidence object storage (S3-compatible; MinIO locally). */
export const storageConfig = z.object({
  S3_ENDPOINT: z.url(),
  S3_REGION: z.string().min(1).default("eu-central-1"),
  S3_BUCKET: z.string().min(3),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(1),
  S3_FORCE_PATH_STYLE: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  EVIDENCE_MAX_BYTES: z.coerce.number().int().min(1).max(104_857_600).default(26_214_400),
});

export const embeddingsConfig = z.object({
  EMBEDDINGS_CACHE_DIR: z.string().default(".cache/models"),
});

export function assertNotMockInProduction(
  config: { AI_PROVIDER: string; AI_ALLOW_NON_EU_ROUTING?: boolean },
  nodeEnv: string | undefined = process.env.NODE_ENV,
): void {
  if (nodeEnv !== "production") return;
  if (config.AI_PROVIDER === "mock") {
    throw new Error("AI_PROVIDER=mock is not allowed in production");
  }
  if (config.AI_ALLOW_NON_EU_ROUTING === true) {
    throw new Error("AI_ALLOW_NON_EU_ROUTING=true is not allowed in production");
  }
}
