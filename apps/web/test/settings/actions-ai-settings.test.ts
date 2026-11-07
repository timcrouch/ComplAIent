import { aiSettingsRoutes } from "@isms/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/server-api", () => ({ callApi: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { callApi } = await import("../../lib/server-api");
const { revalidatePath } = await import("next/cache");
const { removeAiKey, saveAiKey, testAiConnection, updateAiSettings } =
  await import("../../lib/actions/ai-settings");

const KEY = "sk-or-v1-unit-test-0123456789-WXYZ";
const RETURN = { returnTo: "/settings/ai" };
const dto = { enabled: false, key: { set: true, last4: "WXYZ" } };

beforeEach(() => {
  vi.mocked(callApi).mockReset();
  vi.mocked(revalidatePath).mockReset();
});

describe("AI settings actions", () => {
  it("save, remove, update and test through the API, returning to /settings/ai for a step-up", async () => {
    vi.mocked(callApi).mockResolvedValue({ ok: true, data: dto as never });
    await saveAiKey(`  ${KEY} `);
    expect(callApi).toHaveBeenCalledWith(aiSettingsRoutes.setKey, { body: { key: KEY } }, RETURN);
    await removeAiKey();
    expect(callApi).toHaveBeenCalledWith(aiSettingsRoutes.removeKey, {}, RETURN);
    await updateAiSettings({ euOnly: true });
    expect(callApi).toHaveBeenCalledWith(
      aiSettingsRoutes.update,
      { body: { euOnly: true } },
      RETURN,
    );
    await testAiConnection();
    expect(callApi).toHaveBeenCalledWith(aiSettingsRoutes.test, {}, RETURN);
    expect(revalidatePath).toHaveBeenCalledTimes(4);
    expect(revalidatePath).toHaveBeenCalledWith("/settings/ai", "layout");
  });

  it("returns only the settings DTO after saving a key, never the key", async () => {
    vi.mocked(callApi).mockResolvedValue({ ok: true, data: dto as never });
    const result = await saveAiKey(KEY);
    expect(result).toEqual({ ok: true, data: dto });
    expect(JSON.stringify(result)).not.toContain(KEY);
  });

  it("refuses a malformed key or update without calling the API or echoing the key", async () => {
    const spaced = "sk-or-v1 has spaces inside it";
    const result = await saveAiKey(spaced);
    expect(result).toMatchObject({ ok: false, kind: "invalid", details: [{ path: "key" }] });
    expect(JSON.stringify(result)).not.toContain("has spaces");
    expect(await updateAiSettings({})).toMatchObject({ ok: false, kind: "invalid" });
    expect(callApi).not.toHaveBeenCalled();
  });

  it("passes the step-up redirect through unchanged and does not revalidate", async () => {
    const reauth = {
      ok: false as const,
      kind: "reauth" as const,
      details: [],
      href: "/auth/login?returnTo=%2Fsettings%2Fai&stepUp=1",
    };
    vi.mocked(callApi).mockResolvedValue(reauth);
    expect(await saveAiKey(KEY)).toEqual(reauth);
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
