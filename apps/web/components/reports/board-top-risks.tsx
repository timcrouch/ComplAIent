import type { BoardTopRiskDto } from "@isms/contracts";
import { useTranslations } from "next-intl";

/** The top risks (open, above appetite): score, owner, treatment and action progress. */
export function BoardTopRisks({
  risks,
  labelledBy,
}: {
  risks: BoardTopRiskDto[];
  labelledBy: string;
}) {
  const t = useTranslations("reports.board.topRisks");
  if (risks.length === 0) return <p className="text-sm text-fg-muted">{t("empty")}</p>;
  return (
    <ol aria-labelledby={labelledBy} className="flex flex-col gap-3">
      {risks.map((risk) => (
        <li key={risk.reference} className="flex flex-col gap-0.5">
          <p className="text-[15px] font-semibold text-fg">
            <span className="tabular-nums">{risk.reference}</span> {risk.title}
          </p>
          <p className="text-[13px] text-fg-muted">
            {risk.residualScore === null
              ? t("scoreOnly", { score: risk.score })
              : t("scores", { score: risk.score, residual: risk.residualScore })}
            {" · "}
            {risk.owner ? t("owner", { name: risk.owner }) : t("noOwner")}
            {" · "}
            {risk.treatment ? t(`treatment.${risk.treatment}`) : t("noTreatment")}
          </p>
          <p className="text-[13px] text-fg-muted">
            {risk.actions.total === 0
              ? t("noActions")
              : t("actions", { done: risk.actions.done, total: risk.actions.total })}
          </p>
        </li>
      ))}
    </ol>
  );
}
