import { cn } from "@isms/ui";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { focusRingClass } from "../shell/styles";

export type RiskView = "list" | "map";
export type MapBasis = "inherent" | "residual";

const pill = (active: boolean) =>
  cn(
    "inline-flex h-9 items-center px-3.5 text-[13px] font-semibold whitespace-nowrap first:rounded-l-full last:rounded-r-full",
    active ? "bg-accent-soft text-accent" : "bg-surface text-fg hover:bg-accent-soft/40",
    focusRingClass,
  );

/** List / Map as links, and (on the map) the Now / Expected basis; the URL carries both. */
export function ViewSwitch({
  view,
  basis,
  includeClosed = false,
}: {
  view: RiskView;
  basis: MapBasis;
  /** On the map: treated risks are shown too (`includeClosed=true` in the URL). */
  includeClosed?: boolean;
}) {
  const t = useTranslations("insights.view");
  const closed = includeClosed ? "&includeClosed=true" : "";
  return (
    <div className="flex flex-wrap items-center gap-3">
      <nav aria-label={t("label")}>
        <ul className="flex overflow-hidden rounded-full border border-surface-border">
          <li>
            <Link
              href="/risks"
              aria-current={view === "list" ? "page" : undefined}
              className={pill(view === "list")}
            >
              {t("list")}
            </Link>
          </li>
          <li>
            <Link
              href={`/risks?view=map&basis=${basis}${closed}`}
              aria-current={view === "map" ? "page" : undefined}
              className={pill(view === "map")}
            >
              {t("map")}
            </Link>
          </li>
        </ul>
      </nav>
      {view === "map" ? (
        <nav aria-label={t("basisLabel")}>
          <ul className="flex overflow-hidden rounded-full border border-surface-border">
            {(["inherent", "residual"] as const).map((b) => (
              <li key={b}>
                <Link
                  href={`/risks?view=map&basis=${b}${closed}`}
                  aria-current={basis === b ? "true" : undefined}
                  className={pill(basis === b)}
                >
                  {b === "inherent" ? t("now") : t("expected")}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      ) : null}
      {view === "map" ? (
        // A state, then the action that changes it: "Treated risks: shown · Hide".
        <p className="inline-flex h-9 items-center gap-1.5 text-[13px] whitespace-nowrap text-fg-muted">
          <span>{t(includeClosed ? "treatedShown" : "treatedHidden")}</span>
          <span aria-hidden>·</span>
          <Link
            href={`/risks?view=map&basis=${basis}${includeClosed ? "" : "&includeClosed=true"}`}
            className={cn(
              "rounded-xs font-semibold text-accent underline underline-offset-2",
              focusRingClass,
            )}
          >
            {t(includeClosed ? "hideTreated" : "showTreated")}{" "}
            <span className="sr-only">{t("treatedRisks")}</span>
          </Link>
        </p>
      ) : null}
    </div>
  );
}
