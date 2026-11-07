import type { RiskMapResponse, RiskScaleDto } from "@isms/contracts";
import { isAboveAppetite, riskScore } from "@isms/domain";
import {
  ABOVE_APPETITE_CELL,
  ABOVE_APPETITE_EDGE,
  ABOVE_APPETITE_TEXT,
  AboveAppetiteIcon,
  cn,
} from "@isms/ui";
import { CircleCheckIcon } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { focusRingClass } from "../shell/styles";

type RiskMapProps = {
  map: RiskMapResponse;
  scale: RiskScaleDto;
  /** Hides axis titles, legend and table; every cell keeps its accessible name. */
  compact?: boolean;
  /** Where a cell with risks leads; without it the cells are plain text, not links. */
  cellHref?: (likelihood: number, impact: number) => string;
  /** Names the map's region when a page shows more than one (landmarks must be unique). */
  label?: string;
  /** The map counts closed risks too; the "no expected score" link then lists them too. */
  includeClosed?: boolean;
};

const cellBase =
  "flex flex-col-reverse items-center justify-center gap-0.5 rounded-sm px-1 py-2 text-center transition-colors duration-(--motion-base) ease-standard";

/**
 * `cellHref` is a function, so a server component must pass it (functions cannot cross into a
 * client component); a client component may create it itself, as the home picture does.
 *
 * Risks per likelihood × impact as a real table: most likely on top, lowest impact first.
 * A cell with risks is a link into the filtered list (plain text without `cellHref`); it says in words and with an icon
 * whether it is above appetite, colour only repeats that. Works on server and client.
 */
