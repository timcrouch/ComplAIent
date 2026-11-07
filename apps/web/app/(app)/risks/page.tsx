import {
  MapBasisSchema,
  organisationRoutes,
  RiskListFilterSchema,
  riskInsightRoutes,
  riskRoutes,
} from "@isms/contracts";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { createTranslator } from "next-intl";
import { getTranslations } from "next-intl/server";
import { Entrance } from "../../../components/motion/entrance";
import { z } from "zod";
import { CellChip } from "../../../components/risks/cell-chip";
import { RegisterDownloads } from "../../../components/reports/register-downloads";
import { RiskFilters } from "../../../components/risks/risk-filters";
import { RiskMap } from "../../../components/risks/risk-map";
import { RiskQueue } from "../../../components/risks/risk-queue";
import { ViewSwitch } from "../../../components/risks/view-switch";
import { StatusScreen } from "../../../components/status/status-screen";
import { requireViewer } from "../../../lib/current-viewer";
import { resolveTimeZone, TIME_ZONE_COOKIE } from "../../../lib/greeting";
import { failureScreen } from "../../../lib/page-result";
import { callApi } from "../../../lib/server-api";
import messages from "../../../messages/index";

const PATH = "/risks";
const tm = createTranslator({ locale: "en", messages });

export const metadata: Metadata = { title: tm("risks.pageTitle", { app: tm("app.name") }) };

type RisksPageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/** The review queue: the risks the viewer may see, by filter, newest change first. */
export default async function RisksPage({ searchParams }: RisksPageProps) {
  const viewer = await requireViewer();
  if (!viewer.ok) return viewer.screen;
  // Hiding is presentation; the API refuses the calls anyway.
  if (!viewer.me.permissions.includes("risks.read")) {
    return <StatusScreen kind="forbidden" retryHref="/" />;
  }

  const params = await searchParams;
  const parsed = RiskListFilterSchema.safeParse(params.filter);
  const filter = parsed.success ? parsed.data : "all";
  const basis = MapBasisSchema.catch("inherent").parse(params.basis);
  const view = params.view === "map" ? "map" : "list";
  const level = z.coerce.number().int().min(1).max(5);
  const likelihood = level.safeParse(params.likelihood);
  const impact = level.safeParse(params.impact);
  const includeClosed = params.includeClosed === "true";
  const cell =
    likelihood.success && impact.success
      ? {
          likelihood: likelihood.data,
          impact: impact.data,
          basis,
          ...(includeClosed ? { includeClosed } : {}),
        }
      : undefined;

  const t = await getTranslations("risks");
  const heading = (
    <Entrance className="flex flex-col gap-3">
      <p className="text-[13px] font-semibold text-accent">{t("eyebrow")}</p>
      <h1 className="text-[28px] leading-[1.15] font-bold tracking-[-0.025em] text-fg sm:text-[34px]">
        {t("title")}
      </h1>
      <p className="max-w-[64ch] text-[15px] leading-relaxed text-fg-muted">{t("intro")}</p>
    </Entrance>
  );

  if (view === "map") {
    const [map, organisation] = await Promise.all([
      callApi(
        riskInsightRoutes.map,
        { query: { basis, ...(includeClosed ? { includeClosed: "true" as const } : {}) } },
        { returnTo: PATH },
      ),
      callApi(organisationRoutes.get, {}, { returnTo: PATH }),
    ]);
    if (!map.ok) return failureScreen(map, PATH);
    if (!organisation.ok) return failureScreen(organisation, PATH);
    const org = organisation.data;
    return (
      <div className="mx-auto flex w-full max-w-[880px] flex-col gap-6">
        {heading}
        <Entrance order={1} className="flex flex-col gap-4">
          <ViewSwitch view="map" basis={basis} includeClosed={includeClosed} />
          <RiskMap
            map={map.data}
            scale={org.riskScale ?? org.defaultRiskScale}
            includeClosed={includeClosed}
            cellHref={(l, i) =>
              `/risks?view=list&likelihood=${String(l)}&impact=${String(i)}&basis=${basis}${includeClosed ? "&includeClosed=true" : ""}`
            }
          />
        </Entrance>
      </div>
    );
  }

  const [page, organisation] = await Promise.all([
    callApi(
      riskRoutes.list,
      {
        query: {
          filter,
          ...(cell
            ? {
                likelihood: cell.likelihood,
                impact: cell.impact,
                basis: cell.basis,
                ...(cell.includeClosed ? { includeClosed: "true" as const } : {}),
              }
            : {}),
        },
      },
      { returnTo: PATH },
    ),
    cell ? callApi(organisationRoutes.get, {}, { returnTo: PATH }) : null,
  ]);
  if (!page.ok) return failureScreen(page, PATH);
  // Level names for the chip; numbers when the scale can't be read.
  const scale = organisation?.ok
    ? (organisation.data.riskScale ?? organisation.data.defaultRiskScale)
    : null;
  const timeZone = resolveTimeZone((await cookies()).get(TIME_ZONE_COOKIE)?.value);

  return (
    <div className="mx-auto flex w-full max-w-[880px] flex-col gap-6">
      {heading}
      <Entrance order={1} className="flex flex-col gap-4">
        <ViewSwitch view="list" basis={basis} />
        {cell ? <CellChip cell={cell} scale={scale} filter={filter} /> : null}
        <RiskFilters current={filter} cell={cell} />
        {viewer.me.permissions.includes("reports.read") ? (
          <RegisterDownloads
            filter={filter}
            includeClosed={includeClosed}
            cellFilter={cell !== undefined}
          />
        ) : null}
        <RiskQueue
          key={`${filter}:${String(cell?.likelihood ?? "")}:${String(cell?.impact ?? "")}:${basis}:${String(includeClosed)}`}
          filter={filter}
          initial={page.data}
          timeZone={timeZone}
          cell={cell}
        />
      </Entrance>
    </div>
  );
}
