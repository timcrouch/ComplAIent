# ADR-0012: Report files (XLSX and PDF)

Status: Accepted (2026-11-06)

## Context

Plan 7 (spec §5) exports the risk register, the Statement of Applicability and the board pack as files that auditors and boards keep. The API builds them on request, synchronously, from the same data as the JSON routes, so the viewer's risk visibility applies. Only small, pure-JavaScript libraries were wanted: no headless browser, no native bindings (the images are Alpine), and nothing fetched at run time.

## Decision

- **Libraries**, pinned exactly in `apps/api` (ADR-0002):

  | Package            | Version | Licence | Use                                                                                  |
  | ------------------ | ------- | ------- | ------------------------------------------------------------------------------------ |
  | `write-excel-file` | 4.1.1   | MIT     | XLSX (`write-excel-file/node`), ships its own types                                  |
  | `pdfmake`          | 0.3.12  | MIT     | PDF (on pdfkit), declarative document definitions                                    |
  | `fflate`           | 0.8.3   | MIT     | dev only: tests unzip the XLSX (already a transitive dependency of write-excel-file) |

  Their new transitive packages (pdfkit, fontkit, linebreak, xmldoc, sax and others) had no OSV advisories on 2026-11-06.

- **Types.** pdfmake 0.3 ships none, and `@types/pdfmake` describes 0.2. `apps/api/src/types/pdfmake.d.ts` declares the few members used (`virtualfs`, `setFonts`, the two access policies, `createPdf().getBuffer()`). Document definitions are typed locally (`render/pdf-frame.ts`).
- **Fonts.** pdfmake's bundled Roboto (`pdfmake/build/vfs_fonts.js`) is written into pdfmake's virtual file system on first use. The URL and local-file access policies refuse everything, so a report never reads a file or fetches a URL. The API build stays transpile-only (`isms-build-js`): the packages are resolved from `node_modules` at run time and `pnpm deploy --prod` carries them into the image.
- **Formula injection (P7-R4).** Every XLSX text cell is an explicit string cell. Text starting with `=`, `+`, `-`, `@`, a tab or a carriage return gets a leading `'`. No cell is ever a formula. Dates are real dates (`yyyy-mm-dd`), numbers are numbers.
- **What a file carries.** "ComplAIent ISMS", the organisation, "Generated <UTC date time> by <name>", the scope line and "Confidential: internal use"; PDFs repeat them in every page's header and footer with "Page N of M". XLSX files have the data sheet (header row frozen, filters on) and an "About" sheet. Requirement full text never goes into a file (P7-R2).
- **Routes.** `GET /api/v1/reports/{register,soa}.{xlsx,pdf}` and `board.pdf`, with the JSON routes' queries and `reports.read`. Each writes `report.exported` (`{ kind, format, filters }`, never the content) and answers `Content-Disposition: attachment; filename="complaient-<report>-<YYYY-MM-DD>.<ext>"`. The web proxies them at `/reports/files/[file]` behind an allowlist of five names (P7-R6).

## Consequences

- Files are built in memory. The register is capped at 5000 rows (409 `reportTooLarge`), which keeps a file to a few megabytes. The register PDF is capped tighter, at 1000 rows (P7-R10): pdfmake lays a document out synchronously on the API's event loop, so a larger PDF would stall other requests. Excel keeps the 5000-row cap, so a register of 1001 to 5000 rows still downloads as Excel while its PDF answers 409 `reportTooLarge`.
- pdfmake is a process-wide singleton; its fonts and policies are set once and never changed elsewhere.
