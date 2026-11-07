// @vitest-environment jsdom
import { AiTestFailureReasonSchema } from "@isms/contracts";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConnectionTest } from "../../components/settings/connection-test";
import en from "../../messages/index";
import { withMessages } from "../intl";

const testAiConnection = vi.fn();
vi.mock("../../lib/actions/ai-settings", () => ({
  testAiConnection: (...args: unknown[]) => testAiConnection(...args) as unknown,
}));
const assign = vi.fn();
vi.mock("../../lib/navigate", () => ({ goTo: (href: string) => assign(href) as unknown }));

const t = en.settings.ai.test;

beforeEach(() => {
  testAiConnection.mockReset();
  assign.mockReset();
});

describe("ConnectionTest", () => {
  it("explains each test-connection failure in plain words", async () => {
    withMessages(<ConnectionTest />);
    expect(t.reasons.auth).toMatch(/^The key was rejected by OpenRouter/);
    expect(t.reasons.noEndpoint).toMatch(/^No EU-hosted provider available for this model/);
    for (const reason of AiTestFailureReasonSchema.options) {
      testAiConnection.mockResolvedValueOnce({ ok: true, data: { ok: false, reason } });
      await userEvent.click(screen.getByRole("button", { name: t.button }));
      await waitFor(() => {
        expect(screen.getByRole("status").textContent).toBe(t.reasons[reason]);
      });
    }
  });

  it("announces success with the model that answered", async () => {
    testAiConnection.mockResolvedValue({ ok: true, data: { ok: true, model: "mock/isms-test" } });
    withMessages(<ConnectionTest />);
    await userEvent.click(screen.getByRole("button", { name: t.button }));
    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toBe(
        t.ok.replace("{model}", "mock/isms-test"),
      );
    });
  });

  it("goes to sign in again when the test needs a recent sign-in", async () => {
    const href = "/auth/login?returnTo=%2Fsettings%2Fai&stepUp=1";
    testAiConnection.mockResolvedValue({ ok: false, kind: "reauth", details: [], href });
    withMessages(<ConnectionTest />);
    await userEvent.click(screen.getByRole("button", { name: t.button }));
    await waitFor(() => {
      expect(assign).toHaveBeenCalledWith(href);
    });
  });
});
