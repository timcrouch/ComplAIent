import { ControlListQuery } from "@isms/contracts";
import type { Metadata } from "next";
import { createTranslator } from "next-intl";
import messages from "../messages/index";

type SearchParams = Record<string, string | string[] | undefined>;
const KEYS = ["q", "framework", "review", "category", "inUse"] as const;

/**
 * The library search from the URL. Empty values mean "any"; a value the contract refuses (an
 * unknown category, say) is dropped on its own, so the rest of the search still applies.
 */
export function libraryQuery(params: SearchParams): ControlListQuery {
  const raw: Record<string, string> = {};
  for (const key of KEYS) {
    const value = params[key];
    const first = Array.isArray(value) ? value[0] : value;
    if (first?.trim()) raw[key] = first;
  }
  const parsed = ControlListQuery.safeParse(raw);
  if (parsed.success) return parsed.data;
  const refused = new Set(parsed.error.issues.map((i) => String(i.path[0])));
  return ControlListQuery.parse(
    Object.fromEntries(Object.entries(raw).filter(([key]) => !refused.has(key))),
  );
}

const t = createTranslator({ locale: "en", messages });

/** "Controls · ComplAIent ISMS", or "RES-01 Back-ups you can restore · Controls · ComplAIent ISMS" for a control. */
export function libraryMetadata(control?: { code: string; title: string }): Metadata {
  return {
    title: control
      ? t("library.controlPageTitle", { ...control, app: t("app.name") })
      : t("library.pageTitle", { title: t("library.title"), app: t("app.name") }),
  };
}
