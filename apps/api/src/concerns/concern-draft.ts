import type { ConcernAssetType, ConcernDraftOutput } from "@isms/ai";
import { type AssetType, AssetTypeSchema, type ConcernDraftDto } from "@isms/contracts";
import { z } from "zod";

type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
/** The AI's asset types are the register's: a compile error here means they drifted apart. */
export const SAME_ASSET_TYPES: Same<ConcernAssetType, AssetType> = true;

/** Added when the summary names no site, or one that does not exist. */
export const SITE_MISSING = "Which site is affected?";
/** ReportRiskInput allows at most 10 items to confirm. */
const MAX_TO_CONFIRM = 10;

// As in the contracts' text fields: control characters other than tab and line breaks, and
// invisible format characters, which the form's fields refuse.
const CONTROL = "\\x00-\\x08\\x0b\\x0c\\x0e-\\x1f\\x7f-\\x9f";
const INVISIBLE = "\\u00ad\\u061c\\u180e\\u200b\\u200e\\u200f\\u202a-\\u202e\\u2060-\\u206f\\ufeff";
const STRAY = new RegExp(`[${CONTROL}${INVISIBLE}]`, "g");

/** One line of plain text, as the form's single-line fields accept it. */
const oneLine = (s: string): string => s.replace(STRAY, "").replace(/\s+/g, " ").trim();
/** Text that may span lines. */
const multiline = (s: string): string => s.replace(STRAY, "").trim();

/** Adds items not already listed (exact text), keeping the order and the form's limit. */
export function addToConfirm(list: readonly string[], ...items: string[]): string[] {
  const out = [...list];
  for (const item of items) {
    const clean = oneLine(item).slice(0, 300);
    if (clean.length > 0 && !out.includes(clean) && out.length < MAX_TO_CONFIRM) out.push(clean);
  }
  return out;
}

export type SiteRef = { id: string; nameKey: string };

/**
 * The stored draft: the AI's summary made ready for the form. The site name is resolved to an
 * id ignoring case; the server's own items to confirm (from "not sure") come first. The estimate
 * stays here, server-side, for submit to use (P3-R5).
 */
export function draftFromSummary(
  out: ConcernDraftOutput,
  sites: readonly SiteRef[],
  serverToConfirm: readonly string[],
): ConcernDraftDto {
  const key = out.siteName === null ? null : out.siteName.trim().toLowerCase();
  const site = key === null ? undefined : sites.find((s) => s.nameKey === key);
  let toConfirm = addToConfirm(serverToConfirm, ...out.toConfirm);
  if (!site) toConfirm = addToConfirm(toConfirm, SITE_MISSING);
  const { likelihood, impact } = out;
  const reasoning =
    likelihood && impact
      ? likelihood.reasoning === impact.reasoning
        ? likelihood.reasoning
        : `${likelihood.reasoning}\n${impact.reasoning}`
      : "";
  return {
    title: oneLine(out.title),
    scenario: multiline(out.scenario),
    threat: multiline(out.threat),
    consequence: multiline(out.consequence),
    existingSafeguards: multiline(out.existingSafeguards),
    assets: out.assets
      .map((a) => ({ name: oneLine(a.name), type: a.type }))
      .filter((a) => a.name.length > 0),
    siteId: site?.id ?? null,
    departmentId: null,
    toConfirm,
    aiEstimate:
      likelihood && impact
        ? { likelihood: likelihood.value, impact: impact.value, reasoning: reasoning.trim() }
        : null,
  };
}

/** `ConcernConversation.draft`: the draft and the summary turn's interaction (for its outcome). */
const StoredDraft = z.object({
  draft: z.object({
    title: z.string(),
    scenario: z.string(),
    threat: z.string(),
    consequence: z.string(),
    existingSafeguards: z.string(),
    assets: z.array(z.object({ name: z.string(), type: AssetTypeSchema })),
    siteId: z.string().nullable(),
    departmentId: z.string().nullable(),
    toConfirm: z.array(z.string()),
    aiEstimate: z
      .object({ likelihood: z.number().int(), impact: z.number().int(), reasoning: z.string() })
      .nullable(),
  }),
  interactionId: z.string(),
});
export type StoredDraft = z.infer<typeof StoredDraft>;

/** The stored draft, or null when there is none (or it is unreadable). */
export function readStoredDraft(json: unknown): StoredDraft | null {
  if (json === null || json === undefined) return null;
  const parsed = StoredDraft.safeParse(json);
  return parsed.success ? parsed.data : null;
}
