import { ANNEX_A_2022_REFS, GDPR_REFS, NIS2_REFS } from "@isms/control-library";
import { boardPeriods } from "@isms/domain";
import { HIGH_RISKS, type RiskTemplate } from "./catalogue.js";
import { LOW_RISKS } from "./catalogue-low.js";
import { SAMPLE_PEOPLE, SAMPLE_SEED, SAMPLE_SITES } from "./company.js";
import { type Dice, dice, rng } from "./random.js";
import { type Path, type RiskSeed, riskStory } from "./story.js";
import { DAY, type Timeline, isHoliday, isoDay, timeline } from "./time.js";
import * as T from "./texts.js";
import type { SampleEvent, SamplePlan } from "./types.js";

/** About 120 risks; the first are reported just over a year ago, so their reviews fall due. */
export const SAMPLE_RISK_COUNT = 120;
/** Setup is done this many days ago; risks start a few days later. */
export const SETUP_DAYS_AGO = 404;
const FIRST_REPORT_DAYS_AGO = 400;
/** Reported this long ago or more: approved early enough that the yearly review falls due. */
const REVIEW_AGE = 362;
/** Reported this long ago or more: the go-live months, when the register is filled. */
const GO_LIVE_DAYS = 300;
/**
 * The three weeks (counted back from today) busy after the phishing incident, about seven
 * months ago: the run within weeks 28..32 with the most working days outside the holiday.
 */
function incidentWeeks(tl: Timeline): ReadonlySet<number> {
  const workDays = (k: number) => {
    let n = 0;
    for (let day = 7 * k + 1; day <= 7 * k + 7; day += 1) {
      const t = tl.today0 - day * DAY;
      const dow = new Date(t).getUTCDay();
      if (dow !== 0 && dow !== 6 && !isHoliday(t)) n += 1;
    }
    return n;
  };
  let best = 29;
  for (const first of [29, 28, 30])
    if (
      workDays(first) + workDays(first + 1) + workDays(first + 2) >
      workDays(best) + workDays(best + 1) + workDays(best + 2)
    )
      best = first;
  return new Set([best, best + 1, best + 2]);
}

const DEPARTMENT_OWNER: Readonly<Record<string, string>> = {
  "it-operations": "max",
  "information-security": "erika",
  finance: "paul",
  facilities: "fritz",
  compliance: "ida",
  hr: "nina",
  "customer-service": "nina",
  "software-development": "lena",
};
const SITE_OWNER: Readonly<Record<string, string>> = {
  munich: "olga",
  frankfurt: "bernd",
  riga: "lena",
};
const ASSIGNEES = ["theo", "rita", "nina", "paul", "lena", "fritz", "ida", "bernd"] as const;
const SITE_NAME: Readonly<Record<string, string>> = Object.fromEntries(
  SAMPLE_SITES.map((s) => [s.key, s.name]),
);

/**
 * When each risk is reported, as days before today, oldest first: an irregular weekly rhythm,
 * three busy weeks after the incident, nothing at weekends or in the December holiday. Exactly
 * SAMPLE_RISK_COUNT, shared out by largest remainder.
 */
function schedule(
  d: Dice,
  tl: Timeline,
  incident: ReadonlySet<number>,
): { daysAgo: number; week: number }[] {
  const weeks: { k: number; days: number[]; weight: number }[] = [];
  for (let k = 0; 7 * k + 1 <= FIRST_REPORT_DAYS_AGO; k += 1) {
    const days: number[] = [];
    for (let day = 7 * k + 1; day <= Math.min(7 * k + 7, FIRST_REPORT_DAYS_AGO); day += 1) {
      const date = new Date(tl.today0 - day * DAY);
      const weekend = date.getUTCDay() === 0 || date.getUTCDay() === 6;
      if (!weekend && !isHoliday(date.getTime())) days.push(day);
    }
    // The first months after go-live are busy too: the register is filled with known risks.
    const start = 7 * k + 1 >= GO_LIVE_DAYS ? 0.7 : 0;
    const base = incident.has(k) ? 5.6 + d.next() * 0.6 : 0.5 + start + d.next() * 1.2;
    weeks.push({ k, days, weight: (base * days.length) / 5 });
  }
  const total = weeks.reduce((sum, w) => sum + w.weight, 0);
  const shares = weeks.map((w) => ({ w, exact: (SAMPLE_RISK_COUNT * w.weight) / total }));
  const counts = new Map(shares.map(({ w, exact }) => [w.k, Math.floor(exact)]));
  let left = SAMPLE_RISK_COUNT - [...counts.values()].reduce((a, b) => a + b, 0);
  for (const { w } of [...shares].sort((a, b) => (b.exact % 1) - (a.exact % 1) || a.w.k - b.w.k)) {
    if (left === 0) break;
    if (w.days.length === 0) continue;
    counts.set(w.k, (counts.get(w.k) ?? 0) + 1);
    left -= 1;
  }
  const out: { daysAgo: number; week: number }[] = [];
  for (const w of weeks)
    for (let n = 0; n < (counts.get(w.k) ?? 0); n += 1)
      out.push({ daysAgo: d.pick(w.days), week: w.k });
  return out.sort((a, b) => b.daysAgo - a.daysAgo);
}

