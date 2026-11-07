import type { BoardOwnerRowDto } from "@isms/contracts";
import { useTranslations } from "next-intl";

const BAR_WIDTH = 120;

/** Open (accent) then treated-now (ok), scaled to the largest owner. Numbers are in the cells. */
function OwnerBar({ row, maxOwned }: { row: BoardOwnerRowDto; maxOwned: number }) {
  const scale = maxOwned > 0 ? BAR_WIDTH / maxOwned : 0;
  const open = row.open * scale;
  const done = row.closedNow * scale;
  return (
    <svg aria-hidden width={BAR_WIDTH} height={10} viewBox={`0 0 ${String(BAR_WIDTH)} 10`}>
      {open > 0 ? <rect x={0} y={1} width={open} height={8} className="fill-accent" /> : null}
      {done > 0 ? <rect x={open} y={1} width={done} height={8} className="fill-ok" /> : null}
    </svg>
  );
}

/** "By risk owner": every owner, as given (open risks first), with a bar and the plain numbers. */
export function BoardOwners({ owners }: { owners: BoardOwnerRowDto[] }) {
  const t = useTranslations("reports.board.owners");
  if (owners.length === 0) return <p className="text-sm text-fg-muted">{t("empty")}</p>;
  const maxOwned = Math.max(0, ...owners.map((r) => r.owned));
  const th = "px-2 py-2 text-left text-[13px] font-semibold text-fg-muted";
  const num = "px-2 py-2 text-right tabular-nums";
  return (
    <div className="flex flex-col gap-2">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm text-fg">
          <caption className="sr-only">{t("caption")}</caption>
          <thead>
            <tr className="border-b border-surface-border">
              <th scope="col" className={th}>
                {t("owner")}
              </th>
              <th scope="col" className={`${th} text-right`}>
                {t("owned")}
              </th>
              <th scope="col" className={`${th} text-right`}>
                {t("open")}
              </th>
              <th scope="col" className={`${th} text-right`}>
                {t("treated")}
              </th>
              <th scope="col" className={`${th} text-right`}>
                {t("overdue")}
              </th>
              <th scope="col" className={th}>
                {t("bar")}
              </th>
            </tr>
          </thead>
          <tbody>
            {owners.map((row, i) => {
              const name = row.owner ?? t("unassigned");
              return (
                <tr
                  key={row.ownerId ?? `none-${String(i)}`}
                  className="border-b border-surface-border/60"
                >
                  <th scope="row" className="max-w-[16rem] px-2 py-2 text-left font-normal">
                    <span title={name} className="block truncate">
                      {name}
                    </span>
                  </th>
                  <td className={num}>{row.owned}</td>
                  <td className={num}>{row.open}</td>
                  <td className={num}>{row.treatedInPeriod}</td>
                  <td
                    data-testid="overdue"
                    className={`${num} ${row.overdueActions > 0 ? "font-semibold text-critical" : ""}`}
                  >
                    {row.overdueActions}
                  </td>
                  <td className="px-2 py-2">
                    <OwnerBar row={row} maxOwned={maxOwned} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-[13px] text-fg-muted">{t("footnote")}</p>
    </div>
  );
}
