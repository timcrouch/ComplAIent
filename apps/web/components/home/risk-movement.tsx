import type { RiskPictureDto } from "@isms/contracts";
import { useTranslations } from "next-intl";
import { formatDate } from "../../lib/dates";

type RiskMovementProps = { movement: RiskPictureDto["movement"] };

const BAR_AREA = "h-24";

/**
 * Risks reported, approved and marked as treated (closed) in each of the last 12 weeks. Bar heights are relative to the
 * largest weekly value (all zero stays flat). The bars are decorative (hover titles only);
 * the legend stays visible and the same data is a table, the accessible form.
 */
export function RiskMovement({ movement }: RiskMovementProps) {
  const t = useTranslations("insights.picture");
  const max = Math.max(0, ...movement.flatMap((w) => [w.reported, w.approved, w.closed]));
  const pct = (n: number) => (max === 0 ? 0 : Math.round((n / max) * 100));
  // weekStart is a calendar date: format it in UTC so no time zone shifts the day.
  const week = (weekStart: string) => formatDate(`${weekStart}T00:00:00.000Z`, "UTC");

  return (
    <div className="flex flex-col gap-3">
      <h3 className="px-1 text-sm font-semibold text-fg">{t("movementTitle")}</h3>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-fg-muted">
        <li className="inline-flex items-center gap-1.5">
          <span aria-hidden className="size-3 rounded-sm bg-accent" />
          {t("legendReported")}
        </li>
        <li className="inline-flex items-center gap-1.5">
          <span aria-hidden className="size-3 rounded-sm bg-ok" />
          {t("legendApproved")}
        </li>
        <li className="inline-flex items-center gap-1.5">
          <span aria-hidden className="size-3 rounded-sm bg-fg-muted" />
          {t("legendClosed")}
        </li>
        <li>{t("legendNote")}</li>
      </ul>
      <div
        aria-hidden
        className={`flex items-end gap-1 border-b border-surface-border ${BAR_AREA}`}
      >
        {movement.map((w) => (
          <div
            key={w.weekStart}
            data-testid="movement-week"
            className="flex h-full min-w-0 flex-1 items-end justify-center gap-0.5"
          >
            <div
              data-testid="movement-bar"
              title={t("barReported", { count: w.reported, week: week(w.weekStart) })}
              style={{ height: `${String(pct(w.reported))}%` }}
              className="w-full max-w-3 rounded-t-sm bg-accent"
            />
            <div
              data-testid="movement-bar"
              title={t("barApproved", { count: w.approved, week: week(w.weekStart) })}
              style={{ height: `${String(pct(w.approved))}%` }}
              className="w-full max-w-3 rounded-t-sm bg-ok"
            />
            <div
              data-testid="movement-bar"
              title={t("barClosed", { count: w.closed, week: week(w.weekStart) })}
              style={{ height: `${String(pct(w.closed))}%` }}
              className="w-full max-w-3 rounded-t-sm bg-fg-muted"
            />
          </div>
        ))}
      </div>
      <details className="text-sm">
        <summary className="cursor-pointer font-semibold text-accent">{t("showTable")}</summary>
        <table className="mt-2 w-full text-left text-fg">
          <caption className="sr-only">{t("tableCaption")}</caption>
          <thead>
            <tr className="text-xs text-fg-muted">
              <th scope="col" className="py-1 font-semibold">
                {t("colWeek")}
              </th>
              <th scope="col" className="py-1 font-semibold">
                {t("colReported")}
              </th>
              <th scope="col" className="py-1 font-semibold">
                {t("colApproved")}
              </th>
              <th scope="col" className="py-1 font-semibold">
                {t("colClosed")}
              </th>
            </tr>
          </thead>
          <tbody>
            {movement.map((w) => (
              <tr key={w.weekStart}>
                <th scope="row" className="py-1 font-normal">
                  {week(w.weekStart)}
                </th>
                <td className="tabular-nums">{w.reported}</td>
                <td className="tabular-nums">{w.approved}</td>
                <td className="tabular-nums">{w.closed}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
