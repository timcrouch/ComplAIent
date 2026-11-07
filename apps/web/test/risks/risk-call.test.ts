import { describe, expect, it } from "vitest";
import { type Failure, riskFailureMessage } from "../../components/risks/risk-call";

const invalid = (path: string, message: string): Failure => ({
  ok: false,
  kind: "invalid",
  details: [{ path, message }],
});

describe("riskFailureMessage for 400s on the assessment", () => {
  it("uses the residual message for a residual field", () => {
    expect(riskFailureMessage(invalid("changes.residualImpact", "x"))).toBe("residual");
  });

  it("uses it for likelihood or impact only with the API's residual text", () => {
    expect(
      riskFailureMessage(
        invalid(
          "changes.likelihood",
          "Expected likelihood and impact cannot exceed the current ones",
        ),
      ),
    ).toBe("residual");
    expect(
      riskFailureMessage(invalid("changes.impact", "An accepted risk has no expected score")),
    ).toBe("residual");
  });

  it("keeps the generic message for any other problem with likelihood or impact", () => {
    expect(riskFailureMessage(invalid("changes.likelihood", "Must be between 1 and 5"))).toBe(
      "invalid",
    );
    expect(riskFailureMessage(invalid("changes.impact", "Required"))).toBe("invalid");
  });
});
