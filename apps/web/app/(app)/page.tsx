import { organisationRoutes, reportRoutes, workspaceRoutes } from "@isms/contracts";
import { cookies } from "next/headers";
import { getTranslations } from "next-intl/server";
import { HomeView } from "../../components/home/home-view";
import { requireViewer } from "../../lib/current-viewer";
import { dayPeriod, firstName, resolveTimeZone, TIME_ZONE_COOKIE } from "../../lib/greeting";
import { failureScreen } from "../../lib/page-result";
import { callApi } from "../../lib/server-api";

type HomePageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/**
 * Workspace home, built from the viewer's records (GET /workspace). The greeting is computed
 * here, in the user's time zone (lib/greeting.ts).
 */
export default async function HomePage({ searchParams }: HomePageProps) {
  // Every (app) page checks the session itself: layouts are skipped on client navigation.
  const viewer = await requireViewer();
  if (!viewer.ok) return viewer.screen;

  // Every signed-in user may read the organisation's setup status (P2-R14) and their own
  // workspace (me.read); the API counts only what the viewer may see.
  const [organisation, workspace] = await Promise.all([
    callApi(organisationRoutes.get, {}, { returnTo: "/" }),
    callApi(workspaceRoutes.get, {}, { returnTo: "/" }),
  ]);
  if (!organisation.ok) return failureScreen(organisation, "/");
  if (!workspace.ok) return failureScreen(workspace, "/");

  // The picture's map labels come from the organisation's risk scale.
  const scale = workspace.data.riskPicture
    ? (organisation.data.riskScale ?? organisation.data.defaultRiskScale)
    : null;

  // The "At a glance" block is loaded only in the executive view, and a failure leaves out the
  // block, not the page.
  const glance =
    viewer.me.viewMode === "executive" && viewer.me.permissions.includes("reports.read")
      ? await callApi(reportRoutes.board, { query: {} }, { returnTo: "/" })
      : null;

  const t = await getTranslations("home.greeting");
  const zone = resolveTimeZone((await cookies()).get(TIME_ZONE_COOKIE)?.value);
  const period = dayPeriod(new Date(), zone);
  const name = firstName(viewer.me.displayName);
  const greeting = name ? t(period, { name }) : t(`${period}NoName`);
  const setupDone = organisation.data.setup.completedAt !== null;

  return (
    <HomeView
      greeting={greeting}
      canSetUp={viewer.me.permissions.includes("organisation.manage")}
      setupDone={setupDone}
      justFinished={setupDone && (await searchParams).setup === "done"}
      workspace={workspace.data}
      scale={scale}
      glance={glance?.ok ? { tiles: glance.data.tiles, period: glance.data.period } : undefined}
    />
  );
}
