import { describe, expect, it } from "vitest";
import {
  DEFAULT_REVIEW_INTERVAL_MONTHS,
  MAX_REVIEW_INTERVAL_MONTHS,
  MIN_REVIEW_INTERVAL_MONTHS,
  isReviewDue,
  isoDateUtc,
  reviewDueDate,
} from "../src/index.js";

describe("review dates", () => {
  it("exposes interval bounds", () => {
    expect([MIN_REVIEW_INTERVAL_MONTHS, MAX_REVIEW_INTERVAL_MONTHS]).toEqual([1, 36]);
    expect(DEFAULT_REVIEW_INTERVAL_MONTHS).toBe(12);
  });
  it.each([
    ["2026-01-31T10:00:00Z", 1, "2026-02-28"],
    ["2028-01-31T00:00:00Z", 1, "2028-02-29"],
    ["2026-11-06T00:00:00Z", 12, "2027-11-06"],
    ["2026-08-31T00:00:00Z", 6, "2027-02-28"],
    ["2026-12-15T23:59:59Z", 1, "2027-01-15"],
  ])("reviewDueDate(%s, %i) = %s", (from, m, e) => {
    expect(reviewDueDate(new Date(from), m)).toBe(e);
  });
  it("isReviewDue compares dates", () => {
    expect(isReviewDue("2026-11-06", "2026-11-06")).toBe(true);
    expect(isReviewDue("2026-11-06", "2026-11-05")).toBe(false);
    expect(isReviewDue("2026-11-05", "2026-11-06")).toBe(true);
  });
  it("isoDateUtc formats in UTC", () => {
    expect(isoDateUtc(new Date("2026-11-06T23:59:59Z"))).toBe("2026-11-06");
  });
});
