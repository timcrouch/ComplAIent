import { concernRoutes, riskRoutes } from "@isms/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CONVERSATION_ID, RIGA } from "./fixtures";

vi.mock("../../lib/server-api", () => ({ callApi: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { callApi } = await import("../../lib/server-api");
const { revalidatePath } = await import("next/cache");
const { getConcern, replyToConcern, reportRisk, startConcern, submitConcern } =
  await import("../../lib/actions/report");

const RETURN = { returnTo: "/report" };
const params = { params: { id: CONVERSATION_ID } };
const input = {
  title: "Laptops in cars",
  scenario: "Laptops are left in unlocked cars.",
  threat: "Theft",
  consequence: "Customer data is exposed",
  existingSafeguards: "",
  assets: [{ name: "Laptops", type: "device" as const }],
  siteId: RIGA.id,
  departmentId: null,
  toConfirm: [],
};

beforeEach(() => {
  vi.mocked(callApi)
    .mockReset()
    .mockResolvedValue({ ok: true, data: {} as never });
  vi.mocked(revalidatePath).mockReset();
});

describe("report actions", () => {
  it("start, reply and read the conversation through the API", async () => {
    await startConcern("  Laptops in cars ");
    expect(callApi).toHaveBeenCalledWith(
      concernRoutes.start,
      { body: { text: "Laptops in cars" } },
      RETURN,
    );
    await replyToConcern(CONVERSATION_ID, "Not sure", true);
    expect(callApi).toHaveBeenCalledWith(
      concernRoutes.reply,
      { ...params, body: { text: "Not sure", notSure: true } },
      RETURN,
    );
    await getConcern(CONVERSATION_ID);
    expect(callApi).toHaveBeenCalledWith(concernRoutes.get, params, RETURN);
  });

  it("reports through the conversation or the form and refreshes your concerns", async () => {
    await submitConcern(CONVERSATION_ID, input);
    expect(callApi).toHaveBeenCalledWith(concernRoutes.submit, { ...params, body: input }, RETURN);
    await reportRisk(input);
    expect(callApi).toHaveBeenCalledWith(riskRoutes.report, { body: input }, RETURN);
    expect(revalidatePath).toHaveBeenCalledWith("/concerns", "layout");
  });

  it("never sends an AI estimate, and refuses bad input without calling the API", async () => {
    const withEstimate = {
      ...input,
      aiEstimate: { likelihood: 5, impact: 5, reasoning: "x" },
    };
    expect(await submitConcern(CONVERSATION_ID, withEstimate as never)).toMatchObject({
      ok: false,
      kind: "invalid",
    });
    expect(await reportRisk({ ...input, title: "" })).toMatchObject({
      ok: false,
      kind: "invalid",
      details: [{ path: "title" }],
    });
    expect(await startConcern("   ")).toMatchObject({
      ok: false,
      kind: "invalid",
    });
    expect(await getConcern("not-a-uuid")).toMatchObject({
      ok: false,
      kind: "not-found",
    });
    expect(callApi).not.toHaveBeenCalled();
  });
});
