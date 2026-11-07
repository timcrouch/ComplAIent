import { libraryRoutes, type ExportLibraryResponse } from "@isms/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import en from "../messages/index";

vi.mock("../lib/server-api", () => ({ callApi: vi.fn() }));

const { callApi } = await import("../lib/server-api");
const { GET } = await import("../app/(app)/library/export/route");

const columns = en.library.export.columns;
const header = [
  columns.controlCode,
  columns.controlTitle,
  columns.category,
  columns.framework,
  columns.frameworkVersion,
  columns.requirementRef,
  columns.requirementTitle,
  columns.review,
  columns.reviewedBy,
  columns.reviewedAt,
].join(",");

const library: ExportLibraryResponse = {
  libraryVersion: "2026.11.0",
  generatedAt: "2026-11-05T09:00:00.000Z",
  rows: [
    {
      controlCode: "RES-01",
      controlTitle: "Back-ups you can restore",
      category: "resilience",
      frameworkVersionKey: "iso27001-2022",
      frameworkName: "ISO/IEC 27001",
      requirementRef: "A.8.13",
      requirementTitle: "Recovery points exist, and restores work.",
      reviewStatus: "reviewed",
      reviewedBy: "Carl Ciso",
      reviewedAt: "2026-11-05T09:00:00.000Z",
    },
    {
      controlCode: "RES-01",
      controlTitle: "Back-ups you can restore",
      category: "resilience",
      frameworkVersionKey: "nis2-2022-2555",
      frameworkName: "NIS2",
      requirementRef: "21(2)(c)",
      requirementTitle: '=HYPERLINK("x")',
      reviewStatus: "unreviewed",
      reviewedBy: null,
      reviewedAt: null,
    },
  ],
};

beforeEach(() => {
  vi.mocked(callApi).mockReset();
});

describe("GET /library/export", () => {
  it("returns text/csv with the version in the filename and headers from en.json", async () => {
    vi.mocked(callApi).mockResolvedValue({ ok: true, data: library as never });
    const res = await GET();
    expect(callApi).toHaveBeenCalledWith(libraryRoutes.exportLibrary, {}, { returnTo: "/library" });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(res.headers.get("content-disposition")).toBe(
      'attachment; filename="control-library-2026.11.0.csv"',
    );
    expect(res.headers.get("cache-control")).toBe("no-store");
    // Response.text() drops a BOM while decoding; read the bytes to see what is sent.
    const body = new TextDecoder("utf-8", { ignoreBOM: true }).decode(await res.arrayBuffer());
    const lines = body.split("\r\n");
    expect(lines[0]).toBe(`\uFEFF${header}`);
    expect(lines[1]).toBe(
      [
        "RES-01",
        "Back-ups you can restore",
        en.library.categories.resilience,
        "ISO/IEC 27001",
        "iso27001-2022",
        "A.8.13",
        '"Recovery points exist, and restores work."',
        en.library.export.reviewed,
        "Carl Ciso",
        "2026-11-05T09:00:00.000Z",
      ].join(","),
    );
    expect(lines[2]).toContain(`,"'=HYPERLINK(""x"")",${en.library.notReviewed},,`);
    expect(lines).toHaveLength(4);
  });

  it("names the file without a version when the library has none", async () => {
    vi.mocked(callApi).mockResolvedValue({
      ok: true,
      data: { ...library, libraryVersion: null, rows: [] } as never,
    });
    const res = await GET();
    expect(res.headers.get("content-disposition")).toBe(
      'attachment; filename="control-library.csv"',
    );
  });

  it("keeps only safe characters of the version in the filename", async () => {
    vi.mocked(callApi).mockResolvedValue({
      ok: true,
      data: { ...library, libraryVersion: '1"; x=/../2' } as never,
    });
    const res = await GET();
    expect(res.headers.get("content-disposition")).toBe(
      'attachment; filename="control-library-1-x-..-2.csv"',
    );
  });

  it("redirects to sign-in without a session", async () => {
    vi.mocked(callApi).mockResolvedValue({
      ok: false,
      kind: "signed-out",
      details: [],
      href: "/auth/login?returnTo=%2Flibrary",
    });
    const res = await GET();
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(
      "http://localhost:3000/auth/login?returnTo=%2Flibrary",
    );
  });

  it.each([
    ["forbidden", 403, en.library.export.forbidden],
    ["unavailable", 503, en.library.export.unavailable],
    ["invalid", 503, en.library.export.unavailable],
  ] as const)("answers %s with %i and plain words", async (kind, status, text) => {
    vi.mocked(callApi).mockResolvedValue({ ok: false, kind, details: [] });
    const res = await GET();
    expect(res.status).toBe(status);
    expect(res.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.text()).toBe(text);
  });
});
