const TENS = ["twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
// "one" is deliberately absent: too ambiguous ("one of", "no one").
const UNITS = ["two", "three", "four", "five", "six", "seven", "eight", "nine"];
const SMALL = [
  "zero",
  ...UNITS,
  "ten",
  "eleven",
  "twelve",
  "thirteen",
  "fourteen",
  "fifteen",
  "sixteen",
  "seventeen",
  "eighteen",
  "nineteen",
];
const WORD_VALUES: Record<string, number> = {
  zero: 0,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
  hundred: 100,
  thousand: 1e3,
  million: 1e6,
  billion: 1e9,
  dozen: 12,
  half: 0.5,
  quarter: 0.25,
  double: 2,
  twice: 2,
  triple: 3,
  treble: 3,
};
const MULTIPLIER_WORDS = new Set(["double", "twice", "triple", "treble"]);
// Comparisons with no number of their own: always reported, yield no value.
const COMPARISON_WORDS = new Set(["doubled", "tripled", "trebled", "halved", "quadrupled"]);
const MAGNITUDE_EXPONENT: Record<string, number> = {
  hundred: 2,
  thousand: 3,
  k: 3,
  million: 6,
  m: 6,
  billion: 9,
  bn: 9,
};

const SCALES = "hundred|thousand|million|billion|dozen";
const WORD_BASE = [
  `(?:${TENS.join("|")})(?:-|\\s+)(?:one|${UNITS.join("|")})`,
  ...TENS,
  ...SMALL,
  SCALES,
  "half|quarter|double(?!-\\p{L})|twice|triple|treble|doubled|tripled|trebled|halved|quadrupled",
].join("|");

const ENGLISH = String.raw`(?<!\d)(?:\d{1,3}(?:,\d{3})+(?!\d)(?:\.\d+)?|\d+(?:\.\d+)?|\.\d+)`;
const GERMAN = String.raw`(?<!\d)\d{1,3}(?:\.\d{3})+(?:,\d+)?(?!\d)`;
const TOKEN = new RegExp(
  [
    `(?:(?<ger>${GERMAN})|(?<eng>${ENGLISH}))`,
    String.raw`(?:\s*(?<mag>thousand|million|billion|hundred)\b|(?<abbr>k|m|bn)\b|\s+(?<abbr2>k|bn|(?-i:M))\b)?`,
    String.raw`(?<nm>\s?x\b|\s*×|\s+times\b|-?fold\b)?`,
    `|\\b(?<w>${WORD_BASE})(?<ws>(?:\\s+(?:${SCALES}))*)(?:(?<wm>\\s+times|-?fold)|)\\b`,
  ].join(""),
  "giu",
);
const ENGLISH_ONLY = new RegExp(ENGLISH, "gu");

type Token = { text: string; values: number[]; multiplier: boolean };

function toAscii(text: string): string {
  return text.normalize("NFKC").replace(/\p{Nd}/gu, (ch) => {
    let steps = 0;
    for (
      let cp = (ch.codePointAt(0) as number) - 1;
      /\p{Nd}/u.test(String.fromCodePoint(cp));
      cp--
    ) {
      steps += 1;
    }
    return String(steps % 10);
  });
}

function wordValue(word: string): number {
  const lower = word.toLowerCase().replace(/\s+/g, "-");
  const [tens, unit] = lower.split("-");
  if (unit !== undefined)
    return (
      (WORD_VALUES[tens as string] as number) + (unit === "one" ? 1 : (WORD_VALUES[unit] as number))
    );
  return WORD_VALUES[lower] as number;
}

function scale(value: number, exponent: number): number {
  const s = String(value);
  return s.includes("e") ? value * 10 ** exponent : Number(`${s}e${String(exponent)}`);
}

function parse(input: string): Token[] {
  const tokens: Token[] = [];
  for (const m of toAscii(input).matchAll(TOKEN)) {
    const g = m.groups ?? {};
    if (g.w !== undefined) {
      if (COMPARISON_WORDS.has(g.w.toLowerCase())) {
        tokens.push({ text: m[0], values: [], multiplier: true });
        continue;
      }
      let value = wordValue(g.w);
      for (const s of (g.ws ?? "").trim().split(/\s+/).filter(Boolean)) value *= wordValue(s);
      tokens.push({
        text: m[0],
        values: [value],
        multiplier: g.wm !== undefined || MULTIPLIER_WORDS.has(g.w.toLowerCase()),
      });
      continue;
    }
    const exponent = MAGNITUDE_EXPONENT[(g.mag ?? g.abbr ?? g.abbr2 ?? "").toLowerCase()] ?? 0;
    const values: number[] = [];
    if (g.ger !== undefined) {
      values.push(Number(g.ger.replaceAll(".", "").replace(",", ".")));
      for (const e of g.ger.matchAll(ENGLISH_ONLY)) values.push(Number(e[0].replaceAll(",", "")));
    } else {
      values.push(Number((g.eng as string).replaceAll(",", "")));
    }
    tokens.push({
      text: m[0],
      values: [...new Set(values)].map((v) => scale(v, exponent)),
      multiplier: g.nm !== undefined,
    });
  }
  return tokens;
}

/**
 * Every number written in text, in order of appearance (an AI narrative may only use numbers it
 * was given, so this errs towards reporting more rather than fewer).
 * - Text is NFKC-normalised and any Unicode decimal digit becomes ASCII ("１２" -> 12,
 *   "10²" -> 102: superscripts fail safe).
 * - Comma thousands separators are removed ("1,200" -> 1200); a comma not followed by exactly
 *   three digits separates two numbers ("3,4" -> 3, 4; "1,2345" -> 1, 2345).
 * - Decimals: "12.5", ".5" -> 0.5; a sentence-ending "12." yields 12.
 * - German dotted thousands yield BOTH readings, German first: "1.200" -> 1200, 1.2;
 *   "1.200,50" -> 1200.5, 1.2, 50; "1.200.000" -> 1200000, 1.2, 0. All must be allowed.
 * - A "-" before a digit is a separator, never a sign: "-5" yields 5 (the absolute value).
 * - Dates and times split into parts: "2026-10-31" -> 2026, 10, 31; "14:05" -> 14, 5.
 * - References yield their number ("R-0003" -> 3); percentages yield the number ("12.5%" -> 12.5).
 * - Magnitudes scale: "5k" -> 5000, "2m"/"2 million" -> 2000000, "3bn"/"3 billion", "4 thousand".
 * - Spelled-out numbers (case-insensitive, whole words): zero, two-nineteen, twenty-ninety,
 *   hyphenated "forty-two", hundred/thousand/million/billion/dozen, half (0.5), quarter (0.25),
 *   double/twice (2), triple/treble (3), and compounds ("two hundred thousand" -> 200000,
 *   "two dozen" -> 24). "one", "a" and "an" are NOT numbers (too ambiguous).
 */
export function numbersIn(text: string): number[] {
  return parse(text).flatMap((t) => t.values);
}

/** Numbers in `text` that are not in `allowed` (deduplicated, in order of appearance). */
export function unknownNumbers(text: string, allowed: readonly number[]): number[] {
  const known = new Set(allowed);
  return [...new Set(numbersIn(text))].filter((n) => !known.has(n));
}

/**
 * Source tokens (deduplicated, in order) that the narrative may not contain: any token with a
 * number not in `allowed` (every German/English reading must be allowed), and every comparative
 * multiplier expression ("3x", "3×", "3 times", "3-fold", "tenfold", "twice", "double",
 * "triple", "treble") regardless of `allowed`.
 */
export function unknownNumberTokens(text: string, allowed: readonly number[]): string[] {
  const known = new Set(allowed);
  const bad = parse(text)
    .filter((t) => t.multiplier || t.values.some((v) => !known.has(v)))
    .map((t) => t.text);
  return [...new Set(bad)];
}
