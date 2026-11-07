// @vitest-environment jsdom
import type { ControlSummaryDto, FrameworkVersionDto } from "@isms/contracts";
import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ControlList, ReviewSummaryBadge } from "../components/library/control-list";
import LibraryLoading from "../app/(app)/library/loading";
import en from "../messages/index";
import { MARK, marked, withMessages } from "./intl";

const t = en.library;

const frameworks: FrameworkVersionDto[] = [
  {
    id: "v1",
    key: "iso27001-2022",
    frameworkKey: "iso27001",
    name: "ISO/IEC 27001",
    versionLabel: "2022",
    summary: "",
    requirementCount: 93,
  },
  {
    id: "v2",
    key: "nis2-2022-2555",
    frameworkKey: "nis2",
    name: "NIS2",
    versionLabel: "2022/2555",
    summary: "",
    requirementCount: 10,
  },
];

const control = (over: Partial<ControlSummaryDto>): ControlSummaryDto => ({
  code: "RES-01",
  title: "Back-ups you can restore",
  category: "resilience",
  frameworks: ["iso27001-2022", "nis2-2022-2555"],
  mappings: { total: 2, reviewed: 1 },
  inUse: false,
  latestResult: null,
  ...over,
});

describe("ControlList", () => {
  it("shows review status as an icon and words, never colour alone", () => {
    withMessages(
      <ControlList
        items={[
          control({}),
          control({
            code: "RES-02",
            title: "Tested recovery",
            mappings: { total: 3, reviewed: 3 },
          }),
          control({
            code: "RES-03",
            title: "Not mapped",
            frameworks: [],
            mappings: { total: 0, reviewed: 0 },
          }),
        ]}
        frameworks={frameworks}
      />,
    );
    // Cards are the top-level list; each card lists its frameworks in a nested list.
    const [cardList] = screen.getAllByRole("list");
    const [card1, card2, card3, ...rest] = [...(cardList?.children ?? [])] as HTMLElement[];
    if (!card1 || !card2 || !card3) throw new Error("expected three cards");
    expect(rest).toHaveLength(0);

    const first = within(card1);
    const link = first.getByRole("link", { name: /Back-ups you can restore/ });
    expect(link.getAttribute("href")).toBe("/library/RES-01");
    expect(first.getByText("RES-01")).toBeTruthy();
    expect(first.getByText("ISO/IEC 27001")).toBeTruthy();
    expect(first.getByText("NIS2")).toBeTruthy();
    const partial = first.getByText("1 of 2 mappings reviewed").closest("[data-slot=status-badge]");
    expect(partial?.getAttribute("data-status")).toBe("attention");
    expect(partial?.querySelector("svg")).toBeTruthy();

    const all = within(card2).getByText(t.allReviewed).closest("[data-slot=status-badge]");
    expect(all?.getAttribute("data-status")).toBe("ok");
    expect(all?.querySelector("svg")).toBeTruthy();

    // No mappings is not "all reviewed": nothing was checked.
    expect(within(card3).queryByText(/mappings? reviewed$/)).toBeNull();
    expect(within(card3).queryByText(t.allReviewed)).toBeNull();
    expect(within(card3).getByText(t.noMappings)).toBeTruthy();
  });

  it("announces the number of results", () => {
    withMessages(<ControlList items={[control({})]} frameworks={frameworks} />);
    expect(screen.getByRole("status").textContent).toBe("1 control");
  });

  it("counts the matches out of the whole library once the list is narrowed", () => {
    withMessages(<ControlList items={[control({})]} total={99} frameworks={frameworks} />);
    expect(screen.getByRole("status").textContent).toBe("1 of 99 controls");
  });

  it("says plainly when nothing matches", () => {
    withMessages(<ControlList items={[]} frameworks={frameworks} />);
    expect(screen.queryByRole("list")).toBeNull();
    expect(screen.getByRole("status").textContent).toBe("0 controls");
    expect(screen.getByText(t.empty)).toBeTruthy();
    expect(screen.getByRole("link", { name: t.clear }).getAttribute("href")).toBe("/library");
  });

  it("takes every visible string from en.json", () => {
    withMessages(<ControlList items={[control({})]} frameworks={frameworks} />, marked(en));
    expect(screen.getByRole("status").textContent.endsWith(MARK)).toBe(true);
    expect(screen.getByText(`1 of 2 mappings reviewed${MARK}`)).toBeTruthy();
  });
});

describe("ControlList in operation", () => {
  it("says each control's latest test result in words", () => {
    withMessages(
      <ControlList
        items={[
          control({ code: "A-1", title: "One", inUse: true, latestResult: "effective" }),
          control({ code: "A-2", title: "Two", inUse: true, latestResult: "partially_effective" }),
          control({ code: "A-3", title: "Three", inUse: true, latestResult: "ineffective" }),
          control({ code: "A-4", title: "Four", inUse: true }),
          control({ code: "A-5", title: "Five" }),
        ]}
        frameworks={frameworks}
      />,
    );
    const row = (title: string) => screen.getByText(title).closest("li") as HTMLElement;
    expect(within(row("One")).getByText(t.operation.results.effective)).toBeTruthy();
    expect(within(row("Two")).getByText(t.operation.results.partially_effective)).toBeTruthy();
    expect(within(row("Three")).getByText(t.operation.results.ineffective)).toBeTruthy();
    expect(within(row("Four")).getByText(t.operation.notTestedYet)).toBeTruthy();
    expect(within(row("Five")).queryByText(t.operation.notTestedYet)).toBeNull();
  });
});

describe("LibraryLoading", () => {
  it("is a busy skeleton with a name and no numbers", () => {
    withMessages(<LibraryLoading />);
    const status = screen.getByRole("status", { name: t.loading });
    expect(status.getAttribute("aria-busy")).toBe("true");
    expect(status.textContent).toBe(t.loading);
  });
});

describe("ReviewSummaryBadge", () => {
  it("counts one mapping in the singular", () => {
    withMessages(<ReviewSummaryBadge mappings={{ total: 1, reviewed: 0 }} />);
    expect(screen.getByText("0 of 1 mapping reviewed")).toBeTruthy();
  });
});
