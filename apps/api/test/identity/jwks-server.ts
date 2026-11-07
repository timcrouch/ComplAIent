import { type Server, createServer } from "node:http";
import type { AddressInfo } from "node:net";
import {
  type CryptoKey,
  type JWK,
  type JWTPayload,
  SignJWT,
  exportJWK,
  generateKeyPair,
} from "jose";

export type TestKey = { kid: string; alg: "RS256" | "ES256"; privateKey: CryptoKey; jwk: JWK };

export async function makeKey(kid: string, alg: "RS256" | "ES256" = "RS256"): Promise<TestKey> {
  const { privateKey, publicKey } = await generateKeyPair(alg, { extractable: true });
  const jwk = { ...(await exportJWK(publicKey)), kid, alg, use: "sig" };
  return { kid, alg, privateKey, jwk };
}

export type JwksServerOptions = {
  /** Overrides the jwks_uri advertised by discovery (e.g. an unreachable address). */
  jwksUri?: string;
  /** Overrides the issuer advertised by discovery. */
  advertisedIssuer?: string;
};

/**
 * Minimal local OIDC provider for tests: serves discovery and a JWKS, counts JWKS hits,
 * and can be switched to fail (non-200) or hang (to provoke a timeout).
 */
export class JwksServer {
  keys: TestKey[] = [];
  jwksHits = 0;
  mode: "ok" | "error" | "hang" = "ok";
  private server: Server | undefined;
  private port = 0;

  constructor(private readonly options: JwksServerOptions = {}) {}

  get issuer(): string {
    return `http://127.0.0.1:${String(this.port)}/realms/test`;
  }

  async start(): Promise<this> {
    this.server = createServer((req, res) => {
      if (req.url === "/realms/test/.well-known/openid-configuration") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            issuer: this.options.advertisedIssuer ?? this.issuer,
            jwks_uri: this.options.jwksUri ?? `${this.issuer}/certs`,
          }),
        );
        return;
      }
      if (req.url === "/realms/test/certs") {
        this.jwksHits += 1;
        if (this.mode === "hang") return; // never answers
        if (this.mode === "error") {
          res.writeHead(500).end();
          return;
        }
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ keys: this.keys.map((k) => k.jwk) }));
        return;
      }
      res.writeHead(404).end();
    });
    await new Promise<void>((resolve) => this.server?.listen(0, "127.0.0.1", resolve));
    this.port = (this.server.address() as AddressInfo).port;
    return this;
  }

  async stop(): Promise<void> {
    const server = this.server;
    if (!server) return;
    this.server = undefined;
    server.closeAllConnections();
    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve();
      });
    });
  }

  /** Signs a valid token by default; `claims` override it, and an `undefined` claim is omitted. */
  async sign(
    claims: Record<string, unknown> = {},
    key: TestKey | undefined = this.keys[0],
  ): Promise<string> {
    if (!key) throw new Error("no signing key");
    const now = Math.floor(Date.now() / 1000);
    const defaults: Record<string, unknown> = {
      iss: this.issuer,
      aud: "isms-api",
      sub: "subject-1",
      email: "user@example.test",
      email_verified: true,
      name: "Test User",
      iat: now,
      exp: now + 300,
      auth_time: now - 10,
      ...claims,
    };
    const payload: JWTPayload = Object.fromEntries(
      Object.entries(defaults).filter(([, v]) => v !== undefined),
    );
    return new SignJWT(payload)
      .setProtectedHeader({ alg: key.alg, kid: key.kid })
      .sign(key.privateKey);
  }
}
