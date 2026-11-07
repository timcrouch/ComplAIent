import type {
  BoardPackResponse,
  RegisterResponse,
  RegisterRowDto,
  SoaResponse,
  SoaRowDto,
} from "@isms/contracts";

const header = {
  generatedAt: "2026-11-06T14:03:09.000Z",
  generatedBy: "Cora CISO",
  organisation: "Acme Bank",
  scope: { kind: "organisation" } as const,
};

export function registerRow(overrides: Partial<RegisterRowDto> = {}): RegisterRowDto {
  return {
    reference: "R-0001",
    title: "Laptop left on the train",
    owner: "Oscar Owner",
    site: "Riga",
    department: "IT",
    state: "approved",
    likelihood: 4,
    impact: 4,
    score: 16,
    aboveAppetite: true,
    treatment: "mitigate",
    residualLikelihood: 2,
    residualImpact: 3,
    residualScore: 6,
    controls: ["GOV-01", "SEC-02"],
    openActions: 2,
    overdueActions: 1,
    nextReviewDue: "2027-10-01",
    approvedBy: "April Approver",
    approvedOn: "2026-10-01",
    closedOn: null,
    ...overrides,
  };
}

/** Three rows, one of them a formula-injection attempt in the title. */
export function registerFixture(rows?: RegisterRowDto[]): RegisterResponse {
  return {
    ...header,
    appetiteThreshold: 9,
    filter: "aboveAppetite",
    includeClosed: false,
    rows: rows ?? [
      registerRow(),
      registerRow({
        reference: "R-0002",
        title: "=SUM(A1)",
        owner: "+cmd",
        site: null,
        department: null,
        state: "proposed",
        likelihood: null,
        impact: null,
        score: null,
        aboveAppetite: null,
        treatment: null,
        residualLikelihood: null,
        residualImpact: null,
        residualScore: null,
        controls: [],
        openActions: 0,
        overdueActions: 0,
        nextReviewDue: null,
        approvedBy: null,
        approvedOn: null,
      }),
      registerRow({
        reference: "R-0003",
        title: "@risk\tname",
        state: "closed",
        closedOn: "2026-11-01",
      }),
    ],
  };
}

export function soaRow(overrides: Partial<SoaRowDto> = {}): SoaRowDto {
  return {
    requirementId: "0194f0c0-0000-7000-8000-000000000001",
    ref: "A.5.1",
    title: "Policies for information security",
    fullText: null,
    decision: {
      applicable: true,
      justification: "We keep policies.",
      decidedBy: "Cora CISO",
      decidedAt: "2026-11-01T09:00:00.000Z",
    },
    hint: { kind: "used", refs: ["R-0001"], hiddenCount: 0 },
    controls: [{ code: "GOV-01", title: "Security policy", status: "implementedTested" }],
    riskRefs: ["R-0001"],
    groupKey: null,
    ...overrides,
  };
}

export function soaFixture(rows?: SoaRowDto[]): SoaResponse {
  const framework = { key: "iso27001-2022", name: "ISO/IEC 27001", versionLabel: "2022" };
  return {
    ...header,
    scope: { kind: "units", names: ["Riga"] },
    frameworks: [framework],
    framework,
    groups: [],
    canManage: true,
    rows: rows ?? [
      soaRow(),
      soaRow({
        requirementId: "0194f0c0-0000-7000-8000-000000000002",
        ref: "A.5.2",
        title: "-Information security roles",
        fullText: "LICENSED TEXT MUST NOT APPEAR",
        decision: null,
        hint: { kind: "unused" },
        controls: [],
        riskRefs: [],
      }),
    ],
  };
}

/** A NIST CSF SoA in two levels: Govern (two categories) and Identify (one). */
export function soaGroupedFixture(): SoaResponse {
  const framework = { key: "nist-csf-2.0", name: "NIST CSF", versionLabel: "2.0" };
  const undecided = {
    decision: null,
    hint: { kind: "unused" } as const,
    controls: [],
    riskRefs: [],
  };
  return {
    ...soaFixture(),
    frameworks: [framework],
    framework,
    groups: [
      { key: "GV", title: "Govern", parentKey: null, decided: 1, total: 3 },
      { key: "GV.OC", title: "Organisational context", parentKey: "GV", decided: 1, total: 2 },
      { key: "GV.RM", title: "Risk management strategy", parentKey: "GV", decided: 0, total: 1 },
      { key: "ID", title: "Identify", parentKey: null, decided: 0, total: 1 },
      { key: "ID.AM", title: "Asset management", parentKey: "ID", decided: 0, total: 1 },
    ],
    rows: [
      soaRow({ ref: "GV.OC-01", groupKey: "GV.OC" }),
      soaRow({ ref: "GV.OC-02", groupKey: "GV.OC", ...undecided }),
      soaRow({ ref: "GV.RM-01", groupKey: "GV.RM", ...undecided }),
      soaRow({ ref: "ID.AM-01", groupKey: "ID.AM", ...undecided }),
    ],
  };
}

