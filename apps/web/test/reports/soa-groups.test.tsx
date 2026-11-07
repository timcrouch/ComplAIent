// @vitest-environment jsdom
import type { SoaGroupDto, SoaResponse, SoaRowDto } from "@isms/contracts";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SoaTable } from "../../components/reports/soa-table";
import { withMessages } from "../intl";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("../../lib/actions/reports", () => ({ setApplicability: vi.fn() }));
vi.mock("../../lib/navigate", () => ({ goTo: vi.fn() }));

const decision = {
  applicable: true,
  justification: "Because",
  decidedBy: "Anna Admin",
  decidedAt: "2026-11-05T10:00:00.000Z",
};
const row = (ref: string, groupKey: string | null, decided = false): SoaRowDto => ({
  requirementId: ref,
  ref,
  title: `Title of ${ref}`,
  fullText: null,
  decision: decided ? decision : null,
  hint: { kind: "unused" },
  controls: [],
  riskRefs: [],
  groupKey,
});
const group = (
  key: string,
  title: string,
  parentKey: string | null,
  decided: number,
  total: number,
): SoaGroupDto => ({ key, title, parentKey, decided, total });

const NIST = { key: "nist-csf-2.0", name: "NIST CSF", versionLabel: "2.0" };
const soa = (groups: SoaGroupDto[], rows: SoaRowDto[]): SoaResponse => ({
  generatedAt: "2026-11-06T10:00:00.000Z",
  generatedBy: "Anna",
  organisation: "Acme",
  scope: { kind: "organisation" },
  frameworks: [NIST],
  framework: NIST,
  groups,
  rows,
  canManage: true,
});

const nist = () =>
  soa(
    [
      group("GV", "Govern", null, 1, 3),
      group("GV.OC", "Organisational context", "GV", 1, 2),
      group("GV.RM", "Risk management strategy", "GV", 0, 1),
      group("ID", "Identify", null, 1, 1),
      group("ID.AM", "Asset management", "ID", 1, 1),
    ],
    [
      row("GV.OC-01", "GV.OC", true),
      row("GV.OC-02", "GV.OC"),
      row("GV.RM-01", "GV.RM"),
      row("ID.AM-01", "ID.AM", true),
    ],
  );

const render = (s: SoaResponse, onlyUndecided = false) =>
  withMessages(<SoaTable soa={s} onlyUndecided={onlyUndecided} timeZone="Europe/Riga" />);

/** The disclosure whose summary has this text. */
const disclosure = (text: string) => {
  const summary = screen.getByText(text).closest("summary");
  if (!summary?.parentElement) throw new Error(`no disclosure for ${text}`);
  return { summary, details: summary.parentElement as HTMLDetailsElement };
};

describe("SoaTable grouped by Function and Category", () => {
  it("shows each Function, then its Categories, open, with decided-of-total counts", () => {
    render(nist());
    expect(screen.getByText("2 of 4 decided")).toBeTruthy();
    const govern = disclosure("Govern · 1 of 3 decided");
    expect(govern.details.open).toBe(true);
    expect(within(govern.summary).getByText("GV")).toBeTruthy();
    const context = disclosure("Organisational context · 1 of 2 decided");
    expect(govern.details.contains(context.details)).toBe(true);
    expect(within(context.details).getByText("GV.OC-01")).toBeTruthy();
    expect(within(context.details).queryByText("GV.RM-01")).toBeNull();
    expect(disclosure("Risk management strategy · 0 of 1 decided").details.open).toBe(true);
    const identify = disclosure("Identify · 1 of 1 decided");
    expect(within(identify.details).getByText("ID.AM-01")).toBeTruthy();
    // One table per category, each named for screen readers.
    expect(screen.getAllByRole("table")).toHaveLength(3);
    expect(
      screen.getByRole("table", { name: "NIST CSF: GV.OC Organisational context" }),
    ).toBeTruthy();
  });

  it("collapses and expands a group from its summary (a native disclosure)", async () => {
    const user = userEvent.setup();
    render(nist());
    const govern = disclosure("Govern · 1 of 3 decided");
    // A native <summary>: focusable, and Enter or Space toggles it in browsers.
    expect(govern.summary.tagName).toBe("SUMMARY");
    expect(within(govern.summary).getByRole("heading", { level: 2 })).toBeTruthy();
    await user.click(govern.summary);
    expect(govern.details.open).toBe(false);
    await user.click(govern.summary);
    expect(govern.details.open).toBe(true);
  });

  it("with Only undecided, hides groups with nothing left, and keeps the counts", () => {
    render(nist(), true);
    expect(screen.queryByText("GV.OC-01")).toBeNull();
    expect(screen.getByText("GV.OC-02")).toBeTruthy();
    expect(screen.getByText("Organisational context · 1 of 2 decided")).toBeTruthy();
    expect(screen.getByText("Govern · 1 of 3 decided")).toBeTruthy();
    // Identify has no undecided requirement left.
    expect(screen.queryByText(/^Identify/)).toBeNull();
    expect(screen.queryByText("ID.AM-01")).toBeNull();
  });

  it("says so when every requirement is decided", () => {
    const s = nist();
    render({ ...s, rows: s.rows.map((r) => ({ ...r, decision })) }, true);
    expect(screen.getByText("Every requirement has a decision.")).toBeTruthy();
    expect(screen.queryByText(/^Govern/)).toBeNull();
  });
});

describe("SoaTable grouped by one level", () => {
  it("shows ISO Annex A themes without subgroups", () => {
    render(
      soa(
        [
          group("A.5", "Organisational controls", null, 1, 1),
          group("A.8", "Technological controls", null, 0, 1),
        ],
        [row("A.5.1", "A.5", true), row("A.8.1", "A.8")],
      ),
    );
    const org = disclosure("Organisational controls · 1 of 1 decided");
    expect(within(org.details).getByText("A.5.1")).toBeTruthy();
    expect(within(org.details).queryByText("A.8.1")).toBeNull();
    expect(org.details.querySelector(":scope details")).toBeNull();
    expect(disclosure("Technological controls · 0 of 1 decided").details.open).toBe(true);
  });

  it("shows requirements without a group under Other requirements, without its key", () => {
    render(
      soa(
        [
          group("A.5", "Organisational controls", null, 1, 1),
          group("_other", "Other requirements", null, 0, 1),
        ],
        [row("A.5.1", "A.5", true), row("OLD-1", "_other")],
      ),
    );
    const other = disclosure("Other requirements · 0 of 1 decided");
    expect(within(other.details).getByText("OLD-1")).toBeTruthy();
    expect(within(other.summary).queryByText("_other")).toBeNull();
  });

  it("renders a flat framework as one table without group headings", () => {
    render(soa([], [row("Art. 32", null), row("Art. 33", null, true)]));
    expect(screen.getAllByRole("table")).toHaveLength(1);
    expect(document.querySelectorAll("summary")).toHaveLength(0);
  });
});
