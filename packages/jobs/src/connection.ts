import { Redis } from "ioredis";

/** BullMQ workers require `maxRetriesPerRequest: null` on their connection. */
export function createRedisConnection(redisUrl: string): Redis {
  return new Redis(redisUrl, { maxRetriesPerRequest: null });
}
