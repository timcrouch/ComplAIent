import { controlOperationRoutes, libraryRoutes } from "@isms/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/server-api", () => ({ callApi: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const requestHeaders = new Headers();
vi.mock("next/headers", () => ({ headers: () => Promise.resolve(requestHeaders) }));

const { callApi } = await import("../lib/server-api");
const { revalidatePath } = await import("next/cache");
const { recordControlTest, reviewMapping, suggestTestSteps } =
  await import("../lib/actions/library");

const MAPPING = "3f1c2a3b-4d5e-4f60-8a71-b2c3d4e5f607";

beforeEach(() => {
  vi.mocked(callApi).mockReset();
  vi.mocked(revalidatePath).mockReset();
  requestHeaders.delete("x-isms-path");
});

describe("reviewMapping", () => {
  it("marks the mapping through the API, returning to the control after a new sign-in", async () => {
    requestHeaders.set("x-isms-path", "/library/RES-01");
    vi.mocked(callApi).mockResolvedValue({ ok: true, data: {} as never });
    expect(await reviewMapping(MAPPING)).toEqual({ ok: true, data: {} });
    expect(callApi).toHaveBeenCalledWith(
      libraryRoutes.reviewMapping,
      { params: { mappingId: MAPPING } },
      { returnTo: "/library/RES-01" },
    );
    expect(revalidatePath).toHaveBeenCalledWith("/library", "layout");
  });

  it("returns to the library when the page path is missing or unsafe", async () => {
    vi.mocked(callApi).mockResolvedValue({ ok: true, data: {} as never });
    await reviewMapping(MAPPING);
    requestHeaders.set("x-isms-path", "//evil.test/x");
    await reviewMapping(MAPPING);
    requestHeaders.set("x-isms-path", "/setup/people");
    await reviewMapping(MAPPING);
    for (const call of vi.mocked(callApi).mock.calls) {
      expect(call[2]).toEqual({ returnTo: "/library" });
    }
  });

  it("refuses a malformed id without calling the API, and revalidates only on success", async () => {
    expect(await reviewMapping("../x")).toMatchObject({ ok: false, kind: "invalid" });
    expect(callApi).not.toHaveBeenCalled();
    vi.mocked(callApi).mockResolvedValue({ ok: false, kind: "forbidden", details: [] });
    expect(await reviewMapping(MAPPING)).toMatchObject({ ok: false, kind: "forbidden" });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe("recordControlTest", () => {
  const body = {
    testedOn: "2026-11-05",
    result: "effective" as const,
    method: "Checked the access list.",
    notes: "",
    evidenceIds: [],
  };

  it("records the test through the API and refreshes the library", async () => {
    requestHeaders.set("x-isms-path", "/library/RES-01");
    vi.mocked(callApi).mockResolvedValue({ ok: true, data: {} as never });
    await recordControlTest("RES-01", body);
    expect(callApi).toHaveBeenCalledWith(
      controlOperationRoutes.recordTest,
      { params: { code: "RES-01" }, body },
      { returnTo: "/library/RES-01" },
    );
    expect(revalidatePath).toHaveBeenCalledWith("/library", "layout");
  });

  it("refuses a bad code or an empty method without calling the API", async () => {
    expect(await recordControlTest("../x", body)).toMatchObject({ ok: false, kind: "invalid" });
    expect(await recordControlTest("RES-01", { ...body, method: " " })).toMatchObject({
      ok: false,
      kind: "invalid",
    });
    expect(callApi).not.toHaveBeenCalled();
  });
});

describe("suggestTestSteps", () => {
  it("asks the API for steps and stores nothing", async () => {
    requestHeaders.set("x-isms-path", "/library/RES-01");
    vi.mocked(callApi).mockResolvedValue({ ok: true, data: {} as never });
    await suggestTestSteps("RES-01");
    expect(callApi).toHaveBeenCalledWith(
      controlOperationRoutes.suggestTestSteps,
      { params: { code: "RES-01" } },
      { returnTo: "/library/RES-01" },
    );
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("refuses a bad code without calling the API", async () => {
    expect(await suggestTestSteps("nope")).toMatchObject({ kind: "invalid" });
    expect(callApi).not.toHaveBeenCalled();
  });
});
