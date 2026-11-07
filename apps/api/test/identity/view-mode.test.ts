import type { Role, ViewMode } from "@isms/contracts";
import { describe, expect, it } from "vitest";
import { defaultViewMode } from "../../src/identity/view-mode.js";

describe("defaultViewMode", () => {
  it.each<[Role[], ViewMode]>([
    [[], "guided"],
    [["contributor"], "guided"],
    [["viewer"], "guided"],
    [["administrator"], "professional"],
    [["ciso"], "professional"],
    [["risk_owner"], "professional"],
    [["risk_approver"], "professional"],
    [["auditor"], "professional"],
    [["contributor", "ciso"], "professional"],
  ])("defaultViewMode(%j) is %s", (roles, expected) => {
    expect(defaultViewMode(roles)).toBe(expected);
  });
});
