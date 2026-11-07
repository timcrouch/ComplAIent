// @vitest-environment jsdom
import type { RiskDetailDto } from "@isms/contracts";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RiskDetail } from "../../components/risks/risk-detail";
import en from "../../messages/index";
import { withMessages } from "../intl";
import { MUNICH, OWNERS, RIGA, RISK_ID, SCALE, ok, riskDetail } from "./fixtures";

const updateRisk = vi.fn();
vi.mock("../../lib/actions/risks", () => ({
  updateRisk: (...a: unknown[]) => updateRisk(...a) as unknown,
  getRisk: vi.fn(),
  requestControlSuggestions: vi.fn(),
  decideControl: vi.fn(),
  addControl: vi.fn(),
  removeControl: vi.fn(),
  searchControls: vi.fn(),
}));
vi.mock("../../lib/navigate", () => ({ goTo: vi.fn() }));

const t = en.risks;
const ti = en.insights;

function detail(risk: RiskDetailDto) {
  return withMessages(
    <RiskDetail
      initial={risk}
      scale={SCALE}
      sites={[RIGA, MUNICH]}
      departments={[]}
      owners={OWNERS.map((o) => ({ ...o, scopes: [...o.scopes] }))}
      evidenceMaxBytes={1000}
      canSearchLibrary
      timeZone="UTC"
    />,
  );
}

const scored = (o: Partial<RiskDetailDto> = {}) =>
  riskDetail({
    likelihood: 4,
    impact: 4,
    score: 16,
    aboveAppetite: true,
    treatment: "mitigate",
    residualLikelihood: 2,
    residualImpact: 2,
    residualScore: 4,
    residualAboveAppetite: false,
    ...o,
  });

const header = () => screen.getByTestId("risk-header");

beforeEach(() => {
  updateRisk.mockReset();
});

describe("expected score", () => {
  it("uses the server's residual score and appetite, not its own arithmetic", () => {
    detail(scored({ residualScore: 12, residualAboveAppetite: true }));
    const h = within(header());
    expect(h.getByText("Expected 12")).toBeTruthy();
    expect(h.getAllByText(ti.header.above)).toHaveLength(2);
  });

  it("shows Now and Expected with appetite in words", () => {
    detail(scored());
    const h = within(header());
    expect(h.getByText("Now 16")).toBeTruthy();
    expect(h.getByText("Expected 4")).toBeTruthy();
    expect(h.getByText(ti.header.above)).toBeTruthy();
    expect(h.getByText(ti.header.within)).toBeTruthy();
  });

  it("has no Expected part with only one residual field set", () => {
    detail(scored({ residualImpact: null, residualScore: null, residualAboveAppetite: null }));
    expect(within(header()).getByText("Now 16")).toBeTruthy();
    expect(within(header()).queryByText(/Expected/)).toBeNull();
  });

  it("says Accepted at 16 and hides the editor for an accepted risk", () => {
    detail(scored({ treatment: "accept", residualLikelihood: null, residualImpact: null }));
    expect(within(header()).getByText("Accepted at 16")).toBeTruthy();
    expect(within(header()).queryByText(/Expected/)).toBeNull();
    expect(screen.queryByRole("button", { name: /Edit .*Expected after treatment/ })).toBeNull();
  });

  it("offers the five level names and saves both fields", async () => {
    detail(scored({ residualLikelihood: null, residualImpact: null }));
    const treatment = screen.getByRole("region", { name: t.treatment.title });
    await userEvent.click(
      within(treatment).getByRole("button", { name: /Edit .*Expected after treatment/ }),
    );
    const likelihood = within(treatment).getByLabelText(ti.residual.likelihood);
    const names = within(likelihood)
      .getAllByRole("option")
      .map((o) => o.textContent);
    for (const l of SCALE.likelihood) expect(names.join("|")).toContain(l.label);
    expect(names).toHaveLength(6);
    await userEvent.selectOptions(likelihood, "2");
    await userEvent.selectOptions(within(treatment).getByLabelText(ti.residual.impact), "3");
    updateRisk.mockResolvedValue(
      ok(scored({ residualLikelihood: 2, residualImpact: 3, version: 3 })),
    );
    await userEvent.click(within(treatment).getByRole("button", { name: t.inline.save }));
    expect(updateRisk).toHaveBeenCalledWith(RISK_ID, 2, {
      residualLikelihood: 2,
      residualImpact: 3,
    });
  });

  it("shows the friendly message for a not-worse refusal", async () => {
    detail(scored());
    const treatment = screen.getByRole("region", { name: t.treatment.title });
    await userEvent.click(
      within(treatment).getByRole("button", { name: /Edit .*Expected after treatment/ }),
    );
    await userEvent.selectOptions(within(treatment).getByLabelText(ti.residual.likelihood), "5");
    updateRisk.mockResolvedValue({
      ok: false,
      kind: "invalid",
      details: [{ path: "changes.residualLikelihood", message: "x" }],
    });
    await userEvent.click(within(treatment).getByRole("button", { name: t.inline.save }));
    expect(await within(treatment).findByText(ti.residual.notWorse)).toBeTruthy();
  });
});
