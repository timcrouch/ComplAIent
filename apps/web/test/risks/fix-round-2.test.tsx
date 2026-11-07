// @vitest-environment jsdom
import type { RiskDetailDto } from "@isms/contracts";
import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RiskDetail } from "../../components/risks/risk-detail";
import en from "../../messages/index";
import { withMessages } from "../intl";
import { CARL, RIGA, RISK_ID, SCALE, conflict, control, ok, riskDetail } from "./fixtures";

const updateRisk = vi.fn();
const getRisk = vi.fn();
const removeControl = vi.fn();
vi.mock("../../lib/actions/risks", () => ({
  updateRisk: (...a: unknown[]) => updateRisk(...a) as unknown,
  getRisk: (...a: unknown[]) => getRisk(...a) as unknown,
  requestControlSuggestions: vi.fn(),
  decideControl: vi.fn(),
  addControl: vi.fn(),
  removeControl: (...a: unknown[]) => removeControl(...a) as unknown,
  searchControls: vi.fn(),
}));
vi.mock("../../lib/navigate", () => ({ goTo: vi.fn() }));

const t = en.risks;
const pending = { status: "pending" as const, failure: null };
const AC = "0a000000-0000-4000-8000-000000000001";

function detail(risk: RiskDetailDto) {
  return withMessages(
    <RiskDetail
      initial={risk}
      scale={SCALE}
      sites={[RIGA]}
      departments={[]}
      owners={null}
      evidenceMaxBytes={1000}
      canSearchLibrary={false}
      timeZone="UTC"
    />,
  );
}

const record = () => screen.getByRole("region", { name: t.record.title });

async function openTitle() {
  await userEvent.click(within(record()).getByRole("button", { name: "Edit Title" }));
}

async function saveTitle(text: string) {
  const title = within(record()).getByLabelText(t.record.fields.title);
  await userEvent.clear(title);
  await userEvent.type(title, text);
  const form = title.closest("form");
  if (!form) throw new Error("no form");
  await userEvent.click(within(form).getByRole("button", { name: t.inline.save }));
}

beforeEach(() => {
  for (const fn of [updateRisk, getRisk, removeControl]) fn.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Fix round 2: an open editor's base version", () => {
  it("advances with this page's own save of another field", async () => {
    detail(riskDetail());
    await openTitle();
    await userEvent.click(
      within(record()).getByRole("button", { name: "Edit What could cause it" }),
    );
    updateRisk.mockResolvedValueOnce(ok(riskDetail({ threat: "Car thieves", version: 3 })));
    const threat = within(record()).getByLabelText(t.record.fields.threat);
    await userEvent.clear(threat);
    await userEvent.type(threat, "Car thieves");
    const threatForm = threat.closest("form");
    if (!threatForm) throw new Error("no form");
    await userEvent.click(within(threatForm).getByRole("button", { name: t.inline.save }));
    expect(updateRisk).toHaveBeenLastCalledWith(RISK_ID, 2, { threat: "Car thieves" });

    updateRisk.mockResolvedValueOnce(ok(riskDetail({ title: "Mine", version: 4 })));
    await saveTitle("Mine");
    expect(updateRisk).toHaveBeenLastCalledWith(RISK_ID, 3, { title: "Mine" });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("advances with this page's own control action", async () => {
    const accepted = control({ id: AC, status: "accepted", decidedBy: CARL });
    detail(riskDetail({ controls: [accepted] }));
    await openTitle();
    removeControl.mockResolvedValue(ok(riskDetail({ version: 3, controls: [] })));
    await userEvent.click(screen.getByRole("button", { name: "Remove AST-01" }));
    expect(removeControl).toHaveBeenCalledWith(RISK_ID, AC, 2);

    updateRisk.mockResolvedValue(ok(riskDetail({ title: "Mine", version: 4 })));
    await saveTitle("Mine");
    expect(updateRisk).toHaveBeenLastCalledWith(RISK_ID, 3, { title: "Mine" });
  });

  it("does not advance with a background refresh bringing someone else's change", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    detail(riskDetail({ controlSuggestion: pending }));
    await openTitle();
    getRisk.mockResolvedValue(
      ok(riskDetail({ title: "Changed elsewhere", version: 5, controlSuggestion: pending })),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    updateRisk.mockResolvedValue(conflict("staleVersion"));
    await saveTitle("Mine");
    expect(updateRisk).toHaveBeenLastCalledWith(RISK_ID, 2, { title: "Mine" });
    expect((await screen.findByRole("alert")).textContent).toContain(t.stale.message);
  });
});
