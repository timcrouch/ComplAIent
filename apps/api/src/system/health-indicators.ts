import { Inject, Injectable } from "@nestjs/common";
import type { Redis } from "ioredis";
import type { ObjectStore } from "../evidence/index.js";
import { PRISMA, type PrismaService, REDIS } from "../platform/index.js";

export const CHECK_TIMEOUT_MS = 2000;

export const POSTGRES_HEALTH = Symbol("POSTGRES_HEALTH");
export const REDIS_HEALTH = Symbol("REDIS_HEALTH");
/** Null when the app has no object store (tests without the evidence module). */
export const STORAGE_HEALTH = Symbol("STORAGE_HEALTH");

/** One dependency probe. `check` resolves when healthy and rejects otherwise. */
export interface HealthIndicator {
  readonly name: string;
  check(): Promise<void>;
}

export async function withTimeout(work: Promise<unknown>, ms: number): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`timed out after ${String(ms)} ms`));
    }, ms);
  });
  try {
    await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

@Injectable()
export class PostgresHealthIndicator implements HealthIndicator {
  readonly name = "postgres";
  constructor(@Inject(PRISMA) private readonly prisma: PrismaService) {}

  async check(): Promise<void> {
    await withTimeout(this.prisma.$queryRaw`SELECT 1`, CHECK_TIMEOUT_MS);
  }
}

@Injectable()
export class RedisHealthIndicator implements HealthIndicator {
  readonly name = "redis";
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async check(): Promise<void> {
    await withTimeout(this.redis.ping(), CHECK_TIMEOUT_MS);
  }
}

/** The evidence bucket answers a HEAD request. */
export class StorageHealthIndicator implements HealthIndicator {
  readonly name = "storage";
  constructor(private readonly store: ObjectStore) {}

  async check(): Promise<void> {
    // Cancel the request itself on timeout, so a hung store does not pile up sockets.
    const controller = new AbortController();
    try {
      await withTimeout(this.store.head(controller.signal), CHECK_TIMEOUT_MS);
    } finally {
      controller.abort();
    }
  }
}
