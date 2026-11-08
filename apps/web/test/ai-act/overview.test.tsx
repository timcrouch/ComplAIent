// @vitest-environment jsdom
import type { OrganisationFrameworkDto } from "@isms/contracts";
import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AiActOverview } from "../../components/ai-act/overview";
import { frameworkHintFor } from "../../lib/ai-act-scope";
import en from "../../messages/index";
import { withMessages } from "../intl";
import { summary } from "./fixtures";

const t = en.aiAct.overview;

const systems = [
  summary({
    id: "a",
    name: "Credit scoring engine",
    riskClass: "high_risk",
    openObligationCount: 9,
  }),
  summary({ id: "b", name: "CV screening tool", riskClass: "high_risk", openObligationCount: 3 }),
  summary({ id: "c", name: "Service chatbot", riskClass: "limited_risk", openObligationCount: 2 }),
  summary({ id: "d", name: "Fraud detector", riskClass: "unclassified" }),
];

const framework = (key: string, status: "confirmed" | "suggested"): OrganisationFrameworkDto => ({
  id: key,
  frameworkVersionId: key,
  frameworkVersionKey: key,
  name: key,
  versionLabel: "",
  status,
  source: "manual",
  reasoning: null,
  confirmedBy: null,
  confirmedAt: null,
});

describe("AiActOverview", () => {
  it("counts unclassified systems, open high-risk obligations and systems by class", () => {
    withMessages(<AiActOverview systems={systems} canManage frameworkHint="none" />);
    const tile = (label: string) => screen.getByText(label).closest("li")?.textContent;
    expect(tile(t.unclassified)).toBe(`${t.unclassified}1`);
    // Only high-risk systems count: 9 + 3, not the chatbot's 2.
    expect(tile(t.openHighRisk)).toBe(`${t.openHighRisk}12`);
    const byClass = screen.getByRole("list", { name: t.byClass });
    expect(within(byClass).getByText(en.aiAct.classes.high_risk).closest("li")?.textContent).toBe(
      `${en.aiAct.classes.high_risk}2`,
    );
  });

  it("shows the register with name, role, status, class, owner and open obligations", () => {
    withMessages(<AiActOverview systems={systems} canManage frameworkHint="none" />);
    const table = screen.getByRole("table", { name: t.tableCaption });
    const headers = within(table)
      .getAllByRole("columnheader")
      .map((h) => h.textContent);
    expect(headers).toEqual(Object.values(t.columns));
    const row = within(table).getByRole("row", { name: /Credit scoring engine/ });
    expect(within(row).getByRole("link").getAttribute("href")).toBe("/ai-act/systems/a");
    expect(row.textContent).toContain(en.aiAct.roles.deployer);
    expect(row.textContent).toContain(en.aiAct.classes.high_risk);
    expect(row.textContent).toContain("Carl Ciso");
  });

  it("offers Add AI system only to people who manage AI systems", () => {
    const { unmount } = withMessages(
      <AiActOverview systems={systems} canManage frameworkHint="none" />,
    );
    expect(screen.getByRole("link", { name: t.add }).getAttribute("href")).toBe(
      "/ai-act/systems/new",
    );
    unmount();
    withMessages(<AiActOverview systems={systems} canManage={false} frameworkHint="none" />);
    expect(screen.queryByRole("link", { name: t.add })).toBeNull();
  });

  it("has an empty state that invites the first system", () => {
    withMessages(<AiActOverview systems={[]} canManage frameworkHint="none" />);
    expect(screen.getByRole("heading", { name: t.empty.title })).toBeTruthy();
    expect(screen.getByRole("link", { name: t.empty.add })).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("hints at Setup → Frameworks while the EU AI Act is not in scope", () => {
    withMessages(<AiActOverview systems={[]} canManage frameworkHint="link" />);
    expect(screen.getByText(t.frameworkHint)).toBeTruthy();
    expect(screen.getByRole("link", { name: t.frameworkHintLink }).getAttribute("href")).toBe(
      "/setup/frameworks",
    );
  });

  it("decides the hint from the confirmed frameworks and who may change them", () => {
    expect(frameworkHintFor([framework("eu-ai-act-2024-1689", "confirmed")], true)).toBe("none");
    expect(frameworkHintFor([framework("eu-ai-act-2024-1689", "suggested")], true)).toBe("link");
    expect(frameworkHintFor([framework("iso27001-2022", "confirmed")], false)).toBe("ask");
    expect(frameworkHintFor(null, true)).toBe("none");
  });
});