/** The chance a new risk is above appetite, by when it is reported: high early, lower later. */
function highChance(daysAgo: number, incident: boolean): number {
  if (incident) return 0.7;
  if (daysAgo >= REVIEW_AGE) return 0.3;
  if (daysAgo >= GO_LIVE_DAYS) return 0.85;
  if (daysAgo >= 200) return 0.3;
  if (daysAgo >= 90) return 0.12;
  return 0.08;
}

function choosePath(d: Dice, age: number, high: boolean): Path {
  if (age >= REVIEW_AGE) return "reviewed";
  if (high) {
    if (age >= 120)
      return d.weighted<Path>([
        ["closed", 80],
        ["closed_reassessed", 10],
        ["approved", 5],
        ["accepted", 3],
        ["return_approve", 2],
      ]);
    if (age >= 40)
      return d.weighted<Path>([
        ["approved", 40],
        ["return_approve", 15],
        ["closed", 40],
        ["accepted", 5],
      ]);
    return d.weighted<Path>([
      ["draft", 25],
      ["in_review", 30],
      ["returned", 15],
      ["approved", 30],
    ]);
  }
  if (age >= 120)
    return d.weighted<Path>([
      ["approved", 33],
      ["closed", 30],
      ["accepted", 12],
      ["return_approve", 10],
      ["closed_reassessed", 6],
      ["approved_reassessed", 5],
      ["draft", 4],
    ]);
  if (age >= 40)
    return d.weighted<Path>([
      ["approved", 45],
      ["accepted", 10],
      ["return_approve", 15],
      ["closed", 15],
      ["draft", 5],
      ["in_review", 5],
      ["returned", 5],
    ]);
  return d.weighted<Path>([
    ["draft", 15],
    ["draft_unscored", 15],
    ["in_review", 25],
    ["returned", 15],
    ["approved", 25],
    ["accepted", 5],
  ]);
}

/** Owner, site and department fit together: the owner holds risk_owner (or ciso) where it sits. */
function place(d: Dice, template: RiskTemplate): { owner: string; site: string } {
  const deptOwner = DEPARTMENT_OWNER[template.department] ?? "carl";
  const deptShare = deptOwner === "max" ? 0.9 : deptOwner === "erika" ? 0.7 : 0.5;
  const anySite = () =>
    d.weighted([
      ["munich", 50],
      ["frankfurt", 30],
      ["riga", 20],
    ] as const);
  const roll = d.next();
  if (roll < deptShare)
    return { owner: deptOwner, site: deptOwner === "lena" ? "riga" : anySite() };
  if (roll < deptShare + (1 - deptShare) * 0.7) {
    const site = anySite();
    return { owner: SITE_OWNER[site] ?? "carl", site };
  }
  return { owner: "carl", site: anySite() };
}

/**
 * Paths every load must show, whatever the calendar: given to the youngest risks old enough to
 * finish them before the December holiday can cut them short.
 */
type Anchor = { minAge: number; path: Path; approveOn?: number; closeOn?: number };

const anchors = (now: Date, tl: Timeline): Anchor[] => {
  const last = boardPeriods(now)[1];
  const day = (n: number) =>
    last ? Date.parse(`${last.start}T00:00:00Z`) + (n - 1) * DAY + 10 * 60 * 60_000 : tl.today0;
  return [
    ...FIXED_ANCHORS,
    // Last month's board pack always shows an approval and a risk treated.
    { minAge: 90, path: "approved", approveOn: day(8) },
    { minAge: 150, path: "closed", closeOn: day(14) },
  ];
};

