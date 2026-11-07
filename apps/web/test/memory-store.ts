import type { KvStore } from "../lib/store";

/** In-memory KvStore with Redis-like TTL, NX/XX and GETDEL semantics, for unit tests. */
export class MemoryStore implements KvStore {
  readonly data = new Map<string, { value: string; expiresAt: number }>();

  private live(key: string): string | null {
    const entry = this.data.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      this.data.delete(key);
      return null;
    }
    return entry.value;
  }

  get(key: string): Promise<string | null> {
    return Promise.resolve(this.live(key));
  }

  set(key: string, value: string, ttlMs: number, mode?: "NX" | "XX"): Promise<boolean> {
    const exists = this.live(key) !== null;
    if ((mode === "NX" && exists) || (mode === "XX" && !exists)) return Promise.resolve(false);
    this.data.set(key, { value, expiresAt: Date.now() + ttlMs });
    return Promise.resolve(true);
  }

  getDel(key: string): Promise<string | null> {
    const value = this.live(key);
    this.data.delete(key);
    return Promise.resolve(value);
  }

  del(key: string): Promise<void> {
    this.data.delete(key);
    return Promise.resolve();
  }

  delIfEquals(key: string, value: string): Promise<void> {
    if (this.live(key) === value) this.data.delete(key);
    return Promise.resolve();
  }

  ttl(key: string): number | null {
    const entry = this.data.get(key);
    return entry ? entry.expiresAt - Date.now() : null;
  }
}
