import { reportRoutes } from "@isms/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/server-api", () => ({ callApi: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const { callApi } = await import("../lib/server-api");
const { revalidatePath } = await import("next/cache");
const { setApplicability, draftNarrative, approveNarrative } =
  await import("../lib/actions/reports");

const ID = "3f1c2a3b-4d5e-4f60-8a71-b2c3d4e5f607";
beforeEach(() => {
  vi.mocked(callApi).mockReset();
  vi.mocked(revalidatePath).mockReset();
});

describe("setApplicability", () => {
  it("calls the API and revalidates the reports", async () => {
    vi.mocked(callApi).mockResolvedValue({ ok: true, data: {} as never });
    await setApplicability(ID, { applicable: true, justification: "Needed" });
    expect(callApi).toHaveBeenCalledWith(
      reportRoutes.setApplicability,
      { params: { requirementId: ID }, body: { applicable: true, justification: "Needed" } },
      { returnTo: "/reports/soa" },
    );
    expect(revalidatePath).toHaveBeenCalledWith("/reports", "layout");
  });

  it("refuses bad input without calling the API", async () => {
    expect(await setApplicability("x", { applicable: true, justification: "a" })).toMatchObject({
      kind: "invalid",
    });
    expect(await setApplicability(ID, { applicable: true, justification: "  " })).toMatchObject({
      kind: "invalid",
    });
    expect(callApi).not.toHaveBeenCalled();
  });
});

describe("board narrative actions", () => {
  const INTERACTION = "5d3c8c1e-6b0a-4f4e-9a43-0f2b3a9d6c11";
  it("asks for a draft for the period", async () => {
    vi.mocked(callApi).mockResolvedValue({ ok: true, data: {} as never });
    await draftNarrative("2026-Q3");
    expect(callApi).toHaveBeenCalledWith(
      reportRoutes.narrativeDraft,
      { body: { period: "2026-Q3" } },
      { returnTo: "/reports/board" },
    );
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("approves the text and revalidates the reports", async () => {
    vi.mocked(callApi).mockResolvedValue({ ok: true, data: {} as never });
    await approveNarrative({ period: "2026-Q3", text: "Stable.", interactionId: INTERACTION });
    expect(callApi).toHaveBeenCalledWith(
      reportRoutes.approveNarrative,
      { body: { period: "2026-Q3", text: "Stable.", interactionId: INTERACTION } },
      { returnTo: "/reports/board" },
    );
    expect(revalidatePath).toHaveBeenCalledWith("/reports", "layout");
  });

  it("refuses bad input without calling the API", async () => {
    expect(await draftNarrative("x".repeat(30))).toMatchObject({ kind: "invalid" });
    expect(
      await approveNarrative({ period: "2026-Q3", text: "  ", interactionId: null }),
    ).toMatchObject({ kind: "invalid" });
    expect(callApi).not.toHaveBeenCalled();
  });
});