const FIXED_ANCHORS: readonly Anchor[] = [
  { minAge: 40, path: "returned" },
  { minAge: 40, path: "returned" },
  { minAge: 40, path: "in_review" },
  { minAge: 40, path: "draft" },
  { minAge: 40, path: "draft_unscored" },
  { minAge: 230, path: "closed_reassessed" },
  { minAge: 230, path: "closed_reassessed" },
];

function anchor(all: RiskSeed[], tl: Timeline, list: readonly Anchor[]): RiskSeed[] {
  const oldest = all[0];
  if (oldest) oldest.confirmReview = true;
  const taken = new Set<string>();
  for (const a of list) {
    const fit = all
      .filter(
        (s) =>
          !taken.has(s.key) && s.owner !== "max" && (tl.today0 - s.reportedAt) / DAY >= a.minAge,
      )
      .sort((x, y) => y.reportedAt - x.reportedAt)[0];
    if (!fit) continue;
    taken.add(fit.key);
    fit.path = a.path;
    if (a.approveOn !== undefined) fit.approveOn = a.approveOn;
    if (a.closeOn !== undefined) fit.closeOn = a.closeOn;
  }
  return all;
}

function seeds(d: Dice, tl: Timeline, now: Date): RiskSeed[] {
  const used = new Map<string, number>();
  const busy = incidentWeeks(tl);
  return anchor(
    schedule(d, tl, busy).map(({ daysAgo, week }, n) => {
      const incident = busy.has(week) && d.chance(0.75);
      const high = d.chance(highChance(daysAgo, incident));
      const pool = high
        ? incident
          ? HIGH_RISKS.filter((x) => x.incident)
          : HIGH_RISKS
        : LOW_RISKS;
      const template = d.pick(pool);
      const { owner, site } = place(d, template);
      let path = choosePath(d, daysAgo, high);
      // Max owns a backlog: he rarely closes what is within appetite.
      if (owner === "max" && !high && (path === "closed" || path === "closed_reassessed"))
        path = "approved";
      const uses = used.get(template.title) ?? 0;
      used.set(template.title, uses + 1);
      const title =
        uses === 0
          ? template.title
          : uses === 1
            ? `${template.title} at ${SITE_NAME[site] ?? site}`
            : `${template.title} (case ${String(uses + 1)})`;
      const reporter = d.weighted([
        ["rita", 30],
        ["theo", 25],
        [owner, 20],
        ["carl", 8],
        [site === "munich" ? "olga" : "rita", 17],
      ] as const);
      return {
        key: `r${String(n + 1).padStart(3, "0")}`,
        template,
        title,
        reportedAt: tl.onDay(daysAgo),
        path,
        high,
        owner,
        reviewer: d.chance(0.75) ? owner : "carl",
        reporter,
        site,
        department: template.department,
        closeAfter: owner === "erika" || incident ? [10, 45] : high ? [40, 120] : [10, 90],
        doneChance: owner === "max" ? 0.2 : 0.75,
        assignees: ASSIGNEES,
      };
    }),
    tl,
    anchors(now, tl),
  );
}

/** Control tests on evidenced controls, with every result at least once. */
function controlTests(d: Dice, tl: Timeline, events: readonly SampleEvent[]): SampleEvent[] {
  const evidence = events.flatMap((e) => (e.kind === "evidence" ? [e] : []));
  const out: SampleEvent[] = [];
  const results = ["ineffective", "partially_effective", "effective"] as const;
  let n = 0;
  for (const e of evidence) {
    if (n >= 3 && !d.chance(0.45)) continue;
    const at = tl.later(e.at.getTime(), 3, 40);
    if (at === null) continue;
    const control = e.controls[0] ?? "";
    const linked = evidence
      .filter((x) => x.controls.includes(control) && x.at.getTime() < at)
      .map((x) => x.evidence);
    const result =
      n < 3
        ? (results[n] ?? "effective")
        : d.weighted([
            ["effective", 60],
            ["partially_effective", 25],
            ["ineffective", 15],
          ] as const);
    n += 1;
    out.push({
      at: new Date(at),
      kind: "control_test",
      by: "carl",
      test: `t${String(n).padStart(3, "0")}`,
      control,
      testedOn: isoDay(at),
      result,
      method: d.pick(T.TEST_METHODS),
      notes: T.TEST_NOTES[result],
      evidence: linked,
    });
  }
  return out;
}

