import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { axe } from "vitest-axe";
import {
  AiBadge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Chip,
  CommandPalette,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
  Field,
  fieldA11y,
  Input,
  Select,
  StatusBadge,
  ABOVE_APPETITE_CELL,
  ABOVE_APPETITE_EDGE,
  ABOVE_APPETITE_TEXT,
  AboveAppetiteIcon,
  Textarea,
  cn,
  tokens,
} from "../src/index";

describe("StatusBadge", () => {
  it.each([
    ["ok", "lucide-circle-check"],
    ["attention", "lucide-triangle-alert"],
    ["critical", "lucide-octagon-x"],
    ["info", "lucide-info"],
    ["unknown", "lucide-circle-question-mark"],
  ] as const)("%s renders its icon and text label", (status, iconClass) => {
    const { container } = render(<StatusBadge status={status} label={`Label ${status}`} />);
    expect(screen.getByText(`Label ${status}`)).toBeTruthy();
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute("aria-hidden")).toBe("true");
    expect(svg?.getAttribute("class")).toContain(iconClass);
  });
});

describe("StatusBadge aboveAppetite", () => {
  it("renders the triangle, its label and the critical colours", () => {
    const { container } = render(<StatusBadge status="aboveAppetite" label="Above appetite" />);
    expect(screen.getByText("Above appetite")).toBeTruthy();
    expect(container.querySelector("svg")?.getAttribute("class")).toContain(
      "lucide-triangle-alert",
    );
    const badge = container.querySelector("[data-slot=status-badge]");
    expect(badge?.getAttribute("data-status")).toBe("aboveAppetite");
    expect(badge?.className).toContain("text-critical");
    expect(badge?.className).toContain("bg-critical-soft");
    expect(badge?.className).not.toContain("attention");
  });
});

describe("above-appetite constants", () => {
  it("are red and keep the triangle icon", () => {
    expect(ABOVE_APPETITE_TEXT).toBe("text-critical");
    expect(ABOVE_APPETITE_CELL).toBe("bg-critical-soft text-critical");
    expect(ABOVE_APPETITE_EDGE).toEqual({ left: "border-l-critical", below: "border-b-critical" });
    expect(AboveAppetiteIcon).toBeDefined();
  });
});

describe("AiBadge", () => {
  it.each([
    ["suggested", "Suggested by AI"],
    ["draft", "AI draft"],
  ] as const)("%s shows %s with a hidden sparkles icon", (state, text) => {
    const { container } = render(<AiBadge state={state} />);
    expect(screen.getByText(text)).toBeTruthy();
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("aria-hidden")).toBe("true");
    expect(svg?.getAttribute("class")).toContain("lucide-sparkles");
  });
});

describe("Button", () => {
  it.each(["primary", "secondary", "ghost", "destructive"] as const)(
    "%s is a clickable button",
    async (variant) => {
      const onClick = vi.fn();
      render(
        <Button variant={variant} onClick={onClick}>
          Save
        </Button>,
      );
      await userEvent.click(screen.getByRole("button", { name: "Save" }));
      expect(onClick).toHaveBeenCalledOnce();
    },
  );

  it("destructive uses the critical tokens, which both themes define (contrast.test.ts)", () => {
    render(<Button variant="destructive">Delete everything</Button>);
    const classes = screen.getByRole("button", { name: "Delete everything" }).className;
    expect(classes).toContain("bg-critical-soft");
    expect(classes).toContain("text-critical");
    expect(classes).not.toContain("bg-accent");
  });
});

describe("Chip", () => {
  it("exposes selected state as aria-pressed and toggles", async () => {
    const onSelectedChange = vi.fn();
    const { rerender } = render(
      <Chip selected={false} onSelectedChange={onSelectedChange}>
        ISO 27001
      </Chip>,
    );
    const chip = screen.getByRole("button", { name: "ISO 27001" });
    expect(chip.getAttribute("aria-pressed")).toBe("false");
    await userEvent.click(chip);
    expect(onSelectedChange).toHaveBeenCalledWith(true);
    rerender(
      <Chip selected onSelectedChange={onSelectedChange}>
        ISO 27001
      </Chip>,
    );
    expect(chip.getAttribute("aria-pressed")).toBe("true");
  });
});

