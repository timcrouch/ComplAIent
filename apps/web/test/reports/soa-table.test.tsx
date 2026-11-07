// @vitest-environment jsdom
import type { SoaResponse, SoaRowDto } from "@isms/contracts";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SoaTable as Table } from "../../components/reports/soa-table";
import { SoaToolbar } from "../../components/reports/soa-toolbar";
import { withMessages } from "../intl";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));
const setApplicability = vi.fn();
vi.mock("../../lib/actions/reports", () => ({
  setApplicability: (...a: unknown[]) => setApplicability(...a) as unknown,
}));
vi.mock("../../lib/navigate", () => ({ goTo: vi.fn() }));

const SoaTable = ({
  soa,
  onlyUndecided = false,
}: {
  soa: SoaResponse;
  onlyUndecided?: boolean;
}) => <Table soa={soa} onlyUndecided={onlyUndecided} timeZone="Europe/Riga" />;

const ID = "0b9f5f4e-5d0a-4c55-9a43-9a4f7f0d1c2e";
const row = (over: Partial<SoaRowDto>): SoaRowDto => ({
  requirementId: ID,
  ref: "A.5.1",
  title: "Policies for information security",
  fullText: null,
  decision: null,
  hint: { kind: "unused" },
  controls: [],
  riskRefs: [],
  groupKey: null,
  ...over,
});
const decision = (applicable: boolean) => ({
  applicable,
  justification: "Because we say so",
  decidedBy: "Anna Admin",
  decidedAt: "2026-11-05T10:00:00.000Z",
});
const FW = { key: "iso27001-2022", name: "ISO/IEC 27001", versionLabel: "2022" };
const soa = (rows: SoaRowDto[], canManage = false): SoaResponse => ({
  generatedAt: "2026-11-06T10:00:00.000Z",
  generatedBy: "Anna",
  organisation: "Acme",
  scope: { kind: "organisation" },
  frameworks: [FW, { key: "nis2", name: "NIS2", versionLabel: "2022" }],
  framework: FW,
  groups: [],
  rows,
  canManage,
});

beforeEach(() => {
  setApplicability.mockReset();
  refresh.mockReset();
});

describe("SoaTable rendering", () => {
  it("shows applicability words, justification and the summary", () => {
    withMessages(
      <SoaTable
        soa={soa([
          row({ requirementId: "a", ref: "A.1", decision: decision(true) }),
          row({ requirementId: "b", ref: "A.2", decision: decision(false) }),
          row({ requirementId: "c", ref: "A.3" }),
        ])}
      />,
    );
    expect(screen.getByText("2 of 3 decided")).toBeTruthy();
    const rows = screen.getAllByRole("row") as [HTMLElement, HTMLElement, HTMLElement, HTMLElement];
    expect(within(rows[1]).getByText("Applicable")).toBeTruthy();
    expect(within(rows[1]).getByText("Because we say so")).toBeTruthy();
    expect(within(rows[2]).getByText("Not applicable")).toBeTruthy();
    expect(within(rows[3]).getByText("Not decided yet")).toBeTruthy();
  });

  it.each([
    ["implementedTested", "Implemented and tested"],
    ["implementedNotTested", "Implemented, not tested"],
    ["implementedIneffective", "Implemented, not effective"],
    ["notImplemented", "Not implemented"],
  ] as const)("shows control status %s in words", (status, words) => {
    withMessages(
      <SoaTable soa={soa([row({ controls: [{ code: "RES-01", title: "Backups", status }] })])} />,
    );
    expect(screen.getByText(/RES-01/)).toBeTruthy();
    expect(screen.getByText(words)).toBeTruthy();
  });

  it("words the hint, with hidden risks", () => {
    withMessages(
      <SoaTable
        soa={soa([
          row({
            requirementId: "a",
            hint: { kind: "used", refs: ["R-0003", "R-0007"], hiddenCount: 0 },
          }),
          row({ requirementId: "b", hint: { kind: "used", refs: ["R-0001"], hiddenCount: 2 } }),
          row({ requirementId: "c", hint: { kind: "used", refs: [], hiddenCount: 1 } }),
          row({ requirementId: "d" }),
        ])}
      />,
    );
    expect(screen.getByText("Used by R-0003, R-0007")).toBeTruthy();
    expect(screen.getByText("Used by R-0001, and 2 risks outside your scope")).toBeTruthy();
    expect(screen.getByText("Used by 1 risk outside your scope")).toBeTruthy();
    expect(screen.getByText("No risk uses its controls yet")).toBeTruthy();
  });

  it("shows full text in details only when present, and risk references", () => {
    withMessages(
      <SoaTable
        soa={soa([
          row({ requirementId: "a", fullText: "The licensed text.", riskRefs: ["R-0003"] }),
          row({ requirementId: "b", ref: "A.9" }),
        ])}
      />,
    );
    expect(screen.getAllByText(/Full requirement text/)).toHaveLength(1);
    expect(screen.getByText("The licensed text.")).toBeTruthy();
    expect(screen.getByText("R-0003")).toBeTruthy();
  });

  it("shows only undecided rows when the URL asks", () => {
    withMessages(
      <SoaTable
        onlyUndecided
        soa={soa([
          row({ requirementId: "a", ref: "A.1", decision: decision(true) }),
          row({ requirementId: "b", ref: "A.2" }),
        ])}
      />,
    );
    expect(screen.queryByText("A.1")).toBeNull();
    expect(screen.getByText("A.2")).toBeTruthy();
    expect(screen.getByText("1 of 2 decided")).toBeTruthy();
  });

  it("shows decision dates in the viewer's time zone", () => {
    withMessages(
      <SoaTable
        soa={soa([row({ decision: { ...decision(true), decidedAt: "2026-11-05T23:30:00.000Z" } })])}
      />,
    );
    expect(screen.getByText("Decided by Anna Admin on 6 November 2026")).toBeTruthy();
  });

  it("has no edit buttons without canManage", () => {
    withMessages(<SoaTable soa={soa([row({})])} />);
    expect(screen.queryByRole("button", { name: /Edit/ })).toBeNull();
  });
});

