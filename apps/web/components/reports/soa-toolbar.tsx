import type { SoaFrameworkDto } from "@isms/contracts";
import { cn } from "@isms/ui";
import { CheckIcon, DownloadIcon } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { downloadLinkClass } from "./styles";

/** The page's address for a framework and filter; both survive the other's change. */
export function soaHref(framework: string | undefined, undecided: boolean): string {
  const params = new URLSearchParams();
  if (framework) params.set("framework", framework);
  if (undecided) params.set("undecided", "1");
  const query = params.toString();
  return query ? `/reports/soa?${query}` : "/reports/soa";
}

/** Framework picker, the "Only undecided" filter and the file downloads of the shown framework. */
export function SoaToolbar({
  frameworks,
  framework,
  undecided,
}: {
  frameworks: readonly SoaFrameworkDto[];
  framework: SoaFrameworkDto | null;
  undecided: boolean;
}) {
  const t = useTranslations("reports.soaPage");
  const query = framework ? `?framework=${encodeURIComponent(framework.key)}` : "";
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
      <nav aria-label={t("frameworkLabel")} className="flex flex-wrap gap-2">
        {frameworks.map((fw) => {
          const current = fw.key === framework?.key;
          return (
            <Link
              key={fw.key}
              href={soaHref(fw.key, undecided)}
              aria-current={current ? "page" : undefined}
              className={cn(
                "rounded-sm border px-3 py-1.5 text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-focus-ring",
                current
                  ? "border-accent bg-accent-soft text-accent"
                  : "border-surface-border text-fg-muted hover:text-fg",
              )}
            >
              {fw.name} {fw.versionLabel}
            </Link>
          );
        })}
      </nav>
      {framework ? (
        <>
          <Link
            href={soaHref(framework.key, !undecided)}
            aria-current={undecided ? "true" : undefined}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-sm border px-3 py-1.5 text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-focus-ring",
              undecided
                ? "border-accent bg-accent-soft text-accent"
                : "border-surface-border text-fg-muted hover:text-fg",
            )}
          >
            {undecided ? <CheckIcon aria-hidden className="size-4" /> : null}
            {t("onlyUndecided")}
          </Link>
          <div role="group" aria-label={t("downloads.label")} className="flex gap-2">
            {(["xlsx", "pdf"] as const).map((ext) => (
              <a key={ext} href={`/reports/files/soa.${ext}${query}`} className={downloadLinkClass}>
                <DownloadIcon aria-hidden className="size-4" />
                {t(ext === "xlsx" ? "downloads.excel" : "downloads.pdf")}
              </a>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}
