import type { BoardTileDto } from "@isms/contracts";
import { BOARD_TILES } from "@isms/domain";
import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { TILE_ICON, TOKEN_TEXT, dayMonth, shortMonth } from "./board-icons";

type Props = {
  tiles: BoardTileDto[];
  periodLabel: string;
  labelledBy?: string;
};

const TONE_TEXT = {
  neutral: "text-fg-muted",
  worse: "text-critical",
  better: "text-ok",
} as const;

/** The seven status tiles: icon, label, number and a plain change line, in display order. */
export function BoardTiles({ tiles, periodLabel, labelledBy }: Props) {
  const t = useTranslations("reports.board.tiles");
  const changeText = (tile: BoardTileDto): ReactNode => {
    const c = tile.change;
    if (c === null) return t("change.now");
    const when =
      c.basis.kind === "since"
        ? t("change.sincePeriod", { date: dayMonth(c.basis.date) })
        : t("change.vsPeriod", {
            period:
              c.basis.period.key === "prev-30-days"
                ? t("change.previous30")
                : shortMonth(c.basis.period.key),
          });
    if (c.direction === "same") return t("change.noChange", { when });
    const word =
      tile.key === "aboveAppetite"
        ? ` ${t(c.direction === "up" ? "change.more" : "change.fewer")}`
        : "";
    return (
      <>
        <span aria-hidden="true">{c.direction === "up" ? "▲" : "▼"}</span>
        {`${String(c.delta)}${word} ${when}`}
      </>
    );
  };

  return (
    <div className="flex flex-col gap-3">
      <ul aria-labelledby={labelledBy} className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {BOARD_TILES.flatMap((def) => {
          const tile = tiles.find((x) => x.key === def.key);
          if (!tile) return [];
          const Icon = TILE_ICON[def.icon];
          const tone = tile.key === "aboveAppetite" ? (tile.change?.tone ?? "neutral") : "neutral";
          return (
            <li
              key={def.key}
              className="flex flex-col gap-1 rounded-md border border-surface-border p-3"
            >
              <span className="flex items-center gap-2 text-sm text-fg-muted">
                <Icon aria-hidden className={`size-4 shrink-0 ${TOKEN_TEXT[def.token]}`} />
                {t(`label.${def.key}`)}
              </span>
              <span className="text-[28px] font-semibold leading-none tabular-nums text-fg">
                {tile.value}
              </span>
              <span className={`text-[13px] ${TONE_TEXT[tone]}`}>{changeText(tile)}</span>
            </li>
          );
        })}
      </ul>
      <p className="text-[13px] text-fg-muted">{t("smallPrint", { period: periodLabel })}</p>
    </div>
  );
}
