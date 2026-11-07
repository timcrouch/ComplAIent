import { libraryRoutes, type LibraryExportRow } from "@isms/contracts";
import { NextResponse } from "next/server";
import { redirectTo } from "../../../../lib/auth-responses";
import { toCsv } from "../../../../lib/csv";
import { callApi } from "../../../../lib/server-api";
import messages from "../../../../messages/index";

const t = messages.library;
const RETURN_TO = "/library";

const HEADER = (
  [
    "controlCode",
    "controlTitle",
    "category",
    "framework",
    "frameworkVersion",
    "requirementRef",
    "requirementTitle",
    "review",
    "reviewedBy",
    "reviewedAt",
  ] as const
).map((key) => t.export.columns[key]);

const toFields = (row: LibraryExportRow): string[] => [
  row.controlCode,
  row.controlTitle,
  t.categories[row.category],
  row.frameworkName,
  row.frameworkVersionKey,
  row.requirementRef,
  row.requirementTitle,
  row.reviewStatus === "reviewed" ? t.export.reviewed : t.notReviewed,
  row.reviewedBy ?? "",
  row.reviewedAt ?? "",
];

/** The library version, reduced to characters that are safe inside a quoted filename. */
function filename(version: string | null): string {
  const safe = version?.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return safe ? `control-library-${safe}.csv` : "control-library.csv";
}

const plain = (status: 403 | 503, text: string) =>
  new NextResponse(text, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
  });

/**
 * GET /library/export: the whole library as CSV, one row per control-to-requirement mapping,
 * built here from the API's JSON export (P2-R12). The API decides who may read it. No file
 * extension in the route: dotted paths would hit the missing-asset rewrite (next.config.ts).
 */
export async function GET(): Promise<NextResponse> {
  const result = await callApi(libraryRoutes.exportLibrary, {}, { returnTo: RETURN_TO });
  if (!result.ok) {
    switch (result.kind) {
      case "signed-out":
      case "reauth":
        return redirectTo(result.href ?? RETURN_TO);
      case "forbidden":
        return plain(403, t.export.forbidden);
      default:
        return plain(503, t.export.unavailable);
    }
  }
  const { libraryVersion, rows } = result.data;
  return new NextResponse(toCsv(HEADER, rows.map(toFields)), {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename(libraryVersion)}"`,
      "cache-control": "no-store",
    },
  });
}