describe("Dialog", () => {
  it("opens from its trigger, is labelled, and closes with Escape", async () => {
    render(
      <Dialog>
        <DialogTrigger render={<Button />}>Open details</DialogTrigger>
        <DialogContent>
          <DialogTitle>Control details</DialogTitle>
          <DialogDescription>Everything about this control.</DialogDescription>
        </DialogContent>
      </Dialog>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Open details" }));
    const dialog = await screen.findByRole("dialog", { name: "Control details" });
    expect(within(dialog).getByRole("button", { name: "Close" })).toBeTruthy();
    await userEvent.keyboard("{Escape}");
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
  });
});

describe("CommandPalette", () => {
  function setup() {
    const openRisks = vi.fn();
    const openControls = vi.fn();
    render(
      <CommandPalette
        items={[
          { id: "controls", label: "Go to controls", onSelect: openControls },
          { id: "risks", label: "Go to risks", onSelect: openRisks },
        ]}
      />,
    );
    return { openRisks, openControls };
  }

  it("opens with Ctrl+K and runs onSelect with Enter", async () => {
    const { openRisks, openControls } = setup();
    expect(screen.queryByRole("dialog")).toBeNull();
    await userEvent.keyboard("{Control>}k{/Control}");
    const input = await screen.findByRole("combobox");
    await waitFor(() => {
      expect(document.activeElement).toBe(input);
    });
    await userEvent.keyboard("risk");
    expect(screen.getAllByRole("option")).toHaveLength(1);
    await userEvent.keyboard("{Enter}");
    expect(openRisks).toHaveBeenCalledOnce();
    expect(openControls).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
  });

  it("opens with ⌘K, moves with arrow keys and announces result counts", async () => {
    const { openRisks } = setup();
    await userEvent.keyboard("{Meta>}k{/Meta}");
    const input = await screen.findByRole("combobox");
    await waitFor(() => {
      expect(document.activeElement).toBe(input);
    });
    const status = screen.getByRole("status");
    expect(status.textContent).toBe("2 results");
    const options = screen.getAllByRole("option");
    expect(input.getAttribute("aria-activedescendant")).toBe(options[0]?.id);
    expect(options[0]?.getAttribute("aria-selected")).toBe("true");
    await userEvent.keyboard("{ArrowDown}");
    expect(input.getAttribute("aria-activedescendant")).toBe(options[1]?.id);
    await userEvent.keyboard("zzz");
    expect(status.textContent).toBe("No matches");
    expect(screen.queryAllByRole("option")).toHaveLength(0);
    await userEvent.clear(input);
    await userEvent.keyboard("{ArrowUp}{Enter}");
    expect(openRisks).toHaveBeenCalledOnce();
  });

  it("leaves Home and End to move the caret in the search field (WAI-ARIA combobox)", async () => {
    setup();
    await userEvent.keyboard("{Control>}k{/Control}");
    const input = await screen.findByRole<HTMLInputElement>("combobox");
    await waitFor(() => {
      expect(document.activeElement).toBe(input);
    });
    await userEvent.keyboard("go");
    const first = screen.getAllByRole("option")[0];
    await userEvent.keyboard("{Home}");
    expect(input.selectionStart).toBe(0);
    await userEvent.keyboard("{End}");
    expect(input.selectionStart).toBe(2);
    expect(input.getAttribute("aria-activedescendant")).toBe(first?.id);
  });

  it("closes with Escape and returns focus to the element focused before opening", async () => {
    render(
      <>
        <button type="button">Before</button>
        <CommandPalette items={[{ id: "a", label: "Go home", onSelect: vi.fn() }]} />
      </>,
    );
    const before = screen.getByRole("button", { name: "Before" });
    before.focus();
    await userEvent.keyboard("{Control>}k{/Control}");
    const input = await screen.findByRole("combobox");
    await waitFor(() => {
      expect(document.activeElement).toBe(input);
    });
    await userEvent.keyboard("{Escape}");
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    await waitFor(() => {
      expect(document.activeElement).toBe(before);
    });
  });

  it("ignores Enter while an IME composition is in progress", async () => {
    const { openControls } = setup();
    await userEvent.keyboard("{Control>}k{/Control}");
    const input = await screen.findByRole("combobox");
    await waitFor(() => {
      expect(document.activeElement).toBe(input);
    });
    fireEvent.keyDown(input, { key: "Enter", isComposing: true });
    expect(openControls).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("ignores the shortcut when another handler already handled it", () => {
    setup();
    const event = new KeyboardEvent("keydown", { key: "k", ctrlKey: true, cancelable: true });
    event.preventDefault();
    act(() => {
      document.dispatchEvent(event);
    });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("lets every visible string be overridden", async () => {
    render(
      <CommandPalette
        defaultOpen
        items={[]}
        labels={{
          title: "Befehlspalette",
          placeholder: "Suchen",
          empty: "Keine Treffer",
          results: (n) => `${String(n)} Treffer`,
          navigate: "Navigieren",
          select: "Auswählen",
          close: "Schließen",
          escapeKey: "Entf",
        }}
      />,
    );
    const dialog = await screen.findByRole("dialog", { name: "Befehlspalette" });
    for (const text of ["Navigieren", "Auswählen", "Schließen", "Entf"]) {
      expect(within(dialog).getByText(text)).toBeTruthy();
    }
    expect(within(dialog).queryByText("Esc")).toBeNull();
    expect(screen.getByRole("status").textContent).toBe("Keine Treffer");
  });
});

function Gallery() {
  return (
    <main>
      <h1>Gallery</h1>
      <Button variant="primary">Primary</Button>
      <Button variant="secondary">Secondary</Button>
      <Button variant="ghost">Ghost</Button>
      <Button variant="destructive">Destructive</Button>
      <Card>
        <CardHeader>
          <CardTitle>Controls</CardTitle>
          <CardDescription>211 of 214 working</CardDescription>
        </CardHeader>
        <CardContent>Body</CardContent>
      </Card>
      <StatusBadge status="ok" label="Working" />
      <StatusBadge status="attention" label="Needs attention" />
      <StatusBadge status="critical" label="Failing" />
      <StatusBadge status="info" label="Scheduled" />
      <StatusBadge status="unknown" label="Not assessed" />
      <AiBadge state="suggested" />
      <AiBadge state="draft" />
      <Chip selected>Selected chip</Chip>
      <Chip>Unselected chip</Chip>
      <label htmlFor="owner">Owner</label>
      <Input id="owner" placeholder="Name" />
    </main>
  );
}

// jsdom cannot compute rendered colours (axe's colour-contrast rule needs canvas);
// contrast is verified against the design tokens in contrast.test.ts instead.
const axeOptions = { rules: { "color-contrast": { enabled: false } } };

async function expectNoAxeViolations(ui: ReactElement, theme: "light" | "dark") {
  const { container } = render(<div data-theme={theme}>{ui}</div>);
  const results = await axe(container, axeOptions);
  expect(results.violations).toEqual([]);
}

// Per ruling R24: jsdom loads no CSS, so these axe runs are structural only
// (names, roles, ARIA). The data-theme wrapper does not change what is checked;
// real per-theme checks (including colour contrast) run in Playwright in Task 12.
describe("accessibility (axe, structural)", () => {
  it.each(["light", "dark"] as const)(
    "structural: no violations for each component (data-theme=%s)",
    async (theme) => {
      await expectNoAxeViolations(<Gallery />, theme);
    },
  );

  it.each(["light", "dark"] as const)(
    "structural: no violations for an open dialog (data-theme=%s)",
    async (theme) => {
      render(
        <div data-theme={theme}>
          <Dialog defaultOpen>
            <DialogContent>
              <DialogTitle>Approve decision</DialogTitle>
              <DialogDescription>Confirm the risk acceptance.</DialogDescription>
            </DialogContent>
          </Dialog>
        </div>,
      );
      await screen.findByRole("dialog");
      const results = await axe(document.body, axeOptions);
      expect(results.violations).toEqual([]);
    },
  );

  it.each(["light", "dark"] as const)(
    "structural: no violations for the open palette (data-theme=%s)",
    async (theme) => {
      render(
        <div data-theme={theme}>
          <CommandPalette defaultOpen items={[{ id: "a", label: "Go home", onSelect: vi.fn() }]} />
        </div>,
      );
      await screen.findByRole("combobox");
      const results = await axe(document.body, axeOptions);
      expect(results.violations).toEqual([]);
    },
  );
});

describe("exports", () => {
  it("exposes cn and tokens", () => {
    expect(cn("px-2", "px-4")).toBe("px-4");
    expect(tokens.radius).toEqual({ sm: 8, md: 12, lg: 16 });
    expect(tokens.motion).toEqual({ fast: 120, base: 200, slow: 320 });
    expect(tokens.easing).toBe("cubic-bezier(0.2, 0.8, 0.2, 1)");
  });
});

describe("Field", () => {
  it("Field links hint and error to the control and has no axe violations", async () => {
    const { container } = render(
      <main>
        <Field
          id="org-name"
          label="Organisation name"
          hint="As people know it"
          error="Enter a name"
        >
          <Input id="org-name" {...fieldA11y("org-name", { hint: true, error: true })} />
        </Field>
        <Field id="about" label="About">
          <Textarea id="about" {...fieldA11y("about", { hint: false, error: false })} />
        </Field>
        <Field id="country" label="Country" hint="Where the site is">
          <Select id="country" {...fieldA11y("country", { hint: true, error: false })}>
            <option value="LV">Latvia</option>
          </Select>
        </Field>
      </main>,
    );
    const name = screen.getByRole("textbox", { name: "Organisation name" });
    expect(name.getAttribute("aria-invalid")).toBe("true");
    expect(name.getAttribute("aria-describedby")).toBe("org-name-hint org-name-error");
    expect(document.getElementById("org-name-hint")?.textContent).toBe("As people know it");
    const error = document.getElementById("org-name-error");
    expect(error?.textContent).toBe("Enter a name");
    expect(error?.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");

    const about = screen.getByRole("textbox", { name: "About" });
    expect(about.tagName).toBe("TEXTAREA");
    expect(about.hasAttribute("aria-invalid")).toBe(false);
    expect(about.hasAttribute("aria-describedby")).toBe(false);

    const country = screen.getByRole("combobox", { name: "Country" });
    expect(country.tagName).toBe("SELECT");
    expect(country.getAttribute("aria-describedby")).toBe("country-hint");

    const results = await axe(container, axeOptions);
    expect(results.violations).toEqual([]);
  });
});
