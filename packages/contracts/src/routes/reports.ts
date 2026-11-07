import { z } from "zod";
import "../zod.js";
import { ErrorResponse } from "../errors.js";
import { defineRoute } from "../route.js";
import { text } from "../text.js";
import { RiskMapResponse } from "./risk-insights.js";
import { RiskStateSchema, TreatmentSchema } from "./risk-dtos.js";
import { RiskListFilterSchema } from "./risks.js";

const count = z.number().int().nonnegative();

/**
 * Whose risks a report covers: the whole organisation, or the names of the sites and
 * departments where the viewer holds `reports.read` (the cover's "Scope:" line, §5.1).
 */
export const ReportScopeDto = z
  .discriminatedUnion("kind", [
    z.object({ kind: z.literal("organisation") }),
    z.object({ kind: z.literal("units"), names: z.array(z.string()) }),
  ])
  .openapi("ReportScopeDto");
export type ReportScopeDto = z.infer<typeof ReportScopeDto>;

/** What every report carries on its cover. */
const reportHeader = {
  generatedAt: z.iso.datetime(),
  /** The display name of the person the report was generated for. */
  generatedBy: z.string(),
  organisation: z.string(),
  scope: ReportScopeDto,
};

export const RegisterQuery = z
  .object({
    filter: RiskListFilterSchema.default("all"),
    /** As on the risk list: closed risks are left out of the aboveAppetite and evidenceMissing filters unless "true". */
    includeClosed: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
  })
  .openapi("RegisterQuery");
export type RegisterQuery = z.infer<typeof RegisterQuery>;

/** One risk register line (§5.2). Expected values follow the map's residual basis (P5-R2). */
export const RegisterRowDto = z
  .object({
    reference: z.string(),
    title: z.string(),
    owner: z.string().nullable(),
    site: z.string().nullable(),
    department: z.string().nullable(),
    state: RiskStateSchema,
    likelihood: z.number().int().nullable(),
    impact: z.number().int().nullable(),
    score: z.number().int().nullable(),
    aboveAppetite: z.boolean().nullable(),
    treatment: TreatmentSchema.nullable(),
    residualLikelihood: z.number().int().nullable(),
    residualImpact: z.number().int().nullable(),
    residualScore: z.number().int().nullable(),
    /** Codes of the accepted controls. */
    controls: z.array(z.string()),
    openActions: count,
    overdueActions: count,
    nextReviewDue: z.iso.date().nullable(),
    approvedBy: z.string().nullable(),
    approvedOn: z.iso.date().nullable(),
    closedOn: z.iso.date().nullable(),
  })
  .openapi("RegisterRowDto");
export type RegisterRowDto = z.infer<typeof RegisterRowDto>;

export const RegisterResponse = z
  .object({
    ...reportHeader,
    appetiteThreshold: z.number().int(),
    filter: RiskListFilterSchema,
    includeClosed: z.boolean(),
    rows: z.array(RegisterRowDto),
  })
  .openapi("RegisterResponse");
export type RegisterResponse = z.infer<typeof RegisterResponse>;

export const ImplementationStatusSchema = z
  .enum(["implementedTested", "implementedNotTested", "implementedIneffective", "notImplemented"])
  .openapi("ImplementationStatus");

export const SoaFrameworkDto = z
  .object({ key: z.string(), name: z.string(), versionLabel: z.string() })
  .openapi("SoaFrameworkDto");
export type SoaFrameworkDto = z.infer<typeof SoaFrameworkDto>;

/** One requirement of the Statement of Applicability (§5.3, P7-R2). */
export const SoaRowDto = z
  .object({
    requirementId: z.string(),
    ref: z.string(),
    /** The paraphrased title shipped with the library. */
    title: z.string(),
    /** Only when the installation imported its own licensed text; on screen only, never in files. */
    fullText: z.string().nullable(),
    decision: z
      .object({
        applicable: z.boolean(),
        justification: z.string(),
        decidedBy: z.string(),
        decidedAt: z.iso.datetime(),
      })
      .nullable(),
    /**
     * A suggestion, never a decision (P7-R9): "used" when any risk anywhere has a mapped control
     * accepted, naming the visible risks and counting the others; "unused" when none has.
     */
    hint: z.discriminatedUnion("kind", [
      z.object({
        kind: z.literal("used"),
        refs: z.array(z.string()),
        hiddenCount: z.number().int().nonnegative(),
      }),
      z.object({ kind: z.literal("unused") }),
    ]),
    controls: z.array(
      z.object({ code: z.string(), title: z.string(), status: ImplementationStatusSchema }),
    ),
    /** References of the visible risks with a mapped control accepted. */
    riskRefs: z.array(z.string()),
    /** The leaf group the requirement sits in (a key of `SoaResponse.groups`); null when flat. */
    groupKey: z.string().nullable(),
  })
  .openapi("SoaRowDto");