describe("applicability dialog", () => {
  async function open() {
    const user = userEvent.setup();
    withMessages(<SoaTable soa={soa([row({})], true)} />);
    await user.click(screen.getByRole("button", { name: "Edit applicability of A.5.1" }));
    return user;
  }

  it("requires a choice and a justification", async () => {
    const user = await open();
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("group", { name: /apply to your organisation/ })).toBeTruthy();
    await user.click(within(dialog).getByRole("button", { name: "Save decision" }));
    expect(within(dialog).getByText("Choose Applicable or Not applicable.")).toBeTruthy();
    await user.click(within(dialog).getByRole("radio", { name: "Not applicable" }));
    await user.click(within(dialog).getByRole("button", { name: "Save decision" }));
    expect(within(dialog).getByText(/justification of 1 to 2000/)).toBeTruthy();
    expect(document.activeElement).toBe(within(dialog).getByRole("textbox"));
    expect(setApplicability).not.toHaveBeenCalled();
  });

  it("saves through the action, closes and refreshes", async () => {
    setApplicability.mockResolvedValue({ ok: true, data: row({ decision: decision(false) }) });
    const user = await open();
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("radio", { name: "Not applicable" }));
    await user.type(within(dialog).getByRole("textbox"), "  We do not develop software  ");
    await user.click(within(dialog).getByRole("button", { name: "Save decision" }));
    await waitFor(() => {
      expect(setApplicability).toHaveBeenCalledWith(ID, {
        applicable: false,
        justification: "We do not develop software",
      });
    });
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    expect(refresh).toHaveBeenCalled();
  });

  it("shows a refusal and stays open; a stale one offers a reload", async () => {
    setApplicability.mockResolvedValueOnce({ ok: false, kind: "forbidden", details: [] });
    const user = await open();
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("radio", { name: "Applicable" }));
    await user.type(within(dialog).getByRole("textbox"), "Yes");
    await user.click(within(dialog).getByRole("button", { name: "Save decision" }));
    expect(await within(dialog).findByText(/don't have permission/)).toBeTruthy();
    setApplicability.mockResolvedValueOnce({ ok: false, kind: "not-found", details: [] });
    await user.click(within(dialog).getByRole("button", { name: "Save decision" }));
    await user.click(await within(dialog).findByRole("button", { name: "Reload" }));
    expect(refresh).toHaveBeenCalled();
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
  });

  it("returns focus to the edit button on close", async () => {
    const user = await open();
    await screen.findByRole("dialog");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => {
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: "Edit applicability of A.5.1" }),
      );
    });
  });
});

describe("SoaToolbar", () => {
  const fws = [FW, { key: "nis2", name: "NIS2", versionLabel: "2022" }];

  it("keeps the filter in framework links and the framework in the filter link", () => {
    withMessages(<SoaToolbar frameworks={fws} framework={FW} undecided={false} />);
    expect(screen.getByRole("link", { name: /NIS2/ }).getAttribute("href")).toBe(
      "/reports/soa?framework=nis2",
    );
    expect(screen.getByRole("link", { name: /ISO\/IEC 27001/ }).getAttribute("aria-current")).toBe(
      "page",
    );
    expect(screen.getByRole("link", { name: "Only undecided" }).getAttribute("href")).toBe(
      "/reports/soa?framework=iso27001-2022&undecided=1",
    );
  });

  it("carries undecided on, and offers downloads of the shown framework", () => {
    withMessages(<SoaToolbar frameworks={fws} framework={FW} undecided />);
    expect(screen.getByRole("link", { name: /NIS2/ }).getAttribute("href")).toBe(
      "/reports/soa?framework=nis2&undecided=1",
    );
    expect(screen.getByRole("link", { name: "Only undecided" }).getAttribute("href")).toBe(
      "/reports/soa?framework=iso27001-2022",
    );
    expect(screen.getByRole("link", { name: "Download as Excel" }).getAttribute("href")).toBe(
      "/reports/files/soa.xlsx?framework=iso27001-2022",
    );
    expect(screen.getByRole("link", { name: "Download as PDF" }).getAttribute("href")).toBe(
      "/reports/files/soa.pdf?framework=iso27001-2022",
    );
  });

  it("still shows the picker when no framework is selected, without filter or downloads", () => {
    withMessages(<SoaToolbar frameworks={fws} framework={null} undecided={false} />);
    expect(screen.getAllByRole("link")).toHaveLength(2);
  });
});
