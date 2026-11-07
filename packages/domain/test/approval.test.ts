import { describe, expect, it } from "vitest";
import { approvalRefusal, approvalRule } from "../src/index.js";

const base = {
  actorId: "u3",
  reporterId: "u1",
  reviewerId: "u2",
  actorHoldsApprove: true,
  actorHoldsReview: true,
};

describe("approvalRule", () => {
  it("score 9 at threshold 9 with mitigate lets the reviewer approve", () => {
    expect(
      approvalRule({
        likelihood: 3,
        impact: 3,
        treatment: "mitigate",
        appetiteThreshold: 9,
      }),
    ).toBe("reviewerMayApprove");
  });
  it("score 10 at threshold 9 needs an independent approver", () => {
    expect(
      approvalRule({
        likelihood: 2,
        impact: 5,
        treatment: "mitigate",
        appetiteThreshold: 9,
      }),
    ).toBe("independentApprover");
  });
  it("accept always needs an independent approver, even at score 1", () => {
    expect(
      approvalRule({
        likelihood: 1,
        impact: 1,
        treatment: "accept",
        appetiteThreshold: 9,
      }),
    ).toBe("independentApprover");
  });
});

describe("approvalRefusal", () => {
  it("the reporter can never approve, even holding risks.approve", () => {
    expect(
      approvalRefusal({
        ...base,
        actorId: "u1",
        reviewerId: "u2",
        rule: "reviewerMayApprove",
      }),
    ).toBe("reporter");
  });
  it("reporter check precedes reviewer check", () => {
    expect(
      approvalRefusal({
        ...base,
        actorId: "u1",
        reviewerId: "u1",
        rule: "reviewerMayApprove",
      }),
    ).toBe("reporter");
  });
  it("the reviewer may approve within appetite", () => {
    expect(approvalRefusal({ ...base, actorId: "u2", rule: "reviewerMayApprove" })).toBeNull();
  });
  it("within appetite the reviewer needs only risks.review, not risks.approve (spec §8.3)", () => {
    expect(
      approvalRefusal({
        ...base,
        actorId: "u2",
        actorHoldsApprove: false,
        actorHoldsReview: true,
        rule: "reviewerMayApprove",
      }),
    ).toBeNull();
  });
  it("a reviewer who no longer holds risks.review or risks.approve is notApprover", () => {
    expect(
      approvalRefusal({
        ...base,
        actorId: "u2",
        actorHoldsApprove: false,
        actorHoldsReview: false,
        rule: "reviewerMayApprove",
      }),
    ).toBe("notApprover");
  });
  it("the reviewer may not approve above appetite even holding risks.approve", () => {
    expect(approvalRefusal({ ...base, actorId: "u2", rule: "independentApprover" })).toBe(
      "reviewerNeedsIndependent",
    );
  });
  it("an approver who is neither reporter nor reviewer may approve", () => {
    expect(approvalRefusal({ ...base, rule: "independentApprover" })).toBeNull();
  });
  it("anyone else is notApprover, even holding risks.review", () => {
    expect(
      approvalRefusal({
        ...base,
        actorHoldsApprove: false,
        rule: "independentApprover",
      }),
    ).toBe("notApprover");
  });
});
