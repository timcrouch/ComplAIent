// @vitest-environment jsdom
import type { RiskDetailDto } from "@isms/contracts";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RiskDetail } from "../../components/risks/risk-detail";
import en from "../../messages/index";
import { withMessages } from "../intl";
import { CARL, MUNICH, OWNERS, RIGA, RISK_ID, SCALE, conflict, ok, riskDetail } from "./fixtures";

const updateRisk = vi.fn();
const getRisk = vi.fn();
vi.mock("../../lib/actions/risks", () => ({
  updateRisk: (...a: unknown[]) => updateRisk(...a) as unknown,
  getRisk: (...a: unknown[]) => getRisk(...a) as unknown,
  requestControlSuggestions: vi.fn(),
  decideControl: vi.fn(),
  addControl: vi.fn(),
  removeControl: vi.fn(),
  searchControls: vi.fn(),
}));
vi.mock("../../lib/navigate", () => ({ goTo: vi.fn() }));

const t = en.risks;

function detail(risk: RiskDetailDto = riskDetail()) {
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

const section = (name: string) => screen.getByRole("region", { name });

beforeEach(() => {
  updateRisk.mockReset();
  getRisk.mockReset();
});

describe("RiskDetail", () => {
  it("shows the header with reference, state, version and the AI-assisted badge", () => {
    detail();
    expect(
      screen.getByRole("heading", { level: 1, name: "Laptops left in unlocked cars" }),
    ).toBeTruthy();
    expect(screen.getByText("R-0001")).toBeTruthy();
    expect(screen.getByText(t.state.proposed)).toBeTruthy();
    expect(within(screen.getByTestId("risk-header")).getByText("Version 2")).toBeTruthy();
    expect(screen.getByText(t.header.aiAssisted).closest("[data-slot=ai-badge]")).toBeTruthy();
    expect(screen.getByRole("link", { name: t.header.conversation }).getAttribute("href")).toBe(
      `/risks/${RISK_ID}/conversation`,
    );
  });

  it("shows the record as a description list: quiet labels, values, system text for gaps", () => {
    detail();
    const record = section(t.record.title);
    const title = within(record).getByText(t.record.fields.title, { selector: "dt" });
    expect(title.tagName).toBe("DT");
    expect(title.className).toContain("text-label");
    const value = title.nextElementSibling as HTMLElement;
    expect(value.tagName).toBe("DD");
    expect(within(value).getByText("Laptops left in unlocked cars").className).toContain(
      "font-value-short",
    );
    expect(
      within(value).getByRole("button", { name: `${t.inline.edit} ${t.record.fields.title}` }),
    ).toBeTruthy();
    const owner = within(record).getByText(t.record.fields.owner, { selector: "dt" })
      .nextElementSibling as HTMLElement;
    expect(within(owner).getByText(t.record.noOwner).getAttribute("data-empty")).toBe("true");
    const safeguards = within(record).getByText(t.record.fields.existingSafeguards, {
      selector: "dt",
    }).nextElementSibling as HTMLElement;
    expect(within(safeguards).getByText(t.inline.empty).getAttribute("data-empty")).toBe("true");
  });

  it("opens the editor in place inside the record's list and returns to the value", async () => {
    detail();
    const user = userEvent.setup();
    const record = section(t.record.title);
    const name = `${t.inline.edit} ${t.record.fields.title}`;
    await user.click(within(record).getByRole("button", { name }));
    const input = within(record).getByLabelText(t.record.fields.title);
    expect(input.closest("form")?.closest("dd")?.closest("dl")).toBeTruthy();
    // The term stays for assistive tech; the form shows its own visible label.
    expect(within(record).getByText(t.record.fields.title, { selector: "dt" }).className).toBe(
      "sr-only",
    );
    await user.keyboard("{Escape}");
    expect(within(record).getByRole("button", { name })).toBe(document.activeElement);
    expect(
      within(record).getByText(t.record.fields.title, { selector: "dt" }).className,
    ).not.toContain("sr-only");
  });

  it("hides the conversation link when the transcript may not be read", () => {
    detail(riskDetail({ can: { ...riskDetail().can, readTranscript: false } }));
    expect(screen.queryByRole("link", { name: t.header.conversation })).toBeNull();
  });

  it("treatment options show plain words with the correct term underneath", async () => {
    detail();
    const treatment = section(t.treatment.title);
    await userEvent.click(within(treatment).getByRole("button", { name: /Edit .*handle/ }));
    const group = within(treatment).getByRole("radiogroup", { name: t.treatment.fieldLabel });
    const names = within(group)
      .getAllByRole("radio")
      .map((r) => r.closest("label")?.textContent);
    expect(names).toEqual([
      "Fix the problem (avoid)",
      "Reduce the risk (mitigate)",
      "Transfer responsibility (transfer)",
      "Accept the risk with approval (accept)",
    ]);
    // The term sits on its own line beneath the plain words.
    const term = within(group).getByText("(mitigate)");
    expect(term.previousElementSibling?.textContent).toBe("Reduce the risk");
    updateRisk.mockResolvedValue(ok(riskDetail({ treatment: "mitigate", version: 3 })));
    await userEvent.click(within(group).getByRole("radio", { name: /Reduce the risk/ }));
    await userEvent.click(within(treatment).getByRole("button", { name: t.inline.save }));
    expect(updateRisk).toHaveBeenCalledWith(RISK_ID, 2, { treatment: "mitigate" });
    await screen.findByText("Version 3");
  });

  it("the AI estimate is labelled and never fills the official fields by itself", async () => {
    detail();
    const assessment = section(t.assessment.title);
    const estimate = within(assessment).getByTestId("ai-estimate");
    expect(
      within(estimate).getByText(t.assessment.ai.badge).closest("[data-slot=ai-badge]"),
    ).toBeTruthy();
    expect(estimate.textContent).toContain("Cars are often left unlocked.");
    expect(estimate.textContent).toContain("3 – Possible");
    expect(estimate.textContent).toContain("4 – Major");
    // The official figures stay empty until a person sets them.
    const official = within(assessment).getByTestId("official-assessment");
    const unset = within(official).getAllByText(t.assessment.notSet);
    expect(unset).toHaveLength(2);
    for (const el of unset) expect(el.getAttribute("data-empty")).toBe("true");
    expect(within(official).getByText(t.assessment.score).tagName).toBe("DT");
    // The score follows from the levels, so no divider separates them.
    expect(official.querySelector("dl")?.className).not.toMatch(/divide-y(?!-0)/);
    await userEvent.click(within(assessment).getByRole("button", { name: /Edit/ }));
    expect(
      within(assessment).getByLabelText<HTMLSelectElement>(t.assessment.likelihood).value,
    ).toBe("");
    expect(within(assessment).getByLabelText<HTMLSelectElement>(t.assessment.impact).value).toBe(
      "",
    );
    await userEvent.click(within(assessment).getByRole("button", { name: t.inline.cancel }));
    expect(updateRisk).not.toHaveBeenCalled();

    // Using it is an ordinary edit a person makes.
    updateRisk.mockResolvedValue(
      ok(riskDetail({ likelihood: 3, impact: 4, score: 12, aboveAppetite: true, version: 3 })),
    );
    await userEvent.click(within(assessment).getByRole("button", { name: t.assessment.ai.use }));
    expect(updateRisk).toHaveBeenCalledWith(RISK_ID, 2, { likelihood: 3, impact: 4 });
    await waitFor(() => {
      expect(official.textContent).toContain("12 out of 25");
    });
    expect(within(official).getByText(t.score.aboveAppetite)).toBeTruthy();
    expect(screen.getByTestId("risk-announcer").textContent).toBe(t.assessment.ai.used);
  });

  it("a stale save shows the reload message", async () => {
    updateRisk.mockResolvedValue(conflict("staleVersion"));
    getRisk.mockResolvedValue(ok(riskDetail({ title: "Changed elsewhere", version: 5 })));
    detail();
    const record = section(t.record.title);
    await userEvent.click(within(record).getByRole("button", { name: "Edit Title" }));
    const title = within(record).getByLabelText(t.record.fields.title);
    await userEvent.clear(title);
    await userEvent.type(title, "Laptops in cars");
    await userEvent.click(within(record).getByRole("button", { name: t.inline.save }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain(t.stale.message);
    await userEvent.click(within(alert).getByRole("button", { name: t.stale.reload }));
    expect(getRisk).toHaveBeenCalledWith(RISK_ID);
    await screen.findByRole("heading", { level: 1, name: "Changed elsewhere" });
    expect(screen.getByText("Version 5")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    // Focus goes back to the field's edit button, never to the page.
    expect(document.activeElement).toBe(within(record).getByRole("button", { name: "Edit Title" }));
  });

  it("returns focus to the edit button after save and after cancel", async () => {
    detail();
    const record = section(t.record.title);
    const edit = () => within(record).getByRole("button", { name: "Edit What could cause it" });
    await userEvent.click(edit());
    const input = within(record).getByLabelText(t.record.fields.threat);
    expect(document.activeElement).toBe(input);
    await userEvent.keyboard("{Escape}");
    expect(document.activeElement).toBe(edit());

    updateRisk.mockResolvedValue(ok(riskDetail({ threat: "Car thieves", version: 3 })));
    await userEvent.click(edit());
    await userEvent.clear(within(record).getByLabelText(t.record.fields.threat));
    await userEvent.type(within(record).getByLabelText(t.record.fields.threat), "Car thieves");
    await userEvent.click(within(record).getByRole("button", { name: t.inline.save }));
    expect(updateRisk).toHaveBeenCalledWith(RISK_ID, 2, { threat: "Car thieves" });
    await waitFor(() => {
      expect(document.activeElement).toBe(edit());
    });
    expect(record.textContent).toContain("Car thieves");
    expect(screen.getByTestId("risk-announcer").textContent).toBe(
      `${t.record.fields.threat} saved.`,
    );
  });

  it("offers only eligible owners and shows an owner refusal in words", async () => {
    updateRisk.mockResolvedValue({
      ok: false,
      kind: "invalid",
      details: [{ path: "changes.ownerId", message: "x" }],
    });
    detail();
    const record = section(t.record.title);
    await userEvent.click(within(record).getByRole("button", { name: "Edit Owner" }));
    const select = within(record).getByLabelText<HTMLSelectElement>(t.record.fields.owner);
    const options = [...select.options].map((o) => o.textContent);
    // Olga owns risks at Munich only; this one is at Riga.
    expect(options).toEqual([t.record.noOwner, CARL.displayName]);
    await userEvent.selectOptions(select, CARL.displayName);
    await userEvent.click(within(record).getByRole("button", { name: t.inline.save }));
    expect(updateRisk).toHaveBeenCalledWith(RISK_ID, 2, { ownerId: CARL.id });
    expect(await within(record).findByText(t.errors.owner)).toBeTruthy();
    expect(select.getAttribute("aria-invalid")).toBe("true");
  });

  it("resolves a to-confirm item by editing the list, keeping focus in the section", async () => {
    updateRisk.mockResolvedValue(ok(riskDetail({ toConfirm: ["Is the car park fenced?"] })));
    detail();
    const list = screen.getByRole("list", { name: t.toConfirm.listLabel });
    const first = within(list).getAllByRole("button", { name: /Resolved/ })[0];
    if (!first) throw new Error("no item");
    await userEvent.click(first);
    expect(updateRisk).toHaveBeenCalledWith(RISK_ID, 2, { toConfirm: ["Is the car park fenced?"] });
    await waitFor(() => {
      expect(within(list).getAllByRole("listitem")).toHaveLength(1);
    });
    expect(document.activeElement).toBe(within(list).getByRole("button", { name: /Resolved/ }));
  });

  it("shows no edit controls when the risk may not be edited", () => {
    detail(riskDetail({ can: { ...riskDetail().can, edit: false } }));
    expect(screen.queryByRole("button", { name: /^Edit/ })).toBeNull();
    expect(screen.queryByRole("button", { name: t.assessment.ai.use })).toBeNull();
    expect(screen.queryByRole("button", { name: t.controls.suggest })).toBeNull();
  });

  it("offers no Suggest controls while the AI cannot suggest; the library search stays", () => {
    detail(riskDetail({ can: { ...riskDetail().can, suggestControls: false } }));
    expect(screen.queryByRole("button", { name: t.controls.suggest })).toBeNull();
    expect(screen.getByLabelText(t.picker.label)).toBeTruthy();
  });

  it("names the expected-score fields in the history", () => {
    detail(
      riskDetail({
        history: [
          {
            version: 2,
            changedFields: ["residualLikelihood", "residualImpact"],
            changedBy: CARL,
            at: "2026-11-05T10:00:00.000Z",
          },
        ],
      }),
    );
    const text = screen.getByRole("list", { name: t.history.listLabel }).textContent;
    expect(text).toContain("Changed: expected likelihood and expected impact");
    expect(text).not.toContain("other details");
  });

  it("lists the history with who, when and the changed fields", () => {
    detail();
    const history = screen.getByRole("list", { name: t.history.listLabel });
    const items = within(history).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0]?.textContent).toContain("Version 2");
    expect(items[0]?.textContent).toContain("Carl Ciso · 5 November 2026");
    expect(items[0]?.textContent).toContain("Changed: title");
    expect(items[1]?.textContent).toContain(t.history.reported);
  });
});
