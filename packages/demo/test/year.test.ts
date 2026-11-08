import { describe, expect, it } from "vitest";
import {
  SAMPLE_DOMAIN,
  SAMPLE_ORG_NAME,
  SAMPLE_PEOPLE,
  SAMPLE_SITES,
  type SampleEvent,
  planSampleYear,
} from "../src/index.js";
import { NOWS } from "./helpers.js";

const DAY = 86_400_000;

describe("the sample company", () => {
  it("is visibly a sample", () => {
    expect(SAMPLE_ORG_NAME).toBe("Isarwerk Finanz AG (sample)");
    expect(SAMPLE_DOMAIN).toBe("@example.test");
    for (const p of SAMPLE_PEOPLE) expect(p.email.endsWith(SAMPLE_DOMAIN)).toBe(true);
  });

  it("has the six dev users with the spec's roles and about ten fictional people", () => {
    const signIn = SAMPLE_PEOPLE.filter((p) => p.signsIn);
    expect(signIn.map((p) => [p.displayName, p.email, p.roles])).toEqual([
      [
        "Anna Admin",
        "admin@example.test",
        [{ role: "administrator", scope: { kind: "organisation" } }],
      ],
      ["Carl Ciso", "ciso@example.test", [{ role: "ciso", scope: { kind: "organisation" } }]],
      [
        "Olga Owner",
        "owner@example.test",
        [{ role: "risk_owner", scope: { kind: "site", site: "munich" } }],
      ],
      [
        "Adam Approver",
        "approver@example.test",
        [{ role: "risk_approver", scope: { kind: "organisation" } }],
      ],
      [
        "Rita Reporter",
        "reporter@example.test",
        [{ role: "contributor", scope: { kind: "organisation" } }],
      ],
      [
        "Arno Auditor",
        "auditor@example.test",
        [{ role: "auditor", scope: { kind: "organisation" } }],
      ],
    ]);
    const fictional = SAMPLE_PEOPLE.filter((p) => !p.signsIn);
    expect(fictional.length).toBeGreaterThanOrEqual(9);
    expect(fictional.length).toBeLessThanOrEqual(11);
    expect(new Set(SAMPLE_PEOPLE.map((p) => p.email)).size).toBe(SAMPLE_PEOPLE.length);
    expect(SAMPLE_SITES.map((s) => s.name)).toEqual(["Munich", "Frankfurt", "Riga"]);
  });
});

describe.each(NOWS)("planSampleYear at %s", (iso) => {
  const now = new Date(iso);
  const plan = planSampleYear(now);
  const reports = plan.events.filter((e) => e.kind === "report");

  it("is pure: the same now gives a deep-equal plan", () => {
    expect(planSampleYear(now)).toEqual(plan);
  });

  it("is sorted by time and nothing happens after now", () => {
    const times = plan.events.map((e) => e.at.getTime());
    expect(times).toEqual([...times].sort((a, b) => a - b));
    expect(Math.max(...times)).toBeLessThan(now.getTime());
  });

  it("reports about 120 risks", () => {
    expect(reports.length).toBeGreaterThanOrEqual(100);
    expect(reports.length).toBeLessThanOrEqual(140);
  });

  it("closes some risks and reassesses some of them later", () => {
    const closed = new Map<string, number>();
    let reassessedAfterClose = 0;
    for (const e of plan.events) {
      if (e.kind === "close") closed.set(e.risk, e.at.getTime());
      if (e.kind === "reassess" && (closed.get(e.risk) ?? Infinity) < e.at.getTime())
        reassessedAfterClose += 1;
    }
    expect(reassessedAfterClose).toBeGreaterThanOrEqual(1);
  });

  it("is quiet in the last two weeks of December", () => {
    const quiet = reports.filter((e) => e.at.getUTCMonth() === 11 && e.at.getUTCDate() >= 18);
    expect(quiet).toEqual([]);
  });

  it("has its busiest weeks about seven months ago, after an incident", () => {
    const perWeek = new Map<number, number>();
    for (const e of reports) {
      const week = Math.floor((now.getTime() - e.at.getTime()) / (7 * DAY));
      perWeek.set(week, (perWeek.get(week) ?? 0) + 1);
    }
    const busiest = [...perWeek.entries()].sort((a, b) => b[1] - a[1])[0];
    expect(busiest?.[0]).toBeGreaterThanOrEqual(27);
    expect(busiest?.[0]).toBeLessThanOrEqual(33);
  });

  it("writes three sample narratives for past months", () => {
    const narratives = plan.events.filter((e) => e.kind === "narrative");
    expect(narratives).toHaveLength(3);
    for (const n of narratives) expect(n.text.startsWith("Sample narrative:")).toBe(true);
  });

  it("decides the SoA with some requirements not applicable, with reasons", () => {
    const soa = plan.events.filter((e) => e.kind === "soa");
    expect(soa.some((e) => !e.applicable && e.justification.length > 0)).toBe(true);
    expect(soa.some((e) => e.applicable)).toBe(true);
  });

  it("tests controls with all three results", () => {
    const results = new Set(
      plan.events.flatMap((e) => (e.kind === "control_test" ? [e.result] : [])),
    );
    expect([...results].sort()).toEqual(["effective", "ineffective", "partially_effective"]);
  });

  it("only uses known people", () => {
    const keys = new Set(plan.people.map((p) => p.key));
    for (const e of plan.events) expect(keys.has(e.by), `${e.kind} by ${e.by}`).toBe(true);
  });
});

