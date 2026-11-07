import type { BoardPackResponse } from "@isms/contracts";
import { buttonVariants } from "@isms/ui";
import { useTranslations } from "next-intl";
import { BoardTiles } from "../reports/board-tiles";
import { periodName } from "../reports/period-name";
import { glass } from "./styles";

/** Executive view: where things stand for the default board period (named), in plain statements. */
export function AtAGlance({
  tiles,
  period,
}: {
  tiles: BoardPackResponse["tiles"];
  period: BoardPackResponse["period"];
}) {
  const t = useTranslations("reports.glance");
  const board = useTranslations("reports.board");
  return (
    <section aria-labelledby="home-glance" className={`${glass} flex flex-col gap-3 p-5`}>
      <div className="flex flex-col gap-1">
        <h2 id="home-glance" className="text-[17px] font-semibold text-fg">
          {t("title")}
        </h2>
        <p className="text-sm text-fg-muted">
          {t("intro", { period: periodName(period, board("last30Days")) })}
        </p>
      </div>
      <BoardTiles
        tiles={tiles}
        periodLabel={periodName(period, board("last30Days"))}
        labelledBy="home-glance"
      />
      <a href="/reports/board" className={`${buttonVariants({ variant: "secondary" })} w-fit`}>
        {t("link")}
      </a>
    </section>
  );
}
