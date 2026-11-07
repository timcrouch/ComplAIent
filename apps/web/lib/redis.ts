import "server-only";
import { Redis } from "ioredis";
import { env } from "./env";
import { log } from "./log";
import type { KvStore } from "./store";

const RELEASE_SCRIPT =
  'if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end';

class RedisStore implements KvStore {
  constructor(readonly redis: Redis) {}

  get(key: string): Promise<string | null> {
    return this.redis.get(key);
  }

  async set(key: string, value: string, ttlMs: number, mode?: "NX" | "XX"): Promise<boolean> {
    const px = Math.max(1, Math.ceil(ttlMs));
    const result =
      mode === "NX"
        ? await this.redis.set(key, value, "PX", px, "NX")
        : mode === "XX"
          ? await this.redis.set(key, value, "PX", px, "XX")
          : await this.redis.set(key, value, "PX", px);
    return result === "OK";
  }

  getDel(key: string): Promise<string | null> {
    return this.redis.getdel(key);
  }

  async del(key: string): Promise<void> {
    await this.redis.del(key);
  }

  async delIfEquals(key: string, value: string): Promise<void> {
    await this.redis.eval(RELEASE_SCRIPT, 1, key, value);
  }
}

// Survives Next.js dev hot reloads, which re-evaluate modules.
const holder = globalThis as typeof globalThis & { __ismsWebStore?: RedisStore };

export function getStore(): KvStore {
  if (!holder.__ismsWebStore) {
    const redis = new Redis(env().REDIS_URL, { maxRetriesPerRequest: 2, connectTimeout: 5_000 });
    // Log the error class only: messages can include the connection URL.
    redis.on("error", (err: Error) => {
      log().warn({ event: "redis.error", errorName: err.name });
    });
    holder.__ismsWebStore = new RedisStore(redis);
  }
  return holder.__ismsWebStore;
}

/** Closes the Redis connection (tests and graceful shutdown). */
export async function closeStore(): Promise<void> {
  const store = holder.__ismsWebStore;
  delete holder.__ismsWebStore;
  if (store) await store.redis.quit();
}
