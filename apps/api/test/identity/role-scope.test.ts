import { describe, expect, it } from "vitest";
import { toRoleAssignmentDto } from "../../src/identity/role-scope.js";

const A = "0193a0c0-0000-7000-8000-00000000000a";
const B = "0193a0c0-0000-7000-8000-00000000000b";

describe("toRoleAssignmentDto", () => {
  it.each([
    [
      { scopeType: "ORGANISATION", siteId: null, departmentId: null },
      { type: "organisation", id: null },
    ],
    [
      { scopeType: "SITE", siteId: A, departmentId: null },
      { type: "site", id: A },
    ],
    [
      { scopeType: "DEPARTMENT", siteId: null, departmentId: B },
      { type: "department", id: B },
    ],
  ] as const)("maps %j", (scope, expected) => {
    expect(toRoleAssignmentDto({ role: "ciso", ...scope })).toEqual({
      role: "ciso",
      scope: expected,
    });
  });
});
