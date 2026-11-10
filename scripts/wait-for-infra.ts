import { connect } from "node:net";
import { HeadBucketCommand, S3Client } from "@aws-sdk/client-s3";
import postgres from "postgres";

// Polls every local infrastructure service until it is usable. Exits non-zero
// after TIMEOUT_MS and names each service that never became ready.

const TIMEOUT_MS = 120_000;
const RETRY_MS = 2_000;
const BUCKET = "isms-evidence";

try {
  process.loadEnvFile(".env");
} catch {
  // .env is optional when the variables are already exported.
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set; copy .env.example to .env`);
  return value;
}

async function checkPostgres(): Promise<void> {
  const sql = postgres(required("DATABASE_URL"), {
    max: 1,
    connect_timeout: 5,
    onnotice: () => {},
  });
  try {
    await sql`SELECT 1`;
    // Succeeds (as a no-op) only once init created the extension in `isms`.
    await sql`CREATE EXTENSION IF NOT EXISTS vector`;
    const rows = await sql`SELECT 1 FROM pg_extension WHERE extname = 'vector'`;
    if (rows.length === 0) throw new Error("vector extension missing");
  } finally {
    await sql.end({ timeout: 1 });
  }
}

function checkRedis(): Promise<void> {
  const { hostname, port } = new URL(required("REDIS_URL"));
  return new Promise((resolve, reject) => {
    const socket = connect({ host: hostname, port: Number(port || 6379) });
    socket.setTimeout(5_000, () => socket.destroy(new Error("timeout")));
    socket.on("connect", () => socket.write("PING\r\n"));
    socket.on("data", (data) => {
      socket.destroy();
      if (data.toString().startsWith("+PONG")) resolve();
      else reject(new Error(`unexpected reply ${JSON.stringify(data.toString())}`));
    });
    socket.on("error", reject);
  });
}

async function checkMinio(): Promise<void> {
  const client = new S3Client({
    endpoint: `http://localhost:${process.env.MINIO_PORT ?? "9000"}`,
    region: "us-east-1",
    forcePathStyle: true,
    credentials: {
      accessKeyId: required("MINIO_ROOT_USER"),
      secretAccessKey: required("MINIO_ROOT_PASSWORD"),
    },
  });
  try {
    await client.send(new HeadBucketCommand({ Bucket: BUCKET }));
  } finally {
    client.destroy();
  }
}

async function checkHttp(url: string): Promise<void> {
  const response = await fetch(url, { signal: AbortSignal.timeout(5_000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
}

/** OIDC can be healthy while a stale Docker Desktop bind mount leaves the login theme empty. */
async function checkKeycloak(): Promise<void> {
  const issuer = required("OIDC_ISSUER_URL");
  await checkHttp(`${issuer}/.well-known/openid-configuration`);

  const authorize = new URL(`${issuer}/protocol/openid-connect/auth`);
  authorize.search = new URLSearchParams({
    client_id: "isms-web",
    redirect_uri: new URL("/auth/callback", required("WEB_BASE_URL")).toString(),
    response_type: "code",
    scope: "openid",
    code_challenge: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    code_challenge_method: "S256",
  }).toString();
  const response = await fetch(authorize, { signal: AbortSignal.timeout(5_000) });
  if (!response.ok) throw new Error(`login HTTP ${response.status}`);
  const html = await response.text();
  if (!html.includes("/login/complaient/css/complaient.css")) {
    throw new Error(
      "ComplAIent login theme is not served; run `docker compose --env-file .env -f infrastructure/docker/compose.yaml up -d --force-recreate keycloak`",
    );
  }
}

const checks: Record<string, () => Promise<void>> = {
  postgres: checkPostgres,
  redis: checkRedis,
  minio: checkMinio,
  keycloak: checkKeycloak,
  prometheus: () => checkHttp("http://localhost:9090/-/ready"),
};

const deadline = Date.now() + TIMEOUT_MS;
const failures = new Map<string, string>();

async function waitFor(name: string, check: () => Promise<void>): Promise<boolean> {
  for (;;) {
    try {
      await check();
      failures.delete(name);
      console.log(`ok   ${name}`);
      return true;
    } catch (error) {
      failures.set(name, error instanceof Error ? error.message : String(error));
      if (Date.now() + RETRY_MS > deadline) return false;
      await new Promise((resolve) => setTimeout(resolve, RETRY_MS));
    }
  }
}

const results = await Promise.all(
  Object.entries(checks).map(([name, check]) => waitFor(name, check)),
);

if (results.every(Boolean)) {
  console.log("all services ok");
} else {
  for (const [name, reason] of failures) console.error(`FAIL ${name}: ${reason}`);
  console.error(`infrastructure not ready after ${TIMEOUT_MS / 1000}s`);
  process.exit(1);
}
