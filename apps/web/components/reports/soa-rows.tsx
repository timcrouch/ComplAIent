"use client";

import type { SoaRowDto } from "@isms/contracts";
import { Button, cn } from "@isms/ui";
import {
  CircleCheckIcon,
  CircleHelpIcon,
  CircleOffIcon,
  PencilIcon,
  TriangleAlertIcon,
  type LucideIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { formatDate } from "../../lib/dates";

type Status = SoaRowDto["controls"][number]["status"];

const STATUS_ICON: Record<Status, LucideIcon> = {
  implementedTested: CircleCheckIcon,
  implementedNotTested: CircleHelpIcon,
  implementedIneffective: TriangleAlertIcon,
  notImplemented: CircleOffIcon,
};
const STATUS_TONE: Record<Status, string> = {
  implementedTested: "text-ok",
  implementedNotTested: "text-fg-muted",
  implementedIneffective: "text-critical",
  notImplemented: "text-fg-muted",
};

/** The suggestion for one row, in plain text (P7-R9: never a decision). */
function Hint({ hint }: { hint: SoaRowDto["hint"] }) {
  const t = useTranslations("reports.soaPage.hint");
  if (hint.kind === "unused") return <>{t("unused")}</>;
  if (hint.refs.length === 0) return <>{t("onlyHidden", { count: hint.hiddenCount })}</>;
  const refs = hint.refs.join(", ");
  return hint.hiddenCount > 0 ? (
    <>{t("usedHidden", { refs, count: hint.hiddenCount })}</>
  ) : (
    <>{t("used", { refs })}</>
  );
}

/** One table of SoA requirements: the whole statement, or one group's part of it. */
export function SoaRows({
  rows,
  caption,
  canManage,
  timeZone,
  scroll,
  onEdit,
}: {
  rows: SoaRowDto[];
  caption: string;
  canManage: boolean;
  timeZone: string;
  /** A long flat statement scrolls inside its frame, under a sticky header. */
  scroll: boolean;
  onEdit: (row: SoaRowDto, trigger: HTMLElement) => void;
}) {
  const t = useTranslations("reports.soaPage");
  return (
    <div
      className={cn(
        "overflow-auto rounded-lg border border-surface-border bg-surface shadow-glass",
        scroll && "max-h-[75dvh]",
      )}
    >
      <table className="w-full min-w-[860px] border-collapse text-left text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="text-[12px] font-semibold tracking-wide text-fg-muted uppercase">
            {(["ref", "applicability", "justification", "controls", "risks"] as const).map((h) => (
              <th key={h} scope="col" className="sticky top-0 z-10 bg-bg px-3 py-2.5">
                {t(`table.${h}`)}
              </th>
            ))}
            {canManage ? (
              <th scope="col" className="sticky top-0 z-10 bg-bg px-3 py-2.5">
                <span className="sr-only">{t("table.actions")}</span>
              </th>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.requirementId} className="border-t border-surface-border align-top">
              <th scope="row" className="px-3 py-3 font-normal">
                <span className="font-semibold text-fg">{row.ref}</span>
                <span className="block max-w-[28ch] text-fg-muted">{row.title}</span>
                {row.fullText ? (
                  <details className="mt-1 max-w-[40ch] text-[13px] text-fg-muted">
                    <summary className="cursor-pointer font-medium text-fg">
                      {t("fullText")}
                    </summary>
                    <p className="mt-1 whitespace-pre-wrap">{row.fullText}</p>
                  </details>
                ) : null}
              </th>
              <td className="px-3 py-3">
                <span className="font-semibold text-fg">
                  {row.decision
                    ? t(row.decision.applicable ? "applicable" : "notApplicable")
                    : t("undecided")}
                </span>
              </td>
              <td className="max-w-[34ch] px-3 py-3 text-fg">
                {row.decision ? (
                  <>
                    <p className="whitespace-pre-wrap">{row.decision.justification}</p>
                    <p className="mt-1 text-xs text-fg-muted">
                      {t("decidedBy", {
                        name: row.decision.decidedBy,
                        date: formatDate(row.decision.decidedAt, timeZone),
                      })}
                    </p>
                  </>
                ) : null}
                <p className="mt-1 text-xs text-fg-muted">
                  <Hint hint={row.hint} />
                </p>
              </td>
              <td className="px-3 py-3">
                {row.controls.length === 0 ? (
                  <span className="text-fg-muted">{t("noControls")}</span>
                ) : (
                  <ul className="flex flex-col gap-1.5">
                    {row.controls.map((c) => {
                      const Icon = STATUS_ICON[c.status];
                      return (
                        <li key={c.code}>
                          <span className="font-medium text-fg">
                            {c.code} {c.title}
                          </span>
                          <span
                            className={cn("flex items-center gap-1 text-xs", STATUS_TONE[c.status])}
                          >
                            <Icon aria-hidden className="size-3.5 shrink-0" />
                            {t(`status.${c.status}`)}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </td>
              <td className="px-3 py-3 text-fg">
                {row.riskRefs.length === 0 ? (
                  <span className="text-fg-muted">{t("noRisks")}</span>
                ) : (
                  <ul className="flex flex-col gap-0.5">
                    {row.riskRefs.map((ref) => (
                      <li key={ref}>{ref}</li>
                    ))}
                  </ul>
                )}
              </td>
              {canManage ? (
                <td className="px-3 py-3">
                  <Button
                    type="button"
                    variant="secondary"
                    aria-label={t("editLabel", { ref: row.ref })}
                    onClick={(e) => {
                      onEdit(row, e.currentTarget);
                    }}
                  >
                    <PencilIcon aria-hidden className="size-4" />
                    {t("edit")}
                  </Button>
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
