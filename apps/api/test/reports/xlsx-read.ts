import { strFromU8, unzipSync } from "fflate";

const ENTITIES: Record<string, string> = {
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&apos;": "'",
  "&amp;": "&",
};
const decode = (s: string) => s.replace(/&(?:lt|gt|quot|apos|amp);/g, (e) => ENTITIES[e] ?? e);

/** An unzipped workbook: its raw XML parts and each sheet's string cells, in order. */
export function readXlsx(buffer: Buffer) {
  const files = unzipSync(new Uint8Array(buffer));
  const xml = (path: string) => {
    const file = files[path];
    if (!file) throw new Error(`${path} missing`);
    return strFromU8(file);
  };
  const shared = files["xl/sharedStrings.xml"]
    ? [...xml("xl/sharedStrings.xml").matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) =>
        decode([...(m[1] ?? "").matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join("")),
      )
    : [];
  /** The string values of a sheet's cells (shared or inline). */
  const strings = (sheet: number): string[] =>
    [...xml(`xl/worksheets/sheet${String(sheet)}.xml`).matchAll(/<c ([^>]*)>([\s\S]*?)<\/c>/g)]
      .filter((m) => /t="(s|inlineStr|str)"/.test(m[1] ?? ""))
      .map((m) => {
        const body = m[2] ?? "";
        if ((m[1] ?? "").includes('t="s"')) {
          return shared[Number(/<v>(\d+)<\/v>/.exec(body)?.[1])] ?? "";
        }
        return decode(/<t[^>]*>([\s\S]*?)<\/t>/.exec(body)?.[1] ?? "");
      });
  return { files, xml, strings };
}

/** Excel's serial day number of an ISO date (days since 1899-12-30). */
export const excelSerial = (isoDate: string) =>
  (Date.parse(`${isoDate}T00:00:00Z`) - Date.UTC(1899, 11, 30)) / 86_400_000;
