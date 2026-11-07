import { v7 } from "uuid";

export type Id<T extends string> = string & { __brand: T };

/** Creates a new time-ordered UUIDv7 identifier. */
export function newId<T extends string>(): Id<T> {
  return v7() as Id<T>;
}