export type SoaRowDto = z.infer<typeof SoaRowDto>;

/**
 * A heading of the SoA (#19): a NIST CSF Function or Category, an ISO Annex A theme. Counts
 * cover every requirement in the group and its subgroups; `decided` counts those with a
 * decision (the complement of the "Only undecided" filter).
 */
export const SoaGroupDto = z
  .object({
    key: z.string(),
    title: z.string(),
    /** The top-level group this one sits in; null for a top-level group. */
    parentKey: z.string().nullable(),
    decided: count,
    total: count,
  })
  .strict()
  .openapi("SoaGroupDto");
export type SoaGroupDto = z.infer<typeof SoaGroupDto>;

export const SoaQuery = z
  .object({
    /** A confirmed framework version key; the default is ISO 27001, else the first confirmed. */
    framework: z.string().max(100).optional(),
  })
  .openapi("SoaQuery");
export type SoaQuery = z.infer<typeof SoaQuery>;

export const SoaResponse = z
  .object({
    ...reportHeader,
    /** Confirmed framework versions only. */
    frameworks: z.array(SoaFrameworkDto),
    /** Null when no framework is confirmed; then `rows` is empty. */
    framework: SoaFrameworkDto.nullable(),
    /**
     * Display order: each top-level group, then its subgroups. Only groups with requirements;
     * empty for a flat framework (then every row's `groupKey` is null).
     */
    groups: z.array(SoaGroupDto),
    rows: z.array(SoaRowDto),
    canManage: z.boolean(),
  })
  .openapi("SoaResponse");
export type SoaResponse = z.infer<typeof SoaResponse>;

export const SetApplicabilityInput = z
  .object({ applicable: z.boolean(), justification: text(2000, "multiline") })
  .strict()
  .openapi("SetApplicabilityInput");
export type SetApplicabilityInput = z.infer<typeof SetApplicabilityInput>;

export const BoardPeriodDto = z
  .object({ key: z.string(), start: z.iso.date(), end: z.iso.date() })
  .openapi("BoardPeriodDto");
export type BoardPeriodDto = z.infer<typeof BoardPeriodDto>;

/** Headline facts (§5.4); `reported`, `approved` and `closed` count events within the period. */
export const BoardFactsDto = z
  .object({
    openRisks: count,
    aboveAppetite: count,
    reported: count,
    approved: count,
    closed: count,
    overdueActions: count,
    reviewsDue: count,
  })
  .openapi("BoardFactsDto");
export type BoardFactsDto = z.infer<typeof BoardFactsDto>;

export const BoardTopRiskDto = z
  .object({
    reference: z.string(),
    title: z.string(),
    owner: z.string().nullable(),
    treatment: TreatmentSchema.nullable(),
    score: z.number().int(),
    residualScore: z.number().int().nullable(),
    actions: z.object({ done: count, total: count }),
  })
  .openapi("BoardTopRiskDto");
export type BoardTopRiskDto = z.infer<typeof BoardTopRiskDto>;

export const BoardQuery = z.object({ period: z.string().max(20).optional() }).openapi("BoardQuery");
export type BoardQuery = z.infer<typeof BoardQuery>;

/** The approved narrative of a period: the newest approval wins. */
export const BoardNarrativeDto = z
  .object({
    text: z.string(),
    approvedBy: z.string(),
    approvedAt: z.iso.datetime(),
    aiAssisted: z.boolean(),
  })
  .openapi("BoardNarrativeDto");
export type BoardNarrativeDto = z.infer<typeof BoardNarrativeDto>;

