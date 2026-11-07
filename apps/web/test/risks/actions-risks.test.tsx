import { evidenceRoutes, libraryRoutes, riskRoutes } from "@isms/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RISK_ID } from "./fixtures";

vi.mock("../../lib/server-api", () => ({ callApi: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { callApi } = await import("../../lib/server-api");
const { revalidatePath } = await import("next/cache");
const actions = await import("../../lib/actions/risks");

const RC = "5e6f7a8b-9c0d-4e1f-8a3b-4c5d6e7f8a9b";
const RETURN = { returnTo: `/risks/${RISK_ID}` };
const params = { params: { id: RISK_ID } };

beforeEach(() => {
  vi.mocked(callApi)
    .mockReset()
    .mockResolvedValue({ ok: true, data: {} as never });
  vi.mocked(revalidatePath).mockReset();
});

describe("risk actions", () => {
  it("lists and reads risks", async () => {
    await actions.listRisks("toReview", "abc");
    expect(callApi).toHaveBeenCalledWith(
      riskRoutes.list,
      { query: { filter: "toReview", cursor: "abc" } },
      { returnTo: "/risks" },
    );
    await actions.getRisk(RISK_ID);
    expect(callApi).toHaveBeenCalledWith(riskRoutes.get, params, RETURN);
  });

  it("edits with the expected version and refreshes the risk pages", async () => {
    await actions.updateRisk(RISK_ID, 3, { likelihood: 3, impact: 4 });
    expect(callApi).toHaveBeenCalledWith(
      riskRoutes.update,
      { ...params, body: { expectedVersion: 3, changes: { likelihood: 3, impact: 4 } } },
      RETURN,
    );
    expect(revalidatePath).toHaveBeenCalledWith("/risks", "layout");
  });

  it("sends the control calls", async () => {
    await actions.requestControlSuggestions(RISK_ID, 2);
    expect(callApi).toHaveBeenCalledWith(
      riskRoutes.requestSuggestions,
      { ...params, body: { expectedVersion: 2 } },
      RETURN,
    );
    await actions.decideControl(RISK_ID, RC, 2, "reject", "Not needed");
    expect(callApi).toHaveBeenCalledWith(
      riskRoutes.decideControl,
      {
        params: { id: RISK_ID, riskControlId: RC },
        body: { expectedVersion: 2, decision: "reject", reason: "Not needed" },
      },
      RETURN,
    );
    await actions.decideControl(RISK_ID, RC, 2, "accept", "  ");
    expect(callApi).toHaveBeenLastCalledWith(
      riskRoutes.decideControl,
      {
        params: { id: RISK_ID, riskControlId: RC },
        body: { expectedVersion: 2, decision: "accept" },
      },
      RETURN,
    );
    await actions.addControl(RISK_ID, 2, "OPS-03");
    expect(callApi).toHaveBeenCalledWith(
      riskRoutes.addControl,
      { ...params, body: { expectedVersion: 2, controlCode: "OPS-03" } },
      RETURN,
    );
    await actions.removeControl(RISK_ID, RC, 2);
    expect(callApi).toHaveBeenCalledWith(
      riskRoutes.removeControl,
      { params: { id: RISK_ID, riskControlId: RC }, body: { expectedVersion: 2 } },
      RETURN,
    );
    await actions.searchControls(" backup ");
    expect(callApi).toHaveBeenCalledWith(
      libraryRoutes.listControls,
      { query: { q: "backup" } },
      { returnTo: "/risks" },
    );
  });

  it("refuses bad input without calling the API", async () => {
    expect(await actions.getRisk("not-a-uuid")).toMatchObject({ ok: false, kind: "not-found" });
    expect(await actions.updateRisk(RISK_ID, 1, { likelihood: 9 })).toMatchObject({
      ok: false,
      kind: "invalid",
    });
    expect(await actions.addControl(RISK_ID, 1, "nope")).toMatchObject({
      ok: false,
      kind: "invalid",
    });
    expect(await actions.listRisks("everything" as never, undefined)).toMatchObject({
      ok: false,
      kind: "invalid",
    });
    expect(callApi).not.toHaveBeenCalled();
  });

  it("submits, approves and returns with the expected version, and refreshes the risk pages", async () => {
    await actions.submitRisk(RISK_ID, 4);
    expect(callApi).toHaveBeenCalledWith(
      riskRoutes.submit,
      { ...params, body: { expectedVersion: 4 } },
      RETURN,
    );
    await actions.approveRisk(RISK_ID, 5, "  ");
    expect(callApi).toHaveBeenCalledWith(
      riskRoutes.approve,
      { ...params, body: { expectedVersion: 5 } },
      RETURN,
    );
    await actions.approveRisk(RISK_ID, 5, " Fine ");
    expect(callApi).toHaveBeenCalledWith(
      riskRoutes.approve,
      { ...params, body: { expectedVersion: 5, comment: "Fine" } },
      RETURN,
    );
    await actions.returnRisk(RISK_ID, 5, "Owner is wrong");
    expect(callApi).toHaveBeenCalledWith(
      riskRoutes.return,
      { ...params, body: { expectedVersion: 5, comment: "Owner is wrong" } },
      RETURN,
    );
    expect(revalidatePath).toHaveBeenCalledWith("/risks", "layout");
    vi.mocked(callApi).mockClear();
    expect(await actions.returnRisk(RISK_ID, 5, "  ")).toMatchObject({
      ok: false,
      kind: "invalid",
    });
    expect(callApi).not.toHaveBeenCalled();
  });

  it("requests evidence for an accepted control", async () => {
    const input = {
      assigneeId: RC,
      controlId: RC,
      title: " Restore test ",
      description: "The report",
      dueDate: null,
    };
    await actions.requestEvidence(RISK_ID, input);
    expect(callApi).toHaveBeenCalledWith(
      evidenceRoutes.requestEvidence,
      { ...params, body: { ...input, title: "Restore test" } },
      RETURN,
    );
    vi.mocked(callApi).mockClear();
    expect(await actions.requestEvidence(RISK_ID, { ...input, title: "" })).toMatchObject({
      ok: false,
      kind: "invalid",
    });
    expect(callApi).not.toHaveBeenCalled();
  });
});
