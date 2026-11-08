// @vitest-environment jsdom
import { screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SetupFrame } from "../components/setup/setup-frame";
import { act } from "@testing-library/react";
import { lazy, Suspense } from "react";
import { consumeStepHeadingFocus, requestStepHeadingFocus } from "../lib/step-focus";
import { stepMetadata } from "../lib/setup-metadata";
import en from "../messages/index";
import { clickLink, withMessages } from "./intl";

vi.mock("next/navigation", () => ({ usePathname: () => "/setup/sites" }));

describe("SetupFrame", () => {
  it("shows the ordered steps, the current one, what is done, and why we ask", () => {
    withMessages(
      <SetupFrame current="sites" missing={["sites", "frameworks", "riskScale"]}>
        <p>form</p>
      </SetupFrame>,
    );
    const nav = screen.getByRole("navigation", { name: en.setup.stepsLabel });
    const steps = nav.querySelector("ol");
    expect(steps).not.toBeNull();
    const items = within(steps as HTMLElement).getAllByRole("listitem");
    expect(items.map((li) => li.textContent)).toEqual([
      `${en.setup.steps.organisation} ${en.setup.done}`,
      `2${en.setup.steps.sites}`,
      `3${en.setup.steps.frameworks}`,
      `4${en.setup.steps.riskAppetite}`,
      `5${en.setup.steps.people}`,
      `6${en.setup.steps.review}`,
    ]);
    const done = within(items[0] as HTMLElement).getByText(en.setup.done);
    expect(done.className).toContain("sr-only");
    expect(items[0]?.querySelector("svg.lucide-check")).not.toBeNull();
    // A done step links back; the current step is marked; later steps are not links yet.
    const back = within(nav).getByRole("link", {
      name: `${en.setup.steps.organisation} ${en.setup.done}`,
    });
    expect(back.getAttribute("href")).toBe("/setup/organisation");
    const current = nav.querySelector('[aria-current="step"]');
    expect(current?.textContent).toBe(`2${en.setup.steps.sites}`);
    expect(within(items[2] as HTMLElement).queryByRole("link")).toBeNull();

    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(en.setup.sites.title);
    expect(screen.getByText("Step 2 of 6")).toBeTruthy();
    expect(screen.getByText(en.setup.sites.why)).toBeTruthy();
    expect(screen.getByText(en.setup.whyLabel)).toBeTruthy();
    expect(screen.getByText("form")).toBeTruthy();
  });

  it("lists Modules after the steps, unnumbered and always reachable", () => {
    withMessages(
      <SetupFrame current="sites" missing={["sites", "frameworks", "riskScale"]}>
        <p>form</p>
      </SetupFrame>,
    );
    const nav = screen.getByRole("navigation", { name: en.setup.stepsLabel });
    const sections = within(nav).getByRole("list", { name: en.setup.sectionsLabel });
    const link = within(sections).getByRole("link", { name: en.setup.sections.modules });
    expect(link.getAttribute("href")).toBe("/setup/modules");
    expect(link.textContent).not.toMatch(/\d/);
  });

  it("on the Modules page says it is optional instead of a step number", () => {
    withMessages(
      <SetupFrame current="modules" missing={[]}>
        <p>modules</p>
      </SetupFrame>,
    );
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(en.setup.modules.title);
    expect(screen.getByText(en.setup.optional)).toBeTruthy();
    expect(screen.queryByText(/^Step \d of/)).toBeNull();
    const nav = screen.getByRole("navigation", { name: en.setup.stepsLabel });
    expect(nav.querySelector('[aria-current="page"]')?.textContent).toBe(en.setup.sections.modules);
    expect(stepMetadata("modules").title).toBe(
      `${en.setup.modules.title} · ${en.setup.title} · ${en.app.name}`,
    );
  });
});

describe("setup loading", () => {
  it("is a busy, labelled skeleton of the frame with no numbers", async () => {
    const { default: SetupLoading } = await import("../app/(app)/setup/loading");
    const { container } = withMessages(<SetupLoading />);
    const region = container.querySelector('[aria-busy="true"]');
    expect(region?.getAttribute("aria-label")).toBe(en.setup.loading);
    expect(region?.textContent).toBe(en.setup.loading);
    expect(container.textContent).not.toMatch(/\d/);
    expect(container.innerHTML).toContain("motion-safe:animate-pulse");
    expect(container.innerHTML).not.toMatch(/(^|\s)animate-pulse/);
  });
});

describe("step changes are announced", () => {
  it("gives each step its own page title from en.json", () => {
    expect(stepMetadata("organisation")).toEqual({
      title: `${en.setup.organisation.title} · ${en.setup.title} · ${en.app.name}`,
    });
    expect(stepMetadata("sites").title).toBe(
      "Where you work · Set up your organisation · ComplAIent ISMS",
    );
  });

  // The page streams in behind setup/loading.tsx, so the frame mounts inside a Suspense
  // boundary after the shell. Only an explicit in-app navigation may move focus.
  async function suspendedFrame() {
    let release: () => void = () => undefined;
    const ready = new Promise<void>((r) => {
      release = r;
    });
    const Streamed = lazy(() =>
      ready.then(() => ({
        default: () => (
          <SetupFrame current="sites" missing={["sites"]}>
            <p>form</p>
          </SetupFrame>
        ),
      })),
    );
    const view = withMessages(
      <Suspense fallback={<p>loading</p>}>
        <Streamed />
      </Suspense>,
    );
    await act(async () => {
      release();
      await ready;
    });
    return { view, heading: await screen.findByRole("heading", { level: 1 }) };
  }

  it("leaves focus alone on a full page load, even when the frame mounts after the shell", async () => {
    const { heading } = await suspendedFrame();
    expect(heading.getAttribute("tabindex")).toBe("-1");
    expect(document.activeElement).not.toBe(heading);
  });

  it("focuses the step heading once after an in-app navigation, then clears the request", async () => {
    requestStepHeadingFocus();
    const first = await suspendedFrame();
    expect(document.activeElement).toBe(first.heading);
    expect(consumeStepHeadingFocus()).toBe(false);
    first.view.unmount();
    const second = await suspendedFrame();
    expect(document.activeElement).not.toBe(second.heading);
  });

  it("the step rail and Back links request the focus move", () => {
    withMessages(
      <SetupFrame current="sites" missing={["sites"]}>
        <p>form</p>
      </SetupFrame>,
    );
    clickLink(
      screen.getByRole("link", { name: `${en.setup.steps.organisation} ${en.setup.done}` }),
    );
    expect(consumeStepHeadingFocus()).toBe(true);
  });
});
