const BOM = "\uFEFF";
const CRLF = "\r\n";
/** Spreadsheets run a cell that starts with one of these as a formula (CSV injection). */
const FORMULA_START = /^[=+\-@\t\r]/;
const NEEDS_QUOTES = /[",\r\n]/;

function cell(value: string): string {
  const safe = FORMULA_START.test(value) ? `'${value}` : value;
  return NEEDS_QUOTES.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

const line = (fields: readonly string[]) => fields.map(cell).join(",") + CRLF;

/**
 * RFC 4180 CSV with a UTF-8 byte order mark (so Excel reads accents and "·" correctly) and
 * CRLF line ends. A field is quoted when it holds a quote, comma, CR or LF. A cell that a
 * spreadsheet would run as a formula (= + - @ TAB CR at the start) is prefixed with "'".
 */
export function toCsv(header: readonly string[], rows: readonly (readonly string[])[]): string {
  return BOM + line(header) + rows.map(line).join("");
}
