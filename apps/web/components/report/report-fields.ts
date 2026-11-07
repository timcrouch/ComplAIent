import {
  ReportRiskInput,
  type AssetType,
  type ConcernDraftDto,
  type ReportRiskInput as ReportInput,
} from "@isms/contracts";
import type messages from "../../messages/index";

export type ReportErrorKey = keyof (typeof messages)["report"]["errors"];

/** What the reporter is editing; an empty `siteId` means "not sure". */
export type ReportValues = {
  title: string;
  scenario: string;
  threat: string;
  consequence: string;
  existingSafeguards: string;
  assets: { name: string; type: AssetType }[];
  siteId: string;
  departmentId: string | null;
  toConfirm: string[];
};

/** Field errors by input path ("title", "assets.0.name", "toConfirm.2"). */
export type FieldErrors = Partial<Record<string, ReportErrorKey>>;

export type SiteOption = { id: string; name: string };

export const ASSET_TYPES = [
  "information",
  "application",
  "device",
  "service",
  "facility",
  "other",
] as const satisfies readonly AssetType[];

export const emptyValues = (): ReportValues => ({
  title: "",
  scenario: "",
  threat: "",
  consequence: "",
  existingSafeguards: "",
  assets: [],
  siteId: "",
  departmentId: null,
  toConfirm: [],
});

/** The AI's draft as editable values; the estimate is not among them (it is never sent). */
export function valuesFromDraft(draft: ConcernDraftDto): ReportValues {
  return {
    title: draft.title,
    scenario: draft.scenario,
    threat: draft.threat,
    consequence: draft.consequence,
    existingSafeguards: draft.existingSafeguards,
    assets: draft.assets.map((a) => ({ ...a })),
    siteId: draft.siteId ?? "",
    departmentId: draft.departmentId,
    toConfirm: [...draft.toConfirm],
  };
}

/** The longest title the form prefills from the reporter's first words. */
const PREFILL_TITLE = 80;

/** After a failed turn: the first message is the title, all the reporter's messages the story. */
export function valuesFromMessages(texts: readonly string[]): ReportValues {
  const first = (texts[0] ?? "").replace(/\s+/g, " ").trim();
  return {
    ...emptyValues(),
    title: first.slice(0, PREFILL_TITLE).trim(),
    scenario: texts.join("\n"),
  };
}

const toInput = (v: ReportValues): unknown => ({
  title: v.title,
  scenario: v.scenario,
  threat: v.threat,
  consequence: v.consequence,
  existingSafeguards: v.existingSafeguards,
  assets: v.assets,
  siteId: v.siteId === "" ? null : v.siteId,
  departmentId: v.departmentId,
  toConfirm: v.toConfirm,
});

const REQUIRED: Record<string, ReportErrorKey> = {
  title: "titleRequired",
  scenario: "scenarioRequired",
  threat: "threatRequired",
  consequence: "consequenceRequired",
  assets: "assetRequired",
  toConfirm: "toConfirmRequired",
};

/** The message for a refused field: too long, or (for anything else) missing or not usable. */
export function errorFor(path: string, code: string): ReportErrorKey {
  if (code === "too_big") return "tooLong";
  return REQUIRED[path.split(".")[0] ?? ""] ?? "notAccepted";
}

/** Field errors from refused paths, as the contract or the API reports them. */
export function fieldErrors(issues: readonly { path: string; code: string }[]): FieldErrors {
  const errors: FieldErrors = {};
  for (const { path, code } of issues) errors[path] ??= errorFor(path, code);
  return errors;
}

/** Checks the values against the contract; the parsed input, or the errors by field. */
export function checkValues(
  values: ReportValues,
): { ok: true; input: ReportInput } | { ok: false; errors: FieldErrors } {
  const parsed = ReportRiskInput.safeParse(toInput(values));
  if (parsed.success) return { ok: true, input: parsed.data };
  return {
    ok: false,
    errors: fieldErrors(
      parsed.error.issues.map((i) => ({
        path: i.path.map(String).join("."),
        code: i.code,
      })),
    ),
  };
}

/** Moves focus to the first invalid control inside `root`. */
export function focusFirstInvalid(root: HTMLElement | null): void {
  requestAnimationFrame(() => {
    root?.querySelector<HTMLElement>("[aria-invalid=true]")?.focus();
  });
}
