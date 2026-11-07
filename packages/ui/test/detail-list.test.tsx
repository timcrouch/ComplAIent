import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { axe } from "vitest-axe";
import { DetailItem, DetailList, cn, tokens } from "../src/index";

const axeOptions = { rules: { "color-contrast": { enabled: false } } };

function value(label: string): HTMLElement {
  const dd = screen.getByText(label).closest("dt")?.nextElementSibling;
  if (!(dd instanceof HTMLElement)) throw new Error(`no value for ${label}`);
  return dd;
}

describe("DetailList", () => {
  it("renders a description list of label (dt) and value (dd) pairs", async () => {
    const { container } = render(
      <DetailList>
        <DetailItem label="Site">Munich</DetailItem>
        <DetailItem label="What could happen" emphasis="long">
          Someone could steal laptops.
        </DetailItem>
      </DetailList>,
    );
    const dl = container.querySelector("dl");
    expect(dl).not.toBeNull();
    const terms = [...container.querySelectorAll("dt")].map((d) => d.textContent);
    expect(terms).toEqual(["Site", "What could happen"]);
    expect(value("Site").tagName).toBe("DD");
    expect(value("Site").textContent).toBe("Munich");
    expect((await axe(container, axeOptions)).violations).toEqual([]);
  });

  it("styles labels with the quiet label token and values with the value token", () => {
    render(
      <DetailList>
        <DetailItem label="Owner">Ida Ipsum</DetailItem>
      </DetailList>,
    );
    const dt = screen.getByText("Owner");
    expect(dt.className).toContain("text-label");
    expect(dt.className).toContain("text-fg-muted");
    expect(dt.className).not.toContain("font-semibold");
    expect(dt.className).not.toContain("uppercase");
    const shown = screen.getByText("Ida Ipsum");
    expect(shown.className).toContain("text-value");
    expect(shown.className).toContain("text-fg");
  });

  it("lays out label and value in two columns from sm up, stacked below", () => {
    render(
      <DetailList>
        <DetailItem label="Owner">Ida Ipsum</DetailItem>
      </DetailList>,
    );
    const row = screen.getByText("Owner").parentElement;
    expect(row?.className).toContain("sm:grid-cols-3");
    expect(row?.className).toContain("flex-col");
    expect(value("Owner").className).toContain("sm:col-span-2");
  });

  it.each([
    ["short", "font-value-short"],
    ["long", "font-value-long"],
  ] as const)("emphasis %s uses %s", (emphasis, weight) => {
    render(
      <DetailList>
        <DetailItem label="Field" emphasis={emphasis}>
          Text
        </DetailItem>
      </DetailList>,
    );
    expect(screen.getByText("Text").className).toContain(weight);
  });

  it("defaults to short emphasis", () => {
    render(
      <DetailList>
        <DetailItem label="Site">Riga</DetailItem>
      </DetailList>,
    );
    expect(screen.getByText("Riga").className).toContain("font-value-short");
  });

  it.each([null, undefined, "", "   ", false])(
    "renders the empty text as muted italic system text when the value is %j",
    (empty) => {
      render(
        <DetailList>
          <DetailItem label="Owner" empty="No owner">
            {empty}
          </DetailItem>
        </DetailList>,
      );
      const shown = screen.getByText("No owner");
      expect(shown.className).toContain("italic");
      expect(shown.className).toContain("text-fg-muted");
      // Never in the value style: no value weight and no full-contrast colour.
      expect(shown.className).not.toMatch(/font-value|\btext-fg(?!-)/);
      expect(shown.getAttribute("data-empty")).toBe("true");
      expect(value("Owner").contains(shown)).toBe(true);
    },
  );

  it("shows the value, not the empty text, when there is one", () => {
    render(
      <DetailList>
        <DetailItem label="Owner" empty="No owner">
          Ida Ipsum
        </DetailItem>
      </DetailList>,
    );
    expect(screen.queryByText("No owner")).toBeNull();
    expect(screen.getByText("Ida Ipsum").getAttribute("data-empty")).toBeNull();
  });

  it("puts an action beside the value inside the dd", () => {
    render(
      <DetailList>
        <DetailItem label="Title" action={<button type="button">Edit Title</button>}>
          Supplier contract
        </DetailItem>
      </DetailList>,
    );
    const button = screen.getByRole("button", { name: "Edit Title" });
    expect(value("Title").contains(button)).toBe(true);
    expect(button.previousElementSibling?.textContent).toBe("Supplier contract");
  });

  it("opens an editor in place across the row, keeping the term for assistive tech", async () => {
    const { container } = render(
      <DetailList>
        <DetailItem label="Title" editor={<form aria-label="Edit title">form</form>}>
          Supplier contract
        </DetailItem>
      </DetailList>,
    );
    expect(screen.queryByText("Supplier contract")).toBeNull();
    const dt = screen.getByText("Title");
    expect(dt.tagName).toBe("DT");
    expect(dt.className).toContain("sr-only");
    const dd = dt.nextElementSibling;
    expect(dd?.tagName).toBe("DD");
    expect(dd?.querySelector("form")).not.toBeNull();
    expect((await axe(container, axeOptions)).violations).toEqual([]);
  });

  it("names the field once while editing: the editor's label, not the term as well", () => {
    render(
      <DetailList>
        <DetailItem
          label="Title"
          editor={
            <form>
              <label htmlFor="t">Title</label>
              <input id="t" />
            </form>
          }
        />
      </DetailList>,
    );
    expect(screen.getByLabelText("Title").tagName).toBe("INPUT");
    expect(screen.getByRole("textbox", { name: "Title" })).toBeTruthy();
    // The term is kept for valid dl markup but hidden from the accessibility tree.
    const dt = screen.getByText("Title", { selector: "dt" });
    expect(dt.getAttribute("aria-hidden")).toBe("true");
    expect(screen.queryByRole("term")).toBeNull();
  });

  it("compact density drops the dividers and keeps short pairs side by side", () => {
    const { container } = render(
      <DetailList density="compact">
        <DetailItem label="Likelihood">3 · Likely</DetailItem>
      </DetailList>,
    );
    expect(container.querySelector("dl")?.className).not.toContain("divide-y");
    const row = screen.getByText("Likelihood").parentElement;
    expect(row?.className).toContain("grid-cols-[auto_minmax(0,1fr)]");
  });

  it("nests inside a value without the outer density leaking in", () => {
    render(
      <DetailList>
        <DetailItem label="Assessment">
          <DetailList density="compact">
            <DetailItem label="Impact">2 · Minor</DetailItem>
          </DetailList>
        </DetailItem>
      </DetailList>,
    );
    expect(screen.getByText("Assessment").parentElement?.className).toContain("sm:grid-cols-3");
    expect(screen.getByText("Impact").parentElement?.className).not.toContain("sm:grid-cols-3");
  });
});

describe("label and value type tokens", () => {
  it("exposes the label and value type scale", () => {
    expect(tokens.type).toEqual({
      label: { size: 13, weight: 500, leading: 1.45 },
      value: { size: 15, weightShort: 500, weightLong: 400, leading: 1.6 },
    });
  });

  it("lets tailwind-merge treat the type tokens as font size and weight", () => {
    expect(cn("text-[13px]", "text-label")).toBe("text-label");
    expect(cn("text-label", "text-fg-muted")).toBe("text-label text-fg-muted");
    expect(cn("font-medium", "font-value-long")).toBe("font-value-long");
  });
});
