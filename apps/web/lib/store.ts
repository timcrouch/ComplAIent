/** The subset of Redis the BFF needs; implemented by `redis.ts`, faked in unit tests. */
export interface KvStore {
  get(key: string): Promise<string | null>;
  /** Writes with a TTL. `NX`: only if absent; `XX`: only if present. Returns whether it wrote. */
  set(key: string, value: string, ttlMs: number, mode?: "NX" | "XX"): Promise<boolean>;
  /** Atomic read-and-delete (Redis GETDEL). */
  getDel(key: string): Promise<string | null>;
  del(key: string): Promise<void>;
  /** Deletes the key only while it still holds `value` (safe lock release). */
  delIfEquals(key: string, value: string): Promise<void>;
}
