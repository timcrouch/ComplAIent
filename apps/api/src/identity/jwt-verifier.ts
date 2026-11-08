import { Logger } from "@nestjs/common";
import { type Clock, DomainError, systemClock } from "@isms/domain";
import {
  type JWTHeaderParameters,
  type JWTPayload,
  type JWTVerifyGetKey,
  createRemoteJWKSet,
  errors,
  jwtVerify,
} from "jose";
import { z } from "zod";

export type VerifiedToken = {
  issuer: string;
  subject: string;
  email: string;
  emailVerified: boolean;
  name: string;
  /** Epoch seconds. */
  authTime: number;
  /**
   * Where authTime came from. `iat` is renewed on every token refresh, so it identifies the
   * session but never proves a recent interactive sign-in (Ruling R22).
   */
  authTimeSource: AuthTimeSource;
};

export type AuthTimeSource = "auth_time" | "iat";

export type JwtVerifierOptions = {
  /** Exact expected `iss`; discovery is read from `<issuer>/.well-known/openid-configuration`. */
  issuer: string;
  /** Exact expected `aud` entry. */
  audience: string;
  /**
   * If set, the protected header `typ` must equal it, compared case-insensitively (for example
   * `at+jwt`, RFC 9068). Unset, any `typ` but `ID` is accepted.
   */
  accessTokenTyp?: string | undefined;
  /** Timeout for each discovery and JWKS request (default 3000 ms). */
  fetchTimeoutMs?: number;
  clock?: Clock;
};

const ALGORITHMS = ["RS256", "ES256"];
const CLOCK_TOLERANCE_S = 30;
const DEFAULT_FETCH_TIMEOUT_MS = 3000;

const claimsSchema = z.object({
  sub: z.string().min(1),
  email: z.string().min(1),
  email_verified: z.boolean(),
  name: z.string().min(1).optional(),
  preferred_username: z.string().min(1).optional(),
  auth_time: z.number().int().positive().optional(),
  iat: z.number().int().positive().optional(),
});

const discoverySchema = z.object({ issuer: z.string(), jwks_uri: z.url() });

/** Thrown internally when the signing keys cannot be obtained from the identity provider. */
class KeySourceUnavailable extends Error {
  constructor(readonly reason: string) {
    super("Identity provider key source unavailable");
  }
}

/** Errors caused by the token itself (its header), not by the key source. */
const isTokenAttributable = (err: unknown): boolean =>
  err instanceof errors.JWKSNoMatchingKey ||
  err instanceof errors.JWKSMultipleMatchingKeys ||
  err instanceof errors.JOSENotSupported;

const reasonOf = (err: unknown): string =>
  err instanceof errors.JOSEError ? err.code : err instanceof Error ? err.name : "unknown";

export const unauthenticated = (): DomainError =>
  new DomainError("UNAUTHENTICATED", "Sign-in required");

/**
 * Verifies OIDC access tokens as a pure resource server. Only RS256/ES256, exact issuer and
 * audience, 30 s skew; ID tokens (`typ: ID` or a `nonce` claim) are refused. Keys come from the
 * issuer's discovered JWKS; jose refetches it for an unknown kid at most once per cooldown
 * (30 s). Key source failures map to AUTH_UNAVAILABLE,
 * every other failure to UNAUTHENTICATED with a fixed message (the reason is never exposed).
 */
export class JwtVerifier {
  private readonly logger = new Logger(JwtVerifier.name);
  private readonly timeoutMs: number;
  private readonly clock: Clock;
  private jwks: Promise<JWTVerifyGetKey> | undefined;

  constructor(private readonly options: JwtVerifierOptions) {
    this.timeoutMs = options.fetchTimeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;
    this.clock = options.clock ?? systemClock;
  }

