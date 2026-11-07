// @vitest-environment jsdom
import { screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../messages/index";
import { withMessages } from "../intl";

// The real callApi and API client run; only the session, the cookie, the log and the network
// are replaced, so a 404 from GET /api/v1/demo goes through the same mapping as in the app.
vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({ get: () => ({ value: "session-1" }) }),
}));
vi.mock("../../lib/session", () => ({
  getSession: vi.fn(() => Promise.resolve({ id: "session-1" })),
  resolveAccessToken: vi.fn(() => Promise.resolve({ status: "ok", accessToken: "token-1" })),
}));
const warn = vi.fn();
vi.mock("../../lib/log", () => ({
  log: () => ({ warn, child: () => ({ warn }) }),
  requestLog: () => Promise.resolve({ warn }),
}));
vi.mock("../../app/(app)/setup/demo-actions", () => ({
  loadSampleData: vi.fn(),
  resetEverything: vi.fn(),
}));

const { default: SetupLayout } = await import("../../app/(app)/setup/layout");

const t = en.setup.demo;
const fetchMock = vi.fn<typeof fetch>();

const answer = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const error = (status: number, code: string) =>
  answer(status, { error: { code, message: "refused", requestId: "req-1" } });

async function renderLayout() {
  const element = (await SetupLayout({ children: <p>The setup step</p> })) as ReactElement;
  withMessages(element);
  expect(screen.getByText("The setup step")).toBeTruthy();
}

const section = () => screen.queryByRole("region", { name: t.title });

beforeEach(() => {
  fetchMock.mockReset();
  warn.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Setup layout: demo and training", () => {
  it("asks the API for GET /api/v1/demo with the session's token", async () => {
    fetchMock.mockResolvedValue(answer(200, { enabled: true, organisationName: null }));
    await renderLayout();
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url instanceof URL ? url.href : url).toBe("http://api.test/api/v1/demo");
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer token-1");
  });

  it("shows no section when demo mode is off (404: the routes do not exist)", async () => {
    fetchMock.mockResolvedValue(error(404, "NOT_FOUND"));
    await renderLayout();
    expect(section()).toBeNull();
    expect(screen.queryByText(t.on)).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });

  it("shows no section when the API refuses (403), and logs it", async () => {
    fetchMock.mockResolvedValue(error(403, "FORBIDDEN"));
    await renderLayout();
    expect(section()).toBeNull();
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ event: "web.demo_status_unavailable", kind: "forbidden" }),
    );
  });

  it("shows the section when demo mode is on (200)", async () => {
    fetchMock.mockResolvedValue(
      answer(200, { enabled: true, organisationName: "Isarwerk Finanz AG (sample)" }),
    );
    await renderLayout();
    expect(section()).not.toBeNull();
    expect(screen.getByText(t.on)).toBeTruthy();
    expect(screen.getByRole("button", { name: t.load.button })).toBeTruthy();
    expect(screen.getByRole("button", { name: t.reset.button })).toBeTruthy();
  });
});
