import { describe, expect, it } from "vitest";
import { ControlListQuery } from "../src/index.js";

describe("ControlListQuery.framework", () => {
  it.each(["gdpr-2016-679", "iso27001-2022", "nist-csf-2.0", "nist-sp800-53-r5"])(
    "accepts %s",
    (framework) => {
      expect(ControlListQuery.safeParse({ framework }).success).toBe(true);
    },
  );

  it.each(["GDPR", "-gdpr", ".nist", "nist csf", "a/b", "a\u0000b", "a".repeat(101)])(
    "refuses %j",
    (framework) => {
      expect(ControlListQuery.safeParse({ framework }).success).toBe(false);
    },
  );
});
