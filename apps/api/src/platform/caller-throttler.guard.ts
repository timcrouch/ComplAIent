import { createHash } from "node:crypto";
import { type ExecutionContext, Injectable } from "@nestjs/common";
import { ThrottlerGuard } from "@nestjs/throttler";

const BEARER = /^Bearer\s+(\S+)$/i;

/** Strips the IPv4-mapped IPv6 prefix so `::ffff:10.0.0.1` equals `10.0.0.1`. */
export function normaliseIp(ip: string): string {
  return ip.toLowerCase().replace(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/, "$1");
}

/** Bucket key for the per-IP throttler: the normalised socket peer address. */
export function ipTracker(req: { ip?: string | undefined }): string {
  return `ip:${normaliseIp(req.ip ?? "unknown")}`;
}

/**
 * Throttling runs before authentication, so bucket keys must not trust unverified claims.
 * Two buckets apply to every request (probes excepted), both 60s windows:
 * - `caller` (RATE_LIMIT_PER_MINUTE): keyed by a hash of the bearer token string, else the IP.
 *   A caller can only spend its own token's bucket, and all BFF traffic shares one IP, so an
 *   IP key here would make the limit org-wide.
 * - `ip` (RATE_LIMIT_PER_IP_PER_MINUTE): keyed by IP alone, so rotating garbage bearers
 *   cannot mint fresh `caller` buckets. IPs in THROTTLE_TRUSTED_IPS (the BFF) skip this
 *   bucket only, and remain bound by the per-token bucket.
 * The `ip` bucket is global: its key ignores the route. `req.ip` is the socket peer unless
 * TRUST_PROXY is a hop count n, in which case it is the right-most address in X-Forwarded-For
 * that is not one of the n trusted proxies. A client cannot forge it if n exactly matches the
 * real proxy count. Behind a proxy without TRUST_PROXY every client shares the proxy's address.
 */
export function throttleTracker(req: {
  headers?: Record<string, unknown>;
  ip?: string | undefined;
}): string {
  const header = req.headers?.["authorization"];
  const match = typeof header === "string" ? BEARER.exec(header) : null;
  if (match?.[1]) return `token:${createHash("sha256").update(match[1]).digest("hex")}`;
  return `ip:${req.ip ?? "unknown"}`;
}

@Injectable()
export class CallerThrottlerGuard extends ThrottlerGuard {
  /** The `ip` bucket counts every route together; other buckets stay per route. */
  protected override generateKey(context: ExecutionContext, suffix: string, name: string): string {
    return name === "ip" ? `${name}-${suffix}` : super.generateKey(context, suffix, name);
  }

  protected override getTracker(req: Record<string, unknown>): Promise<string> {
    return Promise.resolve(throttleTracker(req));
  }
}
