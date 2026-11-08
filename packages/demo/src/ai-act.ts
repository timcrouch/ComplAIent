import { applicableObligations, classifyAiSystem, formatRiskReference } from "@isms/domain";
import type { Builder, Json } from "./builder.js";
import {
  AI_ACT_ENABLED_DAYS_AGO,
  SAMPLE_AI_ACT_FRAMEWORK,
  SAMPLE_AI_SYSTEMS,
  type SampleAiSystem,
  type SampleObligationWork,
} from "./ai-act-systems.js";
import { confirmFramework, departmentId } from "./setup.js";
import { DAY, MINUTE, isHoliday, isWeekend } from "./time.js";
import type { SampleRows } from "./types.js";

type SystemRow = SampleRows["aiSystems"][number];

/** The profile fields in the order `ai_system.created` records them (ai-systems.service). */
const FIELDS = [
  "name",
  "description",
  "intendedPurpose",
  "role",
  "supplier",
  "model",
  "usesGeneralPurposeModel",
  "status",
  "ownerId",
  "departmentId",
] as const;
/** Free text, which the audit trail records by length only. */
const TEXT_FIELDS: ReadonlySet<string> = new Set(["description", "intendedPurpose"]);

/** Plain JSON (readonly arrays and all), as the audit trail stores it. */
const plain = (value: unknown): Json => JSON.parse(JSON.stringify(value)) as Json;

/** One step of the module's history: when, in which order that day, and what it writes. */
type Step = { daysAgo: number; run: (at: Date) => void };

/**
 * A working-hours time `daysAgo` days before today, moved back off weekends and out of the
 * December holiday. `slot` spreads the steps of one day over the morning.
 */
function workTime(today0: number, daysAgo: number, slot: number): number {
  let t = today0 - daysAgo * DAY;
  while (isWeekend(t) || isHoliday(t)) t -= DAY;
  return t + (9 * 60 + 20 + ((slot * 37) % 400)) * MINUTE;
}

/** `ai_system.created` (ai-systems.service create). */
function create(b: Builder, s: SampleAiSystem, at: Date): SystemRow {
  const carl = b.user("carl");
  const p = s.profile;
  const row: SystemRow = {
    id: b.id(at),
    name: p.name,
    nameKey: p.name.trim().toLowerCase(),
    description: p.description,
    intendedPurpose: p.intendedPurpose,
    role: p.role,
    supplier: p.supplier,
    model: p.model,
    usesGeneralPurposeModel: p.usesGeneralPurposeModel,
    status: p.status,
    ownerId: b.user(p.owner),
    departmentId: p.department === null ? null : departmentId(b, p.department),
    riskClass: "unclassified",
    classification: {},
    classifiedAt: null,
    classifiedById: null,
    createdById: carl,
    createdAt: at,
    updatedAt: at,
  };
  b.rows.aiSystems.push(row);
  const after: Record<string, Json | null> = {};
  for (const field of FIELDS) {
    const value = row[field] ?? null;
    after[field] = TEXT_FIELDS.has(field)
      ? { changed: true, length: typeof value === "string" ? value.length : 0 }
      : value;
  }
  b.audit(at, carl, "ai_system.created", "AiSystem", row.id, after);
  return row;
}

/**
 * `ai_system.classified` (ai-system-classification.service classify): the class from
 * `classifyAiSystem`, the obligations from the catalogue, a first reconciliation that opens
 * every applicable key.
 */
function classify(b: Builder, s: SampleAiSystem, row: SystemRow, at: Date): void {
  const carl = b.user("carl");
  const result = classifyAiSystem(s.answers);
  const added = applicableObligations(result, row.role, s.answers);
  const before = row.riskClass ?? "unclassified";
  Object.assign(row, {
    riskClass: result.riskClass,
    classification: plain({
      version: 1,
      answers: s.answers,
      source: "manual",
      result,
    }),
    classifiedAt: at,
    classifiedById: carl,
    updatedAt: at,
  });
  for (const key of added)
    b.rows.aiSystemObligations.push({
      aiSystemId: row.id,
      key,
      applicable: true,
      status: "open",
      note: "",
      updatedById: null,
      createdAt: at,
      updatedAt: at,
    });
  b.audit(
    at,
    carl,
    "ai_system.classified",
    "AiSystem",
    row.id,
    {
      riskClass: result.riskClass,
      source: "manual",
      derogationApplied: result.derogationApplied,
      transparencyDuties: plain(result.transparencyDuties),
      answers: plain(s.answers),
      obligations: { added, nowApplicable: [], nowInapplicable: [] },
    },
    { riskClass: before },
  );
}

