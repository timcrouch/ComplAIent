import { organisationRoutes } from "@isms/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/server-api", () => ({ callApi: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { callApi } = await import("../../lib/server-api");
const { revalidatePath } = await import("next/cache");
const { updateConcernRewards } = await import("../../lib/actions/concern-rewards");

beforeEach(() => {
  vi.mocked(callApi).mockReset();
  vi.mocked(revalidatePath).mockReset();
});

describe("concern rewards settings action", () => {
  it("validates, saves with a step-up return path and revalidates the page", async () => {
    vi.mocked(callApi).mockResolvedValue({ ok: true, data: { enabled: true } } as never);
    expect(await updateConcernRewards({ enabled: true })).toEqual({
      ok: true,
      data: { enabled: true },
    });
    expect(callApi).toHaveBeenCalledWith(
      organisationRoutes.setConcernRewards,
      { body: { enabled: true } },
      { returnTo: "/settings/concern-reporting" },
    );
    expect(revalidatePath).toHaveBeenCalledWith("/settings/concern-reporting", "layout");
  });

  it("rejects a malformed value without calling the API", async () => {
    expect(await updateConcernRewards({ enabled: "yes" as never })).toMatchObject({
      ok: false,
      kind: "invalid",
      details: [{ path: "enabled" }],
    });
    expect(callApi).not.toHaveBeenCalled();
  });
});
