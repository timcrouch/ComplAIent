import type { ZodObject, ZodType } from "zod";
import type { Permission } from "./permissions.js";

export type RouteDef = {
  method: "get" | "post" | "put" | "patch" | "delete";
  /** OpenAPI-style path, e.g. `/api/v1/risks/{id}`. The API layer converts to `:id`. */
  path: string;
  summary: string;
  permission?: Permission;
  recentAuth?: boolean;
  /**
   * Registered only when the named server setting is on (`demo`: DEMO_TOOLS_ENABLED). Such
   * routes are not in `allRoutes` but in `conditionalRoutes`; the document marks them
   * `x-conditional` and they are 404 where the setting is off.
   */
  conditional?: "demo";
  request?: { params?: ZodObject; query?: ZodObject; body?: ZodType };
  /**
   * The body is the raw file (`application/octet-stream`), buffered up to the named config
   * limit; there is no JSON body. The API hands the handler a non-empty Buffer.
   */
  upload?: { maxBytesConfig: "EVIDENCE_MAX_BYTES" };
  /** The 200 response is a file stream (`application/octet-stream`), not JSON. */
  download?: true;
  responses: Record<number, ZodType>;
};

/** Identity helper that preserves the literal type of the definition. */
export function defineRoute<const T extends RouteDef>(def: T): T {
  return def;
}