/** `ai_system.obligation_updated`: the note itself is never in the trail, only that it changed. */
function work(b: Builder, row: SystemRow, w: SampleObligationWork, at: Date): void {
  const carl = b.user("carl");
  const stored = b.rows.aiSystemObligations.find(
    (o) => o.aiSystemId === row.id && o.key === w.obligation,
  );
  if (!stored) throw new Error(`${row.name} has no obligation ${w.obligation}`);
  const status = stored.status ?? "open";
  const noteChanged = w.note !== stored.note;
  if (status === w.status && !noteChanged) throw new Error(`no change to ${w.obligation}`);
  b.audit(
    at,
    carl,
    "ai_system.obligation_updated",
    "AiSystem",
    row.id,
    {
      obligation: w.obligation,
      status: w.status,
      ...(noteChanged ? { noteChanged: true } : {}),
    },
    { obligation: w.obligation, status },
  );
  Object.assign(stored, {
    status: w.status,
    note: w.note,
    updatedById: carl,
    updatedAt: at,
  });
}

/** `ai_system.risk_linked`: the first sample risk with a fitting title reported before `at`. */
function link(b: Builder, row: SystemRow, titles: readonly string[], at: Date): void {
  const risk = titles
    .map(
      (title) =>
        b.rows.risks
          .filter((r) => r.title === title && r.createdAt.getTime() < at.getTime())
          .sort((x, y) => x.reference - y.reference)[0],
    )
    .find((r) => r !== undefined);
  if (!risk) return;
  const carl = b.user("carl");
  b.rows.aiSystemRisks.push({
    aiSystemId: row.id,
    riskId: risk.id,
    linkedById: carl,
    linkedAt: at,
  });
  b.audit(at, carl, "ai_system.risk_linked", "AiSystem", row.id, {
    riskId: risk.id,
    riskReference: formatRiskReference(risk.reference),
  });
}

/**
 * The EU AI Act module's history, written after the risk year (it links to sample risks):
 * Anna turns the module on and puts the AI Act in scope, then Carl adds and classifies the
 * four systems, links the credit scoring engine to a risk and works on obligations. Every
 * row and audit payload is as the API writes it; times are whole days before today.
 */
export function writeAiAct(b: Builder, today0: number): void {
  const anna = b.user("anna");
  const steps: Step[] = [
    {
      daysAgo: AI_ACT_ENABLED_DAYS_AGO,
      run: (at) => {
        b.rows.organisationModules.push({
          key: "eu_ai_act",
          enabledAt: at,
          enabledById: anna,
        });
        b.audit(
          at,
          anna,
          "organisation.module_enabled",
          "OrganisationModule",
          "eu_ai_act",
          { enabled: true },
          { enabled: false },
        );
      },
    },
    {
      daysAgo: AI_ACT_ENABLED_DAYS_AGO,
      run: (at) => {
        confirmFramework(b, at, SAMPLE_AI_ACT_FRAMEWORK, anna);
      },
    },
  ];
  for (const s of SAMPLE_AI_SYSTEMS) {
    let row: SystemRow | undefined;
    const system = () => {
      if (!row) throw new Error(`${s.key} is not added yet`);
      return row;
    };
    steps.push(
      {
        daysAgo: s.createdDaysAgo,
        run: (at) => {
          row = create(b, s, at);
        },
      },
      {
        daysAgo: s.createdDaysAgo,
        run: (at) => {
          classify(b, s, system(), at);
        },
      },
    );
    const linkRisk = s.linkRisk;
    if (linkRisk)
      steps.push({
        daysAgo: linkRisk.daysAgo,
        run: (at) => {
          link(b, system(), linkRisk.titles, at);
        },
      });
    for (const w of s.work)
      steps.push({
        daysAgo: w.daysAgo,
        run: (at) => {
          work(b, system(), w, at);
        },
      });
  }

  // Oldest first; a stable sort keeps one day's steps in the order above. Each step is at
  // least a few minutes after the one before, whatever the weekend and holiday moves did.
  steps.sort((x, y) => y.daysAgo - x.daysAgo);
  let last = 0;
  steps.forEach((step, n) => {
    const t = Math.max(workTime(today0, step.daysAgo, n), last + 7 * MINUTE);
    if (t >= today0) throw new Error("an AI Act step is not in the past");
    last = t;
    b.requestId = `sample:ai-act-${String(n).padStart(3, "0")}`;
    step.run(new Date(t));
  });
}
