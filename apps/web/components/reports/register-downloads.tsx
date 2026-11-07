import type { RiskListFilter } from "@isms/contracts";
import { DownloadIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { downloadLinkClass } from "./styles";

/** Download links for the risk register, carrying the list's current filter. */
export function RegisterDownloads({
  filter,
  includeClosed,
  cellFilter = false,
}: {
  filter: RiskListFilter;
  includeClosed: boolean;
  /** The list is narrowed to a map cell, which the files do not apply. */
  cellFilter?: boolean;
}) {
  const t = useTranslations("reports.registerLinks");
  const query = `?filter=${filter}${includeClosed ? "&includeClosed=true" : ""}`;
  return (
    <div role="group" aria-label={t("label")} className="flex flex-wrap items-center gap-2">
      {(["xlsx", "pdf"] as const).map((ext) => (
        // Plain links, no client routing. The API's Content-Disposition makes the browser save
        // the file; without a `download` attribute the proxy's plain-text errors stay readable.
        <a
          key={ext}
          href={`/reports/files/risk-register.${ext}${query}`}
          className={downloadLinkClass}
        >
          <DownloadIcon aria-hidden className="size-4" />
          {t(ext === "xlsx" ? "excel" : "pdf")}
        </a>
      ))}
      <span className="text-xs text-fg-muted">{t("hint")}</span>
      {cellFilter ? <span className="text-xs text-fg-muted">{t("cellHint")}</span> : null}
    </div>
  );
}
