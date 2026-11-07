import { peopleRoutes } from "@isms/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/server-api", () => ({ callApi: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { callApi } = await import("../lib/server-api");
const { revalidatePath } = await import("next/cache");
const { grantRole, revokeRole } = await import("../lib/actions/roles");

const USER = "0b9f5f4e-5d0a-4c55-9a43-9a4f7f0d1c2e";
const ASSIGNMENT = "6f1c2a3b-4d5e-4f60-8a71-b2c3d4e5f607";
const grant = { role: "ciso", scope: { type: "organisation", id: null } } as const;

beforeEach(() => {
  vi.mocked(callApi).mockReset();
  vi.mocked(revalidatePath).mockReset();
});

describe("role actions", () => {
  it("grant and revoke through the API, returning to the people step for a step-up", async () => {
    vi.mocked(callApi).mockResolvedValue({ ok: true, data: {} as never });
    await grantRole(USER, grant);
    expect(callApi).toHaveBeenCalledWith(
      peopleRoutes.grantRole,
      { params: { userId: USER }, body: grant },
      { returnTo: "/setup/people" },
    );
    await revokeRole(ASSIGNMENT);
    expect(callApi).toHaveBeenCalledWith(
      peopleRoutes.revokeRole,
      { params: { assignmentId: ASSIGNMENT } },
      { returnTo: "/setup/people" },
    );
    expect(revalidatePath).toHaveBeenCalledTimes(2);
    expect(revalidatePath).toHaveBeenCalledWith("/setup", "layout");
  });

  it("refuse malformed ids or a site scope without a site, without calling the API", async () => {
    expect(await grantRole("not-a-uuid", grant)).toMatchObject({ ok: false, kind: "invalid" });
    const noSite = { role: "ciso", scope: { type: "site", id: null } } as never;
    expect(await grantRole(USER, noSite)).toMatchObject({
      ok: false,
      kind: "invalid",
      details: [{ path: "scope.id" }],
    });
    expect(await revokeRole("../x")).toMatchObject({ ok: false, kind: "invalid" });
    expect(callApi).not.toHaveBeenCalled();
  });

  it("pass the step-up redirect through unchanged and do not revalidate", async () => {
    const reauth = {
      ok: false as const,
      kind: "reauth" as const,
      details: [],
      href: "/auth/login?returnTo=%2Fsetup%2Fpeople&stepUp=1",
    };
    vi.mocked(callApi).mockResolvedValue(reauth);
    expect(await grantRole(USER, grant)).toEqual(reauth);
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
