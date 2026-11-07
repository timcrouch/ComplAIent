/**
 * Glyphs copied from lucide (https://lucide.dev), lucide-react v1.67.0.
 * ISC License. Copyright (c) for portions of Lucide are held by Cole Bemis 2013-2022 as part
 * of Feather (MIT). All other copyright (c) for Lucide are held by Lucide Contributors 2022.
 * Permission to use, copy, modify, and/or distribute this software for any purpose with or
 * without fee is hereby granted, provided that the above copyright notice and this permission
 * notice appear in all copies. THE SOFTWARE IS PROVIDED "AS IS" WITHOUT WARRANTY OF ANY KIND.
 *
 * The same seven glyphs the web board tiles use (BOARD_TILES), drawn into the PDF as SVG.
 */
import type { BoardTileKey } from "@isms/domain";

const svg =
  (inner: string) =>
  (colour: string): string =>
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="${colour}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;

/** Each glyph as a function of its stroke colour. */
export const TILE_ICON_SVG: Record<BoardTileKey, (colour: string) => string> = {
  openRisks: svg('<circle cx="12" cy="12" r="1"/><circle cx="12" cy="12" r="10"/>'),
  aboveAppetite: svg(
    '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  ),
  reported: svg(
    '<path d="M11.35 22H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.706.706l3.588 3.588A2.4 2.4 0 0 1 20 8v5.35"/><path d="M14 2v5a1 1 0 0 0 1 1h5"/><path d="M14 19h6"/><path d="M17 16v6"/>',
  ),
  approved: svg(
    '<path d="M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76Z"/><path d="m16 9-5.5 5.5L8 12"/>',
  ),
  closed: svg(
    '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>',
  ),
  overdueActions: svg(
    '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2 2"/><path d="M5 3 2 6"/><path d="m22 6-3-3"/><path d="M6.38 18.7 4 21"/><path d="M17.64 18.67 20 21"/>',
  ),
  reviewsDue: svg(
    '<path d="M16 14v2.2l1.6 1"/><path d="M16 2v3"/><path d="M21 7.338V5a2 2 0 00-2-2H5a2 2 0 00-2 2v14a2 2 0 002 2h2.338"/><path d="M3 9h5.859"/><path d="M8 2v3"/><circle cx="16" cy="16" r="6"/>',
  ),
};