export const BoardTileKeySchema = z.enum([
  "openRisks",
  "aboveAppetite",
  "reported",
  "approved",
  "closed",
  "overdueActions",
  "reviewsDue",
]);

/**
 * A tile's change (spec §4.2): period facts against the previous period of the same kind, open
 * risks and above appetite since the period start (from version history, today's appetite).
 */
export const BoardChangeDto = z
  .object({
    delta: count,
    direction: z.enum(["up", "down", "same"]),
    /** "neutral" except above appetite: more is "worse", fewer is "better". */
    tone: z.enum(["neutral", "worse", "better"]),
    basis: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("previousPeriod"), period: BoardPeriodDto }),
      z.object({ kind: z.literal("since"), date: z.iso.date() }),
    ]),
  })
  .openapi("BoardChangeDto");
export type BoardChangeDto = z.infer<typeof BoardChangeDto>;

/** One status tile; `change` is null for overdue actions and reviews due (no exact history). */
export const BoardTileDto = z
  .object({ key: BoardTileKeySchema, value: count, change: BoardChangeDto.nullable() })
  .openapi("BoardTileDto");
export type BoardTileDto = z.infer<typeof BoardTileDto>;

/** A week of the period's movement: events in the week, and open risks at its end. */
export const BoardMovementWeekDto = z
  .object({
    weekStart: z.iso.date(),
    reported: count,
    approved: count,
    closed: count,
    openAtEnd: count,
  })
  .openapi("BoardMovementWeekDto");
export type BoardMovementWeekDto = z.infer<typeof BoardMovementWeekDto>;

/**
 * One risk owner's visible risks (spec §4.4): owned (any state) = open + closedNow, now;
 * `treatedInPeriod` counts risks closed within the period. Not part of the AI narrative input.
 */
export const BoardOwnerRowDto = z
  .object({
    /** Null for the "Unassigned" row. */
    ownerId: z.uuid().nullable(),
    owner: z.string().nullable(),
    owned: count,
    open: count,
    closedNow: count,
    treatedInPeriod: count,
    overdueActions: count,
  })
  .openapi("BoardOwnerRowDto");
export type BoardOwnerRowDto = z.infer<typeof BoardOwnerRowDto>;

export const BoardPackResponse = z
  .object({
    ...reportHeader,
    period: BoardPeriodDto,
    periods: z.array(BoardPeriodDto),
    facts: BoardFactsDto,
    /** At most 5: open, above appetite, by inherent score descending, then reference. */
    topRisks: z.array(BoardTopRiskDto).max(5),
    mapNow: RiskMapResponse,
    mapExpected: RiskMapResponse,
    /** Seven, in the shared tile order (`BOARD_TILES`). */
    tiles: z.array(BoardTileDto).length(7),
    /** The 12 weeks ending with the period's end, oldest first. */
    movement: z.array(BoardMovementWeekDto).length(12),
    /** By open descending, then name; "Unassigned" (ownerId null) last on ties. */
    owners: z.array(BoardOwnerRowDto),
    /** Organisation-wide readers only (P7-R8); null for a scoped reader or before approval. */
    narrative: BoardNarrativeDto.nullable(),
    canDraftNarrative: z.boolean(),
    canApproveNarrative: z.boolean(),
  })
  .openapi("BoardPackResponse");
export type BoardPackResponse = z.infer<typeof BoardPackResponse>;

export const NarrativeDraftInput = z
  .object({ period: z.string().max(20) })
  .strict()
  .openapi("NarrativeDraftInput");
export type NarrativeDraftInput = z.infer<typeof NarrativeDraftInput>;

/** An AI draft, not stored: it becomes the narrative only when a person approves it. */
export const NarrativeDraftResponse = z
  .object({ text: z.string(), interactionId: z.string() })
  .openapi("NarrativeDraftResponse");
export type NarrativeDraftResponse = z.infer<typeof NarrativeDraftResponse>;

export const ApproveNarrativeInput = z
  .object({
    period: z.string().max(20),
    text: text(6000, "multiline"),
    /** The draft's interaction when the text started from an AI draft; null when typed. */
    interactionId: z.uuid().nullable(),
  })
  .strict()
  .openapi("ApproveNarrativeInput");