  async verify(token: string): Promise<VerifiedToken> {
    let payload: JWTPayload;
    let header: JWTHeaderParameters;
    try {
      ({ payload, protectedHeader: header } = await jwtVerify(token, this.getKey, {
        issuer: this.options.issuer,
        audience: this.options.audience,
        algorithms: ALGORITHMS,
        clockTolerance: CLOCK_TOLERANCE_S,
        requiredClaims: ["exp", "sub"],
        currentDate: this.clock.now(),
      }));
    } catch (err) {
      if (err instanceof KeySourceUnavailable) {
        this.logger.warn({ msg: "Identity provider keys unavailable", reason: err.reason });
        throw new DomainError("AUTH_UNAVAILABLE", "Authentication service unavailable");
      }
      this.logger.debug({ msg: "Token rejected", reason: reasonOf(err) });
      throw unauthenticated();
    }
    const notAccessToken = this.notAccessToken(header, payload);
    if (notAccessToken !== undefined) {
      this.logger.debug({ msg: "Token rejected", reason: notAccessToken });
      throw unauthenticated();
    }
    return this.toVerified(payload);
  }

  /**
   * Why a validly signed token is not an access token, or undefined. Keycloak ID tokens carry
   * `typ: ID`; ID tokens from the code flow always carry a `nonce`, access tokens never do.
   */
  private notAccessToken(header: JWTHeaderParameters, payload: JWTPayload): string | undefined {
    const typ = header.typ?.toLowerCase();
    if (typ === "id") return "typ ID";
    if (payload["nonce"] !== undefined) return "nonce";
    const expected = this.options.accessTokenTyp?.toLowerCase();
    if (expected !== undefined && typ !== expected) return "typ";
    return undefined;
  }

  private toVerified(payload: JWTPayload): VerifiedToken {
    const parsed = claimsSchema.safeParse(payload);
    if (!parsed.success) {
      this.logger.debug({ msg: "Token rejected", reason: "claims" });
      throw unauthenticated();
    }
    const claims = parsed.data;
    const name = claims.name ?? claims.preferred_username;
    const authTime = claims.auth_time ?? claims.iat;
    if (name === undefined || authTime === undefined) throw unauthenticated();
    // Defence in depth: a sign-in time in the future would defeat recent-auth checks.
    const nowSeconds = Math.floor(this.clock.now().getTime() / 1000);
    if (authTime > nowSeconds + CLOCK_TOLERANCE_S) {
      this.logger.debug({ msg: "Token rejected", reason: "auth_time in the future" });
      throw unauthenticated();
    }
    return {
      issuer: this.options.issuer,
      subject: claims.sub,
      email: claims.email,
      emailVerified: claims.email_verified,
      name,
      authTime,
      authTimeSource: claims.auth_time === undefined ? "iat" : "auth_time",
    };
  }

  /** Key resolver handed to jose: separates key source failures from token problems. */
  private readonly getKey: JWTVerifyGetKey = async (header, token) => {
    const jwks = await this.remoteJwks();
    try {
      return await jwks(header, token);
    } catch (err) {
      // Rethrow token-caused errors untouched: jose iterates JWKSMultipleMatchingKeys itself.
      if (isTokenAttributable(err)) throw err;
      throw new KeySourceUnavailable(reasonOf(err));
    }
  };

  private remoteJwks(): Promise<JWTVerifyGetKey> {
    this.jwks ??= this.discover().catch((err: unknown) => {
      this.jwks = undefined; // retry discovery on the next request
      throw err instanceof KeySourceUnavailable ? err : new KeySourceUnavailable(reasonOf(err));
    });
    return this.jwks;
  }

  private async discover(): Promise<JWTVerifyGetKey> {
    const url = `${this.options.issuer.replace(/\/+$/, "")}/.well-known/openid-configuration`;
    const res = await fetch(url, {
      redirect: "error",
      signal: AbortSignal.timeout(this.timeoutMs),
      headers: { accept: "application/json" },
    });
    if (res.status !== 200)
      throw new KeySourceUnavailable(`discovery status ${String(res.status)}`);
    const doc = discoverySchema.safeParse(await res.json());
    if (!doc.success) throw new KeySourceUnavailable("discovery document invalid");
    if (doc.data.issuer !== this.options.issuer) {
      throw new KeySourceUnavailable("discovery issuer mismatch");
    }
    return createRemoteJWKSet(new URL(doc.data.jwks_uri), { timeoutDuration: this.timeoutMs });
  }
}
