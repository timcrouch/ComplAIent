import { libraryRoutes } from "@isms/contracts";
import { DownloadIcon, InfoIcon } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { ControlFilters } from "../../../components/library/control-filters";
import { ControlList } from "../../../components/library/control-list";
import { Entrance } from "../../../components/motion/entrance";
import { StatusScreen } from "../../../components/status/status-screen";
import { requireViewer } from "../../../lib/current-viewer";
import { libraryMetadata, libraryQuery } from "../../../lib/library-page";
import { activeFilters } from "../../../lib/library-url";
import { failureScreen } from "../../../lib/page-result";
import { callApi } from "../../../lib/server-api";

export const metadata = libraryMetadata();

type LibraryPageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const PATH = "/library";

/** The control library for professionals: search, filters, review status and the CSV download. */
export default async function LibraryPage({ searchParams }: LibraryPageProps) {
  const viewer = await requireViewer();
  if (!viewer.ok) return viewer.screen;
  // Hiding is presentation; the API refuses the calls anyway.
  if (!viewer.me.permissions.includes("library.read")) {
    return <StatusScreen kind="forbidden" retryHref="/" />;
  }

  const query = libraryQuery(await searchParams);
  // "59 of 99 controls" once a search or filter narrows the list; the whole library is the 99.
  const narrowed = Boolean(query.q) || activeFilters(query).length > 0;
  const [controls, frameworks, whole] = await Promise.all([
    callApi(libraryRoutes.listControls, { query }, { returnTo: PATH }),
    callApi(libraryRoutes.listFrameworks, {}, { returnTo: PATH }),
    narrowed
      ? callApi(libraryRoutes.listControls, { query: { review: "all" } }, { returnTo: PATH })
      : null,
  ]);
  if (!controls.ok) return failureScreen(controls, PATH);
  if (!frameworks.ok) return failureScreen(frameworks, PATH);
  // The count out of the whole is a courtesy: without it the list still shows its own count.
  const total = whole?.ok ? whole.data.items.length : undefined;

  const t = await getTranslations("library");
  // View mode never limits access: other views see the page, with a word about its detail.
  const professional = viewer.me.viewMode === "professional";

  return (
    <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-6">
      <Entrance className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className="flex flex-col gap-3">
          <p className="text-[13px] font-semibold text-accent">{t("eyebrow")}</p>
          <h1 className="text-[28px] leading-[1.15] font-bold tracking-[-0.025em] text-fg sm:text-[34px]">
            {t("title")}
          </h1>
          <p className="max-w-[68ch] text-[15px] leading-relaxed text-fg-muted">{t("intro")}</p>
        </div>
        <div className="flex shrink-0 flex-col gap-1.5 md:items-end">
          {/* A plain link: the browser downloads the attachment, no client routing. */}
          <a
            href="/library/export"
            download
            aria-describedby="library-download-hint"
            className="inline-flex h-10 w-fit items-center gap-2 rounded-sm border border-[color-mix(in_oklab,var(--isms-text)_10%,transparent)] bg-surface px-4 text-sm font-semibold text-fg shadow-glass transition-colors duration-(--motion-fast) ease-standard outline-none hover:bg-[color-mix(in_oklab,var(--isms-surface),var(--isms-text)_5%)] focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
          >
            <DownloadIcon aria-hidden className="size-4" />
            {t("download")}
          </a>
          <p id="library-download-hint" className="text-xs text-fg-muted">
            {t("downloadHint")}
          </p>
        </div>
      </Entrance>
      {professional ? null : (
        <Entrance order={1}>
          <p className="flex max-w-[80ch] items-start gap-2.5 rounded-md bg-info-soft/70 px-4 py-3 text-[13px] leading-relaxed text-fg">
            <InfoIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-info" />
            <span>{t("professionalNote")}</span>
          </p>
        </Entrance>
      )}
      <Entrance order={1}>
        <ControlFilters frameworks={frameworks.data.frameworks} query={query}>
          <ControlList
            items={controls.data.items}
            frameworks={frameworks.data.frameworks}
            total={total}
          />
        </ControlFilters>
      </Entrance>
    </div>
  );
}