export function RiskMap({
  map,
  scale,
  compact = false,
  cellHref,
  label,
  includeClosed = false,
}: RiskMapProps) {
  const t = useTranslations("insights.map");
  const likelihoods = [...scale.likelihood].sort((a, b) => b.value - a.value);
  const impacts = [...scale.impact].sort((a, b) => a.value - b.value);
  const counts = new Map(
    map.cells.map((c) => [`${String(c.likelihood)}:${String(c.impact)}`, c.count]),
  );
  const likelihoodLabel = (v: number) =>
    scale.likelihood.find((l) => l.value === v)?.label ?? String(v);
  const impactLabel = (v: number) => scale.impact.find((l) => l.value === v)?.label ?? String(v);
  const above = (l: number, i: number) => isAboveAppetite(riskScore(l, i), map.appetiteThreshold);
  const tableRows = [...map.cells].sort(
    (a, b) => riskScore(b.likelihood, b.impact) - riskScore(a.likelihood, a.impact),
  );

  const noExpectedHref = `/risks?filter=noExpectedScore${includeClosed ? "&includeClosed=true" : ""}`;
  // Expected map with nothing placed: say so, and lead to the risks that lack a score.
  const emptyExpected = map.basis === "residual" && map.cells.length === 0 && map.unplaced > 0;
  const unplacedNote =
    map.unplaced > 0 && !emptyExpected ? (
      <p className="text-[13px] text-fg-muted">
        <Link href={noExpectedHref} className={cn("rounded-sm underline", focusRingClass)}>
          {t("unplaced", { count: map.unplaced })}
        </Link>
      </p>
    ) : null;

  return (
    <div className="flex flex-col gap-3">
      {unplacedNote}
      <div className="relative">
        <div
          role="region"
          aria-label={label ?? t("label")}
          tabIndex={0}
          className="-mx-1 overflow-x-auto rounded-md px-1 pb-1 outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
        >
          <table
            className={cn(
              "w-full table-fixed border-separate border-spacing-1 text-fg",
              compact ? "min-w-[300px]" : "min-w-[420px]",
            )}
          >
            <caption className="sr-only">{t("caption")}</caption>
            {/* Fixed row-header column; the five impact columns share the rest equally. */}
            <colgroup>
              <col className={compact ? "w-[76px]" : "w-[84px] sm:w-[112px]"} />
              {impacts.map((i) => (
                <col key={i.value} />
              ))}
            </colgroup>
            <thead>
              {compact ? null : (
                <tr>
                  <td />
                  <th
                    scope="colgroup"
                    colSpan={impacts.length}
                    className="pb-1 text-left text-xs font-bold tracking-[0.08em] text-fg-muted uppercase"
                  >
                    {t("impact")}
                  </th>
                </tr>
              )}
              <tr>
                <th
                  scope="col"
                  className={cn(
                    "pb-1 text-left text-xs font-bold text-fg-muted",
                    compact ? "text-[11px]" : "tracking-[0.08em] uppercase",
                  )}
                >
                  {compact ? <span aria-hidden>{t("axisLikelihood")}</span> : t("likelihood")}
                  {compact ? <span className="sr-only">{t("likelihood")}</span> : null}
                </th>
                {impacts.map((i) => (
                  <th
                    key={i.value}
                    scope="col"
                    className={cn("pb-1 text-xs leading-tight font-semibold", compact && "sr-only")}
                  >
                    {i.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {likelihoods.map((l) => (
                <tr key={l.value}>
                  <th
                    scope="row"
                    className={cn(
                      "pr-2 text-left text-xs leading-tight font-semibold",
                      compact && "sr-only",
                    )}
                  >
                    {l.label}
                  </th>
                  {impacts.map((i) => {
                    const count = counts.get(`${String(l.value)}:${String(i.value)}`);
                    const isAbove = above(l.value, i.value);
                    // Draw the line where appetite ends: on the side that meets a within cell.
                    const edgeLeft = isAbove && i.value > 1 && !above(l.value, i.value - 1);
                    const edgeBelow = isAbove && l.value > 1 && !above(l.value - 1, i.value);
                    const tone = cn(
                      cellBase,
                      "min-h-[52px] border-2 border-transparent",
                      isAbove ? ABOVE_APPETITE_CELL : "bg-surface text-fg",
                      edgeLeft && ABOVE_APPETITE_EDGE.left,
                      edgeBelow && ABOVE_APPETITE_EDGE.below,
                    );
                    if (!count) {
                      return (
                        <td key={i.value} className="p-0">
                          <div
                            aria-hidden
                            data-above={isAbove || undefined}
                            data-edge-left={edgeLeft || undefined}
                            data-edge-below={edgeBelow || undefined}
                            className={tone}
                          />
                        </td>
                      );
                    }
                    const Icon = isAbove ? AboveAppetiteIcon : CircleCheckIcon;
                    const name = t("cellLabel", {
                      count,
                      likelihood: l.label,
                      impact: i.label,
                      above: String(isAbove),
                    });
                    const data = {
                      "data-above": isAbove || undefined,
                      "data-edge-left": edgeLeft || undefined,
                      "data-edge-below": edgeBelow || undefined,
                    };
                    const visible = (
                      <>
                        {compact ? null : (
                          <>
                            <span className="text-[11px] leading-tight font-semibold">
                              {isAbove ? t("above") : t("within")}
                            </span>
                            {/* The space keeps the visible text "Above appetite 3", which the name starts with. */}{" "}
                          </>
                        )}
                        <Icon aria-hidden className="size-3.5" strokeWidth={2.5} />
                        <span className="text-base leading-none font-bold tabular-nums">
                          {count}
                        </span>
                      </>
                    );
                    if (!cellHref) {
                      return (
                        <td key={i.value} className="p-0">
                          <div {...data} className={tone}>
                            <span className="sr-only">{name}</span>
                            <span aria-hidden className="contents">
                              {visible}
                            </span>
                          </div>
                        </td>
                      );
                    }
                    return (
                      <td key={i.value} className="p-0">
                        <Link
                          href={cellHref(l.value, i.value)}
                          {...data}
                          aria-label={name}
                          className={cn(tone, "hover:brightness-95", focusRingClass)}
                        >
                          {visible}
                        </Link>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {emptyExpected ? (
          <div role="note" className="absolute inset-0 flex items-center justify-center p-3">
            <div className="flex max-w-[28rem] flex-col items-center gap-2 rounded-md border border-surface-border bg-surface p-3 text-center text-[13px] shadow-sm">
              <p className="text-fg">{t("noExpectedYet")}</p>
              <Link
                href={noExpectedHref}
                className={cn("rounded-sm font-semibold underline", focusRingClass)}
              >
                {t("noExpectedLink", { count: map.unplaced })}
              </Link>
            </div>
          </div>
        ) : null}
      </div>
      {compact ? (
        <p
          aria-hidden
          className="-mt-2 pl-[76px] text-center text-[11px] font-semibold text-fg-muted"
        >
          {t("axisImpact")}
        </p>
      ) : null}

      {map.total === 0 ? <p className="text-[14px] text-fg-muted">{t("empty")}</p> : null}
      {map.unscored > 0 ? (
        <p className="text-[13px] text-fg-muted">{t("unscored", { count: map.unscored })}</p>
      ) : null}

      {compact ? null : (
        <>
          <section aria-label={t("legendTitle")} className="flex flex-col gap-1 text-[13px]">
            <h2 className="text-xs font-bold tracking-[0.08em] text-fg-muted uppercase">
              {t("legendTitle")}
            </h2>
            <p className="text-fg-muted">{t("legendRegion")}</p>
            <p className={cn("inline-flex items-center gap-1.5", ABOVE_APPETITE_TEXT)}>
              <AboveAppetiteIcon aria-hidden className="size-3.5" strokeWidth={2.5} />
              {t("legendAbove", { threshold: map.appetiteThreshold })}
            </p>
            <p className="inline-flex items-center gap-1.5 text-fg">
              <CircleCheckIcon aria-hidden className="size-3.5" strokeWidth={2.5} />
              {t("legendWithin")}
            </p>
          </section>
          {tableRows.length > 0 ? (
            <details className="text-[13px]">
              <summary
                className={cn("w-fit cursor-pointer rounded-sm font-semibold", focusRingClass)}
              >
                {t("showTable")}
              </summary>
              <div className="overflow-x-auto pt-2">
                <table className="w-full text-left">
                  <caption className="sr-only">{t("tableCaption")}</caption>
                  <thead>
                    <tr>
                      <th scope="col">{t("colLikelihood")}</th>
                      <th scope="col">{t("colImpact")}</th>
                      <th scope="col">{t("colScore")}</th>
                      <th scope="col">{t("colAppetite")}</th>
                      <th scope="col">{t("colCount")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tableRows.map((c) => (
                      <tr key={`${String(c.likelihood)}:${String(c.impact)}`}>
                        <td>{likelihoodLabel(c.likelihood)}</td>
                        <td>{impactLabel(c.impact)}</td>
                        <td className="tabular-nums">{riskScore(c.likelihood, c.impact)}</td>
                        <td>{above(c.likelihood, c.impact) ? t("above") : t("within")}</td>
                        <td className="tabular-nums">{c.count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          ) : null}
        </>
      )}
    </div>
  );
}