/** An ISO 27001 SoA in one level: two Annex A themes. */
export function soaThemedFixture(): SoaResponse {
  return {
    ...soaFixture(),
    groups: [
      { key: "A.5", title: "Organisational controls", parentKey: null, decided: 1, total: 1 },
      { key: "A.8", title: "Technological controls", parentKey: null, decided: 0, total: 1 },
    ],
    rows: [
      soaRow({ groupKey: "A.5" }),
      soaRow({ ref: "A.8.1", groupKey: "A.8", decision: null, hint: { kind: "unused" } }),
    ],
  };
}

/** An ISO 27001 SoA with a requirement the content dropped, under "Other requirements". */
export function soaOtherFixture(): SoaResponse {
  const themed = soaThemedFixture();
  return {
    ...themed,
    groups: [
      ...themed.groups,
      { key: "_other", title: "Other requirements", parentKey: null, decided: 0, total: 1 },
    ],
    rows: [
      ...themed.rows,
      soaRow({ ref: "OLD-1", groupKey: "_other", decision: null, hint: { kind: "unused" } }),
    ],
  };
}

const week = (i: number) => ({
  weekStart: new Date(Date.UTC(2026, 7, 17 + i * 7)).toISOString().slice(0, 10),
  reported: i % 3,
  approved: i % 2,
  closed: i === 11 ? 1 : 0,
  openAtEnd: 9 + (i % 4),
});

const september = { key: "2026-09", start: "2026-09-01", end: "2026-09-30" };
const since = { kind: "since", date: "2026-10-01" } as const;
const vsSeptember = { kind: "previousPeriod", period: september } as const;

export function boardFixture(overrides: Partial<BoardPackResponse> = {}): BoardPackResponse {
  return {
    ...header,
    period: { key: "2026-10", start: "2026-10-01", end: "2026-10-31" },
    periods: [{ key: "2026-10", start: "2026-10-01", end: "2026-10-31" }],
    facts: {
      openRisks: 12,
      aboveAppetite: 3,
      reported: 4,
      approved: 2,
      closed: 1,
      overdueActions: 5,
      reviewsDue: 2,
    },
    tiles: [
      {
        key: "openRisks",
        value: 12,
        change: { delta: 2, direction: "up", tone: "neutral", basis: since },
      },
      {
        key: "aboveAppetite",
        value: 3,
        change: { delta: 1, direction: "down", tone: "better", basis: since },
      },
      {
        key: "reported",
        value: 4,
        change: { delta: 1, direction: "up", tone: "neutral", basis: vsSeptember },
      },
      {
        key: "approved",
        value: 2,
        change: { delta: 0, direction: "same", tone: "neutral", basis: vsSeptember },
      },
      {
        key: "closed",
        value: 1,
        change: { delta: 2, direction: "down", tone: "neutral", basis: vsSeptember },
      },
      { key: "overdueActions", value: 5, change: null },
      { key: "reviewsDue", value: 2, change: null },
    ],
    topRisks: [1, 2, 3, 4, 5].map((n) => ({
      reference: `R-000${String(n)}`,
      title: `Top risk ${String(n)} with a rather long title that wraps onto a second line`,
      owner: n === 5 ? null : "Oscar Owner",
      treatment: n === 4 ? null : "mitigate",
      score: 26 - n,
      residualScore: n === 3 ? null : 6,
      actions: { done: n, total: 6 },
    })),
    mapNow: {
      basis: "inherent",
      appetiteThreshold: 9,
      cells: [
        { likelihood: 5, impact: 5, count: 2 },
        { likelihood: 1, impact: 2, count: 7 },
      ],
      total: 10,
      unscored: 1,
      unplaced: 0,
    },
    mapExpected: {
      basis: "residual",
      appetiteThreshold: 9,
      cells: [{ likelihood: 2, impact: 3, count: 4 }],
      total: 10,
      unscored: 1,
      unplaced: 5,
    },
    movement: Array.from({ length: 12 }, (_, i) => week(i)),
    owners: [
      {
        ownerId: "0194f0c0-0000-7000-8000-0000000000a1",
        owner: "Oscar Owner",
        owned: 7,
        open: 6,
        closedNow: 1,
        treatedInPeriod: 1,
        overdueActions: 4,
      },
      {
        ownerId: null,
        owner: null,
        owned: 5,
        open: 5,
        closedNow: 0,
        treatedInPeriod: 0,
        overdueActions: 1,
      },
    ],
    narrative: {
      text: "Posture improved in October.\n\nThree risks remain above appetite.",
      approvedBy: "April Approver",
      approvedAt: "2026-11-02T10:00:00.000Z",
      aiAssisted: true,
    },
    canDraftNarrative: false,
    canApproveNarrative: false,
    ...overrides,
  };
}
