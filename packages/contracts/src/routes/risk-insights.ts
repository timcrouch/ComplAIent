import { z } from "zod";
import "../zod.js";
import { defineRoute } from "../route.js";

export const MapBasisSchema = z.enum(["inherent", "residual"]).openapi("MapBasis");

export const RiskMapQuery = z
  .object({
    basis: MapBasisSchema.default("inherent"),
    /** Closed risks are left out unless this is "true" (z.coerce.boolean would read "false" as true). */
    includeClosed: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
  })
  .openapi("RiskMapQuery");
export type RiskMapQuery = z.infer<typeof RiskMapQuery>;

export const RiskMapCellDto = z
  .object({
    likelihood: z.number().int(),
    impact: z.number().int(),
    count: z.number().int().min(1),
  })
  .openapi("RiskMapCellDto");
export type RiskMapCellDto = z.infer<typeof RiskMapCellDto>;

export const RiskMapResponse = z
  .object({
    basis: MapBasisSchema,
    appetiteThreshold: z.number().int(),
    /** Non-empty cells only. */
    cells: z.array(RiskMapCellDto),
    /** Visible risks counted by this map (placed + unplaced + unscored). */
    total: z.number().int(),
    /** No likelihood or impact yet. */
    unscored: z.number().int(),
    /** Residual basis only: scored, but no expected score and not accepted. 0 for inherent. */
    unplaced: z.number().int(),
  })
  .openapi("RiskMapResponse");
export type RiskMapResponse = z.infer<typeof RiskMapResponse>;

export const riskInsightRoutes = {
  map: defineRoute({
    method: "get",
    path: "/api/v1/risks/map",
    summary:
      "Visible risks counted per likelihood × impact cell, on the inherent or residual basis",
    permission: "risks.read",
    request: { query: RiskMapQuery },
    responses: { 200: RiskMapResponse },
  }),
};
