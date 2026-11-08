/** Reference numbers only. Titles and text of the standards are never stored here (ADR-0008). */
const counts = [
  [5, 37],
  [6, 8],
  [7, 14],
  [8, 34],
] as const;

export const ANNEX_A_2022_REFS: string[] = counts.flatMap(([clause, n]) =>
  Array.from({ length: n }, (_, i) => `A.${String(clause)}.${String(i + 1)}`),
);

export const GDPR_REFS = [
  "Art. 5(1)(a)",
  "Art. 5(1)(b)",
  "Art. 5(1)(c)",
  "Art. 5(1)(d)",
  "Art. 5(1)(e)",
  "Art. 5(1)(f)",
  "Art. 5(2)",
  "Art. 24",
  "Art. 25(1)",
  "Art. 25(2)",
  "Art. 28",
  "Art. 30",
  "Art. 32",
  "Art. 33",
  "Art. 34",
  "Art. 35",
];

export const NIS2_REFS = "abcdefghij".split("").map((letter) => `Art. 21(2)(${letter})`);

/**
 * EU AI Act (Regulation (EU) 2024/1689): the obligation-bearing provisions the AI system
 * register's obligation catalogue uses (#16), in article order, each with the Chapter it sits in.
 */
export const EU_AI_ACT_CHAPTER_REFS: [chapter: string, refs: string[]][] = [
  ["Chapter I", ["Art. 4"]],
  ["Chapter II", ["Art. 5"]],
  [
    "Chapter III",
    [
      ...["Art. 6(3)", "Art. 6(4)", "Art. 9", "Art. 10", "Art. 11", "Art. 12", "Art. 13"],
      ...["Art. 14", "Art. 15", "Art. 17", "Art. 20", "Art. 23", "Art. 24"],
      ...["1", "2", "4", "5", "6", "7", "9", "11"].map((p) => `Art. 26(${p})`),
      ...["Art. 27", "Art. 43", "Art. 47", "Art. 48", "Art. 49(1)", "Art. 49(2)"],
    ],
  ],
  ["Chapter IV", ["1", "2", "3", "4"].map((p) => `Art. 50(${p})`)],
  ["Chapter IX", ["Art. 72", "Art. 73", "Art. 86"]],
];

export const EU_AI_ACT_REFS: string[] = EU_AI_ACT_CHAPTER_REFS.flatMap(([, refs]) => refs);

/**
 * NIST CSF 2.0 subcategories in Core order (CSWP 29, Appendix A). Each category lists its
 * numbers; withdrawn numbers (for example ID.AM-06) are left out.
 */
const nistCategories: [string, number[]][] = [
  ["GV.OC", [1, 2, 3, 4, 5]],
  ["GV.RM", [1, 2, 3, 4, 5, 6, 7]],
  ["GV.RR", [1, 2, 3, 4]],
  ["GV.PO", [1, 2]],
  ["GV.OV", [1, 2, 3]],
  ["GV.SC", [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]],
  ["ID.AM", [1, 2, 3, 4, 5, 7, 8]],
  ["ID.RA", [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]],
  ["ID.IM", [1, 2, 3, 4]],
  ["PR.AA", [1, 2, 3, 4, 5, 6]],
  ["PR.AT", [1, 2]],
  ["PR.DS", [1, 2, 10, 11]],
  ["PR.PS", [1, 2, 3, 4, 5, 6]],
  ["PR.IR", [1, 2, 3, 4]],
  ["DE.CM", [1, 2, 3, 6, 9]],
  ["DE.AE", [2, 3, 4, 6, 7, 8]],
  ["RS.MA", [1, 2, 3, 4, 5]],
  ["RS.AN", [3, 6, 7, 8]],
  ["RS.CO", [2, 3]],
  ["RS.MI", [1, 2]],
  ["RC.RP", [1, 2, 3, 4, 5, 6]],
  ["RC.CO", [3, 4]],
];

export const NIST_CSF_2_REFS: string[] = nistCategories.flatMap(([category, numbers]) =>
  numbers.map((n) => `${category}-${String(n).padStart(2, "0")}`),
);

/**
 * NIST SP 800-53 Rev. 5 base controls in the SP 800-53B Moderate baseline, in catalogue order.
 * Enhancements such as AC-2(1) are left out (P12-R1).
 */
const sp80053Families: [string, number[]][] = [
  ["AC", [1, 2, 3, 4, 5, 6, 7, 8, 11, 12, 14, 17, 18, 19, 20, 21, 22]],
  ["AT", [1, 2, 3, 4]],
  ["AU", [1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 12]],
  ["CA", [1, 2, 3, 5, 6, 7, 9]],
  ["CM", [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]],
  ["CP", [1, 2, 3, 4, 6, 7, 8, 9, 10]],
  ["IA", [1, 2, 3, 4, 5, 6, 7, 8, 11, 12]],
  ["IR", [1, 2, 3, 4, 5, 6, 7, 8]],
  ["MA", [1, 2, 3, 4, 5, 6]],
  ["MP", [1, 2, 3, 4, 5, 6, 7]],
  ["PE", [1, 2, 3, 4, 5, 6, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17]],
  ["PL", [1, 2, 4, 8, 10, 11]],
  ["PS", [1, 2, 3, 4, 5, 6, 7, 8, 9]],
  ["RA", [1, 2, 3, 5, 7, 9]],
  ["SA", [1, 2, 3, 4, 5, 8, 9, 10, 11, 15, 22]],
  ["SC", [1, 2, 4, 5, 7, 8, 10, 12, 13, 15, 17, 18, 20, 21, 22, 23, 28, 39]],
  ["SI", [1, 2, 3, 4, 5, 7, 8, 10, 11, 12, 16]],
  ["SR", [1, 2, 3, 5, 6, 8, 10, 11, 12]],
];

export const NIST_SP800_53_MODERATE_REFS: string[] = sp80053Families.flatMap(([family, numbers]) =>
  numbers.map((n) => `${family}-${String(n)}`),
);

/** Inclusive range within one clause, e.g. isoRange("A.5.3", "A.5.5"). */
export function isoRange(from: string, to: string): string[] {
  const parse = (ref: string) => /^(A\.\d+)\.(\d+)$/.exec(ref);
  const a = parse(from);
  const b = parse(to);
  if (!a || !b || a[1] !== b[1])
    throw new Error(`isoRange needs two refs in one clause: ${from}, ${to}`);
  const start = Number(a[2]);
  const end = Number(b[2]);
  if (start > end) throw new Error(`isoRange runs backwards: ${from}, ${to}`);
  return Array.from({ length: end - start + 1 }, (_, i) => `${a[1] ?? ""}.${String(start + i)}`);
}
