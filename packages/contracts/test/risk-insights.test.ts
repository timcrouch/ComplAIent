import { describe, expect, it } from "vitest";
import { RiskMapQuery, allRoutes, riskInsightRoutes } from "../src/index.js";

describe("risk insight contracts", () => {
  it("defaults the map basis to inherent and refuses unknown bases", () => {
    expect(RiskMapQuery.parse({}).basis).toBe("inherent");
    expect(RiskMapQuery.parse({ basis: "residual" }).basis).toBe("residual");
    expect(RiskMapQuery.safeParse({ basis: "x" }).success).toBe(false);
  });

  it("declares the map route, read-guarded and listed", () => {
    expect(riskInsightRoutes.map.path).toBe("/api/v1/risks/map");
    expect(riskInsightRoutes.map.permission).toBe("risks.read");
    expect(allRoutes).toContain(riskInsightRoutes.map);
  });
});