/** Distinct risks with an event of `kind` among `events`. */
const risksWith = (events: readonly SampleEvent[], kind: SampleEvent["kind"]) =>
  new Set(events.flatMap((e) => (e.kind === kind && "risk" in e ? [e.risk] : []))).size;

describe("sample narratives are true for any date (M3)", () => {
  const MONTH_NAMES = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];
  // One mid-month day per month, every 1st and 2nd of a month, and a few other edges.
  const nows: string[] = [];
  for (let m = 0; m < 12; m += 1) {
    const mm = String(m + 1).padStart(2, "0");
    nows.push(`2027-${mm}-15T09:30:00.000Z`, `2027-${mm}-01T00:05:00.000Z`);
    nows.push(`2027-${mm}-02T13:00:00.000Z`);
  }
  nows.push("2026-12-31T23:59:00.000Z", "2028-03-01T12:00:00.000Z");

  it.each(nows)("at %s", (iso) => {
    const now = new Date(iso);
    const today0 = Math.floor(now.getTime() / DAY) * DAY;
    const plan = planSampleYear(now);
    const narratives = plan.events.flatMap((e) => (e.kind === "narrative" ? [e] : []));
    // On the 1st last month has not ended before today, so it has no narrative yet.
    expect(narratives).toHaveLength(now.getUTCDate() === 1 ? 2 : 3);

    for (const n of narratives) {
      const from = Date.parse(`${n.periodStart}T00:00:00Z`);
      const ended = Date.parse(`${n.periodEnd}T00:00:00Z`) + DAY;
      expect(n.at.getTime(), n.periodKey).toBeGreaterThanOrEqual(ended);
      expect(n.at.getTime(), n.periodKey).toBeLessThan(today0);

      expect(n.text.startsWith("Sample narrative: ")).toBe(true);
      expect(n.text).not.toMatch(/\d/);
      expect(n.text).not.toMatch(/spring|summer|autumn|winter|start of the year/i);
      // It names its own month and no other.
      const month = MONTH_NAMES[new Date(from).getUTCMonth()] ?? "";
      expect(n.text).toContain(month);
      for (const other of MONTH_NAMES.filter((x) => x !== month))
        expect(n.text).not.toContain(other);

      // Each claim matches the plan's events in that month.
      const inMonth = plan.events.filter((e) => e.at.getTime() >= from && e.at.getTime() < ended);
      const results = inMonth.flatMap((e) => (e.kind === "control_test" ? [e.result] : []));
      const gaps = results.filter((r) => r !== "effective").length;
      expect(n.text.includes("found gaps"), "several gaps").toBe(gaps > 1);
      expect(n.text.includes("found a gap"), "one gap").toBe(gaps === 1);
      expect(n.text.includes("worked as designed"), "no gaps").toBe(
        results.length > 0 && gaps === 0,
      );
      expect(n.text.includes("approved"), "approvals").toBe(
        inMonth.some((e) => e.kind === "approve"),
      );
      expect(n.text.includes("marked as treated"), "treated").toBe(
        inMonth.some((e) => e.kind === "close"),
      );
      // Singular or plural as the plan's counts say (#8).
      const reviews = inMonth.filter((e) => e.kind === "review").length;
      expect(n.text.includes("A periodic review of an older risk"), "one review").toBe(
        reviews === 1,
      );
      expect(n.text.includes("reviews of older risks"), "reviews").toBe(reviews > 1);
      const approved = risksWith(inMonth, "approve");
      expect(n.text.includes("a risk was assessed and approved"), "one approval").toBe(
        approved === 1,
      );
      expect(n.text.includes("risks were assessed and approved"), "approvals").toBe(approved > 1);
      const treated = risksWith(inMonth, "close");
      if (n.text.includes("was marked as treated")) expect(treated, "one treated").toBe(1);
      if (n.text.includes("were marked as treated")) expect(treated, "treated").toBeGreaterThan(1);
      const accepted = risksWith(
        plan.events.filter((e) => e.at.getTime() < ended),
        "accept",
      );
      if (n.text.includes("accepted risk ")) expect(accepted, "one accepted").toBe(1);
      if (n.text.includes("accepted risks")) expect(accepted, "accepted").toBeGreaterThan(1);
    }
    // Deterministic.
    expect(planSampleYear(now).events.filter((e) => e.kind === "narrative")).toEqual(narratives);
  });
});
