import type { BoardPackResponse, RiskScaleDto } from "@isms/contracts";
import { DownloadIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { formatDate } from "../../lib/dates";
import { RiskMap } from "../risks/risk-map";
import { glass } from "../setup/styles";
import { BoardMovementChart } from "./board-movement-chart";
import { BoardNarrative } from "./board-narrative";
import { BoardOwners } from "./board-owners";
import { BoardTiles } from "./board-tiles";
import { BoardTopRisks } from "./board-top-risks";
import { endedYesterday, periodName } from "./period-name";
import { downloadLinkClass } from "./styles";

type Props = { pack: BoardPackResponse; scale: RiskScaleDto; timeZone: string };

function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section aria-labelledby={id} className={`${glass} flex flex-col gap-4 p-5`}>
      <h2 id={id} className="text-[17px] font-semibold text-fg">
        {title}
      </h2>
      {children}
    </section>
  );
}

/** The board pack for one period: picker, headline tiles, both maps, movement, owners, top risks and narrative. */
export function BoardPack({ pack, scale, timeZone }: Props) {
  const t = useTranslations("reports.board");
  const mapLabel = useTranslations("insights.map")("label");
  const period = pack.period;
  const query = `?period=${encodeURIComponent(period.key)}`;
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <nav aria-label={t("periodLabel")} className="flex flex-col gap-2">
          <ul className="flex flex-wrap gap-2">
            {pack.periods.map((p) => (
              <li key={p.key}>
                <a
                  href={`/reports/board?period=${encodeURIComponent(p.key)}`}
                  aria-current={p.key === period.key ? "page" : undefined}
                  className={`${downloadLinkClass} aria-[current=page]:border-accent aria-[current=page]:text-accent`}
                >
                  {p.key}
                </a>
              </li>
            ))}
          </ul>
          <p className="text-[13px] text-fg-muted">
            {t("period", {
              start: formatDate(`${period.start}T00:00:00.000Z`, "UTC"),
              end: formatDate(`${period.end}T00:00:00.000Z`, "UTC"),
            })}
          </p>
        </nav>
        <a href={`/reports/files/board.pdf${query}`} className={downloadLinkClass}>
          <DownloadIcon aria-hidden className="size-4" />
          {t("download")}
        </a>
      </div>

      <Section id="board-tiles" title={t("tiles.title")}>
        <BoardTiles
          tiles={pack.tiles}
          periodLabel={periodName(period, t("last30Days"))}
          labelledBy="board-tiles"
        />
      </Section>

      <Section id="board-maps" title={t("maps.title")}>
        <div className="grid gap-6 md:grid-cols-2">
          <div className="flex min-w-0 flex-col gap-2">
            <h3 className="text-sm font-semibold text-fg">{t("maps.now")}</h3>
            <RiskMap
              map={pack.mapNow}
              scale={scale}
              compact
              label={`${mapLabel}: ${t("maps.now")}`}
            />
          </div>
          <div className="flex min-w-0 flex-col gap-2">
            <h3 className="text-sm font-semibold text-fg">{t("maps.expected")}</h3>
            <RiskMap
              map={pack.mapExpected}
              scale={scale}
              compact
              label={`${mapLabel}: ${t("maps.expected")}`}
            />
          </div>
        </div>
        <a href="/risks?view=map" className="w-fit text-sm font-semibold text-accent">
          {t("maps.open")}
        </a>
      </Section>

      <Section id="board-movement" title={t("movement.title")}>
        <BoardMovementChart weeks={pack.movement} />
      </Section>

      <Section id="board-owners" title={t("owners.title")}>
        <BoardOwners owners={pack.owners} />
      </Section>

      <Section id="board-top-risks" title={t("topRisks.title")}>
        <BoardTopRisks risks={pack.topRisks} labelledBy="board-top-risks" />
      </Section>

      <Section id="board-narrative" title={t("narrative.title")}>
        <BoardNarrative
          key={period.key}
          period={period.key}
          narrative={pack.narrative}
          endedYesterday={endedYesterday(period, pack.generatedAt)}
          periodLabel={periodName(period, t("last30Days"))}
          canDraft={pack.canDraftNarrative}
          canApprove={pack.canApproveNarrative}
          scoped={pack.scope.kind === "units"}
          timeZone={timeZone}
        />
      </Section>
    </div>
  );
}
