import { riskLifecycleRoutes, treatmentRoutes } from "@isms/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RISK_ID } from "./fixtures";

vi.mock("../../lib/server-api", () => ({ callApi: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { callApi } = await import("../../lib/server-api");
const { revalidatePath } = await import("next/cache");
const actions = await import("../../lib/actions/risks");

const TASK = "4d5e6f7a-8b9c-4d0e-9f2a-3b4c5d6e7f8a";
const PERSON = "3c4d5e6f-7a8b-4c9d-8e1f-2a3b4c5d6e7f";
const RETURN = { returnTo: `/risks/${RISK_ID}` };
const params = { params: { id: RISK_ID } };

beforeEach(() => {
  vi.mocked(callApi)
    .mockReset()
    .mockResolvedValue({ ok: true, data: {} as never });
  vi.mocked(revalidatePath).mockReset();
});

describe("lifecycle actions", () => {
  it("closes, reassesses and confirms with the version and a trimmed note", async () => {
    await actions.closeRisk(RISK_ID, 3, " Done ");
    expect(callApi).toHaveBeenCalledWith(
      riskLifecycleRoutes.close,
      { ...params, body: { expectedVersion: 3, note: "Done" } },
      RETURN,
    );
    await actions.reassessRisk(RISK_ID, 4, "New site");
    expect(callApi).toHaveBeenCalledWith(
      riskLifecycleRoutes.reassess,
      { ...params, body: { expectedVersion: 4, reason: "New site" } },
      RETURN,
    );
    await actions.confirmReview(RISK_ID, 5, "");
    expect(callApi).toHaveBeenCalledWith(
      riskLifecycleRoutes.confirmReview,
      { ...params, body: { expectedVersion: 5, note: "" } },
      RETURN,
    );
    expect(revalidatePath).toHaveBeenCalledWith("/risks", "layout");
  });

  it("refuses an empty close note before calling the API", async () => {
    expect(await actions.closeRisk(RISK_ID, 3, "  ")).toMatchObject({ ok: false, kind: "invalid" });
    expect(callApi).not.toHaveBeenCalled();
  });

  it("adds, completes and cancels actions", async () => {
    const input = {
      title: "Fit locks",
      description: "",
      assigneeId: PERSON,
      dueDate: "2026-12-01",
      controlId: null,
    };
    await actions.addTreatmentAction(RISK_ID, input);
    expect(callApi).toHaveBeenCalledWith(
      treatmentRoutes.addAction,
      { ...params, body: input },
      RETURN,
    );
    await actions.completeTask(TASK, "Fitted");
    expect(callApi).toHaveBeenCalledWith(
      treatmentRoutes.complete,
      { params: { id: TASK }, body: { note: "Fitted" } },
      { returnTo: "/tasks" },
    );
    await actions.cancelTask(TASK, "Not needed");
    expect(callApi).toHaveBeenCalledWith(
      treatmentRoutes.cancel,
      { params: { id: TASK }, body: { reason: "Not needed" } },
      { returnTo: "/tasks" },
    );
  });

  it("lists a map cell with includeClosed as the string the API takes", async () => {
    await actions.listRisks("all", undefined, {
      likelihood: 2,
      impact: 3,
      basis: "inherent",
      includeClosed: false,
    });
    expect(callApi).toHaveBeenCalledWith(
      expect.anything(),
      { query: { filter: "all", likelihood: 2, impact: 3, basis: "inherent" } },
      { returnTo: "/risks" },
    );
    await actions.listRisks("all", undefined, {
      likelihood: 2,
      impact: 3,
      basis: "inherent",
      includeClosed: true,
    });
    expect(callApi).toHaveBeenLastCalledWith(
      expect.anything(),
      {
        query: {
          filter: "all",
          likelihood: 2,
          impact: 3,
          basis: "inherent",
          includeClosed: "true",
        },
      },
      { returnTo: "/risks" },
    );
  });
});