/** Statement of Applicability decisions by the CISO in the first months, some not applicable. */
function soa(d: Dice, tl: Timeline): SampleEvent[] {
  const out: SampleEvent[] = [];
  let t = tl.onDay(SETUP_DAYS_AGO - 10);
  const decide = (framework: string, ref: string) => {
    const next = tl.later(t, 0, 1);
    if (next === null) return;
    t = next;
    const reason = T.SOA_NOT_APPLICABLE[ref];
    out.push({
      at: new Date(t),
      kind: "soa",
      by: "carl",
      framework,
      ref,
      applicable: reason === undefined,
      justification: reason ?? d.pick(T.SOA_APPLICABLE),
    });
  };
  for (const ref of ANNEX_A_2022_REFS)
    if (T.SOA_NOT_APPLICABLE[ref] !== undefined || d.chance(0.8)) decide("iso27001-2022", ref);
  for (const ref of NIS2_REFS) decide("nis2-2022-2555", ref);
  for (const ref of GDPR_REFS) decide("gdpr-2016-679", ref);
  return out;
}

/** What the plan shows for one month, for its narrative. */
function narrativeFacts(
  events: readonly SampleEvent[],
  from: number,
  to: number,
): T.NarrativeFacts {
  const inMonth = events.filter((e) => e.at.getTime() >= from && e.at.getTime() < to);
  /** Distinct risks with an event of this kind among `of`. */
  const risks = (of: readonly SampleEvent[], kind: SampleEvent["kind"]) =>
    new Set(of.flatMap((e) => (e.kind === kind && "risk" in e ? [e.risk] : []))).size;
  const tests = inMonth.flatMap((e) => (e.kind === "control_test" ? [e.result] : []));
  return {
    month: new Date(from).getUTCMonth(),
    approved: risks(inMonth, "approve"),
    treated: risks(inMonth, "close"),
    reviewed: inMonth.filter((e) => e.kind === "review").length,
    tested: tests.length,
    gaps: tests.filter((r) => r !== "effective").length,
    accepted: risks(
      events.filter((e) => e.at.getTime() < to),
      "accept",
    ),
  };
}

/**
 * Approved board narratives for the last three full months, a few days after each ends, each
 * describing what the plan shows for its month. A month is only narrated once it has ended
 * before today: when today is the 1st, last month has no narrative yet.
 */
function narratives(
  d: Dice,
  tl: Timeline,
  now: Date,
  events: readonly SampleEvent[],
): SampleEvent[] {
  return boardPeriods(now)
    .slice(1, 4)
    .flatMap((p, n): SampleEvent[] => {
      const from = Date.parse(`${p.start}T00:00:00Z`);
      // The period's last day is inclusive: it has ended at the next midnight.
      const ended = Date.parse(`${p.end}T00:00:00Z`) + DAY;
      if (ended >= tl.today0) return [];
      const at = tl.later(ended - DAY, 2, 5) ?? tl.onDay(1);
      return [
        {
          at: new Date(Math.max(at, ended)),
          kind: "narrative",
          by: "carl",
          periodKey: p.key,
          periodStart: p.start,
          periodEnd: p.end,
          text: T.narrativeText(narrativeFacts(events, from, ended), n),
        },
      ];
    });
}

/** The whole year, sorted by `at`. Pure: same (now, seed) → same plan. */
export function planSampleYear(now: Date, seed: number = SAMPLE_SEED): SamplePlan {
  const d = dice(rng(seed));
  const tl = timeline(now, d);
  const stories = seeds(d, tl, now).flatMap((s) => riskStory(s, d, tl));
  const history = [...soa(d, tl), ...stories, ...controlTests(d, tl, stories)];
  const events = [...history, ...narratives(d, tl, now, history)];
  // A stable sort keeps each risk's same-millisecond events in story order.
  events.sort((a, b) => a.at.getTime() - b.at.getTime());
  return {
    people: SAMPLE_PEOPLE.map((p) => ({ ...p, roles: p.roles.map((r) => ({ ...r })) })),
    events,
  };
}
