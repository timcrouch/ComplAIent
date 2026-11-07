import { organisationRoutes } from "@isms/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/server-api", () => ({ callApi: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { callApi } = await import("../lib/server-api");
const { revalidatePath } = await import("next/cache");
const {
  completeSetup,
  saveFrameworks,
  saveProfile,
  saveReviewInterval,
  saveRiskAppetite,
  saveUnits,
  suggestFrameworks,
} = await import("../lib/actions/setup");

const SITE_ID = "0b9f5f4e-5d0a-4c55-9a43-9a4f7f0d1c2e";
const units = {
  sites: [
    { id: SITE_ID, name: "Riga office", countryCode: "LV" },
    { name: "Berlin", countryCode: "DE" },
  ],
  departments: [{ name: "Finance" }],
};

beforeEach(() => {
  vi.mocked(callApi).mockReset();
  vi.mocked(revalidatePath).mockReset();
});

// A saved step must not come back from the client router cache (Back would resend old lists).
describe("cache after saving", () => {
  const profile = { name: "Acme", description: "We make things.", approximateHeadcount: 40 };
  it.each([
    ["saveProfile", () => saveProfile(profile)],
    ["saveUnits", () => saveUnits(units)],
    ["saveFrameworks", () => saveFrameworks([SITE_ID])],
    ["saveRiskAppetite", () => saveRiskAppetite(9)],
  ] as const)("%s revalidates /setup on success only", async (_name, save) => {
    vi.mocked(callApi).mockResolvedValueOnce({ ok: true, data: {} as never });
    await save();
    expect(revalidatePath).toHaveBeenCalledExactlyOnceWith("/setup", "layout");
    vi.mocked(revalidatePath).mockReset();
    vi.mocked(callApi).mockResolvedValueOnce({ ok: false, kind: "unavailable", details: [] });
    await save();
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe("saveProfile", () => {
  it("saves the profile through the API, returning to the organisation step", async () => {
    vi.mocked(callApi).mockResolvedValue({ ok: true, data: {} as never });
    const profile = { name: "Acme", description: "We make things.", approximateHeadcount: 40 };
    expect(await saveProfile(profile)).toEqual({ ok: true, data: {} });
    expect(callApi).toHaveBeenCalledWith(
      organisationRoutes.updateProfile,
      { body: profile },
      { returnTo: "/setup/organisation" },
    );
  });

  it("refuses input that breaks the contract as invalid, without calling the API", async () => {
    const result = await saveProfile({ name: "", description: "x", approximateHeadcount: 0 });
    expect(result).toMatchObject({ ok: false, kind: "invalid" });
    expect(result.ok ? [] : result.details.map((d) => d.path)).toEqual([
      "name",
      "approximateHeadcount",
    ]);
    expect(callApi).not.toHaveBeenCalled();
  });
});

describe("saveUnits", () => {
  // PF4: one PUT /organisation/units saves both lists all-or-nothing.
  it("saves sites and departments together in one call, returning to the sites step", async () => {
    const data = { sites: [], departments: [] };
    vi.mocked(callApi).mockResolvedValue({ ok: true, data } as never);
    expect(await saveUnits(units)).toEqual({ ok: true, data });
    expect(callApi).toHaveBeenCalledTimes(1);
    expect(callApi).toHaveBeenCalledWith(
      organisationRoutes.replaceUnits,
      { body: units },
      { returnTo: "/setup/sites" },
    );
  });

  it("returns the API's failure unchanged, so nothing is half-saved", async () => {
    const failure = {
      ok: false as const,
      kind: "conflict" as const,
      details: [{ path: `siteInUse.${SITE_ID}`, message: "siteInUse" }],
    };
    vi.mocked(callApi).mockResolvedValue(failure);
    expect(await saveUnits(units)).toEqual(failure);
    expect(callApi).toHaveBeenCalledTimes(1);
  });

  it("refuses a list without sites as invalid, without calling the API", async () => {
    const result = await saveUnits({ sites: [], departments: [] });
    expect(result).toMatchObject({ ok: false, kind: "invalid", details: [{ path: "sites" }] });
    expect(callApi).not.toHaveBeenCalled();
  });
});

describe("saveFrameworks, saveRiskAppetite and completeSetup", () => {
  it("confirm the chosen frameworks, returning to the frameworks step", async () => {
    vi.mocked(callApi).mockResolvedValue({ ok: true, data: { frameworks: [] } } as never);
    await saveFrameworks([SITE_ID]);
    expect(callApi).toHaveBeenCalledWith(
      organisationRoutes.setFrameworks,
      { body: { frameworkVersionIds: [SITE_ID] } },
      { returnTo: "/setup/frameworks" },
    );
  });

  it("refuse an empty choice or an out-of-range threshold without calling the API", async () => {
    expect(await saveFrameworks([])).toMatchObject({
      ok: false,
      kind: "invalid",
      details: [{ path: "frameworkVersionIds" }],
    });
    expect(await saveRiskAppetite(25)).toMatchObject({
      ok: false,
      kind: "invalid",
      details: [{ path: "appetiteThreshold" }],
    });
    expect(callApi).not.toHaveBeenCalled();
  });

  it("save the appetite threshold, returning to the appetite step", async () => {
    vi.mocked(callApi).mockResolvedValue({ ok: true, data: {} as never });
    await saveRiskAppetite(4);
    expect(callApi).toHaveBeenCalledWith(
      organisationRoutes.setRiskScale,
      { body: { appetiteThreshold: 4 } },
      { returnTo: "/setup/risk-appetite" },
    );
  });

  it("completeSetup finishes setup and refreshes every page, Home included", async () => {
    vi.mocked(callApi).mockResolvedValue({ ok: true, data: { completedAt: "x" } } as never);
    await completeSetup();
    expect(callApi).toHaveBeenCalledWith(
      organisationRoutes.completeSetup,
      {},
      { returnTo: "/setup/review" },
    );
    expect(revalidatePath).toHaveBeenCalledExactlyOnceWith("/", "layout");
  });
});

describe("suggestFrameworks", () => {
  it("asks the API for suggestions from the frameworks step and refreshes setup on success", async () => {
    vi.mocked(callApi).mockResolvedValue({ ok: true, data: { frameworks: [] } as never });
    expect(await suggestFrameworks()).toEqual({ ok: true, data: { frameworks: [] } });
    expect(callApi).toHaveBeenCalledWith(
      organisationRoutes.suggestFrameworks,
      {},
      { returnTo: "/setup/frameworks" },
    );
    expect(revalidatePath).toHaveBeenCalledExactlyOnceWith("/setup", "layout");
  });
});

describe("saveReviewInterval", () => {
  it("saves the months through the API and refreshes the setup pages", async () => {
    vi.mocked(callApi).mockResolvedValueOnce({ ok: true, data: {} as never });
    await saveReviewInterval(6);
    expect(callApi).toHaveBeenCalledWith(
      organisationRoutes.setReviewInterval,
      { body: { months: 6 } },
      { returnTo: "/setup/risk-appetite" },
    );
    expect(revalidatePath).toHaveBeenCalledWith("/setup", "layout");
  });

  it.each([0, 37, 1.5])("refuses %s without calling the API", async (months) => {
    expect(await saveReviewInterval(months)).toMatchObject({ ok: false, kind: "invalid" });
    expect(callApi).not.toHaveBeenCalled();
  });
});
