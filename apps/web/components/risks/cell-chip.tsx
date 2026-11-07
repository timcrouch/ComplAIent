import type { RiskListFilter, RiskScaleDto } from "@isms/contracts";
import Link from "next/link";
import { useTranslations } from "next-intl";
import type { RiskListCell } from "../../lib/actions/risks";

/** Which map cell narrows the list, in level names (numbers if the scale is unknown). */
export function CellChip({
  cell,
  scale,
  filter,
}: {
  cell: RiskListCell;
  scale: RiskScaleDto | null;
  filter: RiskListFilter;
}) {
  const t = useTranslations("insights.map");
  const name = (levels: RiskScaleDto["likelihood"] | undefined, value: number) =>
    levels?.find((x) => x.value === value)?.label ?? String(value);
  return (
    <p className="flex flex-wrap items-center gap-2 text-[13px]">
      <span className="rounded-full border border-surface-border bg-accent-soft px-3 py-1 font-semibold text-accent">
        {t("cellChip", {
          basis: cell.basis,
          likelihood: name(scale?.likelihood, cell.likelihood),
          impact: name(scale?.impact, cell.impact),
        })}
      </span>
      <Link
        href={`/risks?filter=${filter}`}
        className="font-semibold text-accent underline underline-offset-4"
      >
        {t("clearCell")}
      </Link>
    </p>
  );
}
