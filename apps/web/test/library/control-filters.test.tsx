// @vitest-environment jsdom
import type { ControlListQuery, FrameworkVersionDto } from "@isms/contracts";
import { act, fireEvent, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ControlFilters } from "../../components/library/control-filters";
import en from "../../messages/index";
import { clickLink, MARK, marked, withMessages } from "../intl";

vi.mock("next/form", () => ({ default: (props: ComponentProps<"form">) => <form {...props} /> }));
const push = vi.fn();
const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace }) }));

const t = en.library;
const OPTS = { scroll: false };

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
    key: "nist-csf-2.0",
    frameworkKey: "nist-csf",
    name: "NIST CSF",
    versionLabel: "2.0",
    summary: "",
    requirementCount: 106,
  },
];

const render = (query: Partial<ControlListQuery> = {}, messages: unknown = en) =>
  withMessages(<ControlFilters frameworks={frameworks} query={query} />, messages);
const select = (label: string) => screen.getByLabelText<HTMLSelectElement>(label);
const searchBox = () => screen.getByRole<HTMLInputElement>("searchbox", { name: t.searchLabel });

beforeEach(() => {
  push.mockReset();
  replace.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("ControlFilters, without JavaScript", () => {
  it("one GET form still submits the search and every filter", () => {
    render({
      q: "A.8.13",
      framework: "nist-csf-2.0",
      review: "unreviewed",
      category: "resilience",
      inUse: "true",
    });
    const search = screen.getByRole("search", { name: t.searchLabel });
    // next/form renders no method attribute: a form without one submits with GET.
    expect(search.getAttribute("method") ?? "get").toBe("get");
    expect(search.getAttribute("action")).toBe("/library");
    const q = within(search).getByRole<HTMLInputElement>("searchbox", { name: t.searchLabel });
    expect([q.name, q.value, q.type]).toEqual(["q", "A.8.13", "search"]);
    expect(within(search).getByRole("button", { name: t.search }).getAttribute("type")).toBe(
      "submit",
    );
    // The filters sit in their own bar, outside the search box, but belong to the same form.
    const values = [t.framework, t.review, t.category, t.inUse].map((label) => {
      const el = select(label);
      expect(search.contains(el)).toBe(false);
      expect(el.form).toBe(search);
      return [el.name, el.value];
    });
    expect(values).toEqual([
      ["framework", "nist-csf-2.0"],
      ["review", "unreviewed"],
      ["category", "resilience"],
      ["inUse", "true"],
    ]);
  });

  it("offers every framework, status, category and in-use choice", () => {
    render();
    expect([...select(t.framework).options].map((o) => o.text)).toEqual([
      t.anyFramework,
      "ISO/IEC 27001 2022",
      "NIST CSF 2.0",
    ]);
    expect([...select(t.review).options].map((o) => o.value)).toEqual([
      "all",
      "unreviewed",
      "reviewed",
    ]);
    expect(select(t.category).options).toHaveLength(13);
    expect([...select(t.inUse).options].map((o) => [o.value, o.textContent])).toEqual([
      ["", t.inUseAny],
      ["true", t.inUseYes],
      ["false", t.inUseNo],
    ]);
  });

  it("the filter bar is a labelled group", () => {
    render();
    const bar = screen.getByRole("group", { name: t.filters });
    expect(within(bar).getByLabelText(t.framework)).toBeTruthy();
  });
});

describe("ControlFilters, applying filters", () => {
  it("a filter change navigates at once, keeping the search and the other filters", () => {
    render({ q: "backup", review: "unreviewed" });
    const framework = select(t.framework);
    framework.focus();
    fireEvent.change(framework, { target: { value: "nist-csf-2.0" } });
    expect(push).toHaveBeenCalledWith(
      "/library?q=backup&framework=nist-csf-2.0&review=unreviewed",
      OPTS,
    );
    // Focus stays on the control that changed.
    expect(document.activeElement).toBe(framework);
  });

  it("every filter change is its own history entry, even in quick succession", () => {
    render({});
    fireEvent.change(select(t.framework), { target: { value: "iso27001-2022" } });
    fireEvent.change(select(t.category), { target: { value: "resilience" } });
    expect(push).toHaveBeenCalledTimes(2);
    expect(replace).not.toHaveBeenCalled();
  });

  it("choosing 'any' again drops the filter from the URL", () => {
    render({ category: "resilience" });
    fireEvent.change(select(t.category), { target: { value: "" } });
    expect(push).toHaveBeenCalledWith("/library", OPTS);
  });

  it("a filter change also takes the search typed but not yet applied", () => {
    vi.useFakeTimers();
    render({});
    fireEvent.change(searchBox(), { target: { value: "crisis" } });
    fireEvent.change(select(t.inUse), { target: { value: "true" } });
    expect(push).toHaveBeenCalledWith("/library?q=crisis&inUse=true", OPTS);
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    // The pending search was part of that navigation; nothing else follows.
    expect(replace).not.toHaveBeenCalled();
  });

  it("follows the URL when it changes from outside (Back, a link)", () => {
    const view = render({ framework: "nist-csf-2.0", q: "one" });
    view.rerender(
      <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
        <ControlFilters frameworks={frameworks} query={{ framework: "iso27001-2022", q: "two" }} />
      </NextIntlClientProvider>,
    );
    expect(select(t.framework).value).toBe("iso27001-2022");
    expect(searchBox().value).toBe("two");
  });
});

describe("ControlFilters, searching", () => {
  it("applies the search after a short pause in typing, replacing the history entry", () => {
    vi.useFakeTimers();
    render({ framework: "iso27001-2022" });
    const box = searchBox();
    box.focus();
    fireEvent.change(box, { target: { value: "ba" } });
    act(() => {
      vi.advanceTimersByTime(200);
    });
    fireEvent.change(box, { target: { value: "backup" } });
    act(() => {
      vi.advanceTimersByTime(299);
    });
    expect(replace).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(replace).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledWith("/library?q=backup&framework=iso27001-2022", OPTS);
    expect(push).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(box);
  });

  it("does not navigate when the typing ends where it started", () => {
    vi.useFakeTimers();
    render({ q: "backup" });
    fireEvent.change(searchBox(), { target: { value: "backup " } });
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(replace).not.toHaveBeenCalled();
  });

  it("Enter or Search applies the search within the filters straight away", () => {
    vi.useFakeTimers();
    render({ category: "access" });
    fireEvent.change(searchBox(), { target: { value: "ACC-01" } });
    fireEvent.submit(screen.getByRole("search", { name: t.searchLabel }));
    expect(push).toHaveBeenCalledWith("/library?q=ACC-01&category=access", OPTS);
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(replace).not.toHaveBeenCalled();
  });
});

describe("ControlFilters, repeated search", () => {
  it("Enter on the search already shown adds no history entry", () => {
    render({ q: "backup", category: "access" });
    fireEvent.submit(screen.getByRole("search", { name: t.searchLabel }));
    expect(push).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });
});

describe("ControlFilters, active filters", () => {
  it("shows nothing to clear when no filter is on", () => {
    render({ q: "backup" });
    expect(screen.queryByRole("list", { name: t.activeFilters })).toBeNull();
    expect(screen.queryByRole("link", { name: t.clearFilters })).toBeNull();
  });

  it("shows each active filter as a chip that removes only that filter", () => {
    render({ q: "backup", framework: "nist-csf-2.0", category: "resilience" });
    const chips = within(screen.getByRole("list", { name: t.activeFilters }));
    const framework = chips.getByRole("link", { name: "Remove Framework: NIST CSF 2.0" });
    expect(framework.textContent).toBe("Framework: NIST CSF 2.0");
    // A real link, so it works without JavaScript too.
    expect(framework.getAttribute("href")).toBe("/library?q=backup&category=resilience");
    expect(chips.getByRole("link", { name: "Remove Category: Resilience" })).toBeTruthy();

    clickLink(framework);
    expect(push).toHaveBeenCalledWith("/library?q=backup&category=resilience", OPTS);
    // The chip goes away; focus lands on the filter it came from.
    expect(document.activeElement).toBe(select(t.framework));
  });

  it("names review and in-use chips in words", () => {
    render({ review: "reviewed", inUse: "false" });
    const chips = within(screen.getByRole("list", { name: t.activeFilters }));
    expect(chips.getByRole("link", { name: `Remove Review status: ${t.reviewReviewed}` }));
    expect(chips.getByRole("link", { name: `Remove In use: ${t.inUseNo}` }));
  });

  it("Clear filters resets every filter and keeps the search", () => {
    render({ q: "backup", framework: "nist-csf-2.0", review: "unreviewed" });
    const clear = screen.getByRole("link", { name: t.clearFilters });
    expect(clear.getAttribute("href")).toBe("/library?q=backup");
    clickLink(clear);
    expect(push).toHaveBeenCalledWith("/library?q=backup", OPTS);
    expect(document.activeElement).toBe(select(t.framework));
  });

  it("takes every visible string from en.json", () => {
    render({ framework: "nist-csf-2.0" }, marked(en));
    expect(screen.getByRole("link", { name: `${t.clearFilters}${MARK}` })).toBeTruthy();
    expect(screen.getByRole("group").textContent).toContain(`${t.filtersHint}${MARK}`);
  });
});