export type ApproveNarrativeInput = z.infer<typeof ApproveNarrativeInput>;

/** A generated report file (XLSX or PDF), always sent as an attachment. */
const reportFile = z.string().openapi({ type: "string", format: "binary" });

/** The reports (§5). Every figure follows the viewer's risk visibility. */
export const reportRoutes = {
  register: defineRoute({
    method: "get",
    path: "/api/v1/reports/register",
    summary: "The risk register: every visible risk the list filter matches, without paging",
    permission: "reports.read",
    request: { query: RegisterQuery },
    responses: { 200: RegisterResponse, 409: ErrorResponse },
  }),
  soa: defineRoute({
    method: "get",
    path: "/api/v1/reports/soa",
    summary: "The Statement of Applicability of a confirmed framework version",
    permission: "reports.read",
    request: { query: SoaQuery },
    responses: { 200: SoaResponse, 404: ErrorResponse },
  }),
  setApplicability: defineRoute({
    method: "put",
    path: "/api/v1/reports/soa/{requirementId}",
    summary: "Decide whether a requirement applies, with a justification",
    permission: "soa.manage",
    request: { params: z.object({ requirementId: z.uuid() }), body: SetApplicabilityInput },
    responses: { 200: SoaRowDto, 404: ErrorResponse },
  }),
  board: defineRoute({
    method: "get",
    path: "/api/v1/reports/board",
    summary: "The board pack for a period: facts, top risks, both maps, movement and narrative",
    permission: "reports.read",
    request: { query: BoardQuery },
    responses: { 200: BoardPackResponse },
  }),
  narrativeDraft: defineRoute({
    method: "post",
    path: "/api/v1/reports/board/narrative-draft",
    summary:
      "Ask the AI to draft the period's narrative from the organisation-wide facts; nothing is stored. 409 aiUnavailable.<reason>, or narrativeUnverifiable when the draft uses figures not in the facts",
    permission: "reports.narrative",
    request: { body: NarrativeDraftInput },
    responses: { 200: NarrativeDraftResponse, 400: ErrorResponse, 409: ErrorResponse },
  }),
  approveNarrative: defineRoute({
    method: "put",
    path: "/api/v1/reports/board/narrative",
    summary:
      "Approve the period's narrative (AI-drafted or typed); 400 at text when it uses figures not in the records (P7-R5); audited as report.narrative_approved",
    permission: "reports.narrative",
    request: { body: ApproveNarrativeInput },
    responses: { 200: BoardNarrativeDto, 400: ErrorResponse },
  }),
  registerXlsx: defineRoute({
    method: "get",
    path: "/api/v1/reports/register.xlsx",
    summary: "The risk register as an Excel file (with an About sheet); audited as report.exported",
    permission: "reports.read",
    download: true,
    request: { query: RegisterQuery },
    responses: { 200: reportFile, 409: ErrorResponse },
  }),
  registerPdf: defineRoute({
    method: "get",
    path: "/api/v1/reports/register.pdf",
    summary: "The risk register as a PDF (A4 landscape); audited as report.exported",
    permission: "reports.read",
    download: true,
    request: { query: RegisterQuery },
    responses: { 200: reportFile, 409: ErrorResponse },
  }),
  soaXlsx: defineRoute({
    method: "get",
    path: "/api/v1/reports/soa.xlsx",
    summary: "The Statement of Applicability as an Excel file; audited as report.exported",
    permission: "reports.read",
    download: true,
    request: { query: SoaQuery },
    responses: { 200: reportFile, 404: ErrorResponse },
  }),
  soaPdf: defineRoute({
    method: "get",
    path: "/api/v1/reports/soa.pdf",
    summary: "The Statement of Applicability as a PDF (A4 portrait); audited as report.exported",
    permission: "reports.read",
    download: true,
    request: { query: SoaQuery },
    responses: { 200: reportFile, 404: ErrorResponse },
  }),
  boardPdf: defineRoute({
    method: "get",
    path: "/api/v1/reports/board.pdf",
    summary: "The board pack for a period as a PDF (A4 portrait); audited as report.exported",
    permission: "reports.read",
    download: true,
    request: { query: BoardQuery },
    responses: { 200: reportFile },
  }),
};
