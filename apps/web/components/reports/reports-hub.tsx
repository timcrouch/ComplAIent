import { DownloadIcon, ExternalLinkIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { glass } from "../setup/styles";
import { downloadLinkClass } from "./styles";

type Card = {
  key: "register" | "soa" | "board";
  open?: string;
  files: readonly ("xlsx" | "pdf")[];
  name: string;
};

const CARDS: readonly Card[] = [
  { key: "register", files: ["xlsx", "pdf"], name: "risk-register" },
  { key: "soa", open: "/reports/soa", files: ["xlsx", "pdf"], name: "soa" },
  { key: "board", open: "/reports/board", files: ["pdf"], name: "board" },
];

/** The report cards: what each report is for, and where to open or download it. */
export function ReportsHub() {
  const t = useTranslations("reports");
  return (
    <ul className="grid gap-4 md:grid-cols-2">
      {CARDS.map((card) => {
        const title = t(`cards.${card.key}.title`);
        return (
          <li key={card.key}>
            <section
              role="group"
              aria-label={title}
              className={`${glass} flex h-full flex-col gap-4 p-5`}
            >
              <div className="flex flex-col gap-1.5">
                <h2 className="text-[17px] font-semibold text-fg">{title}</h2>
                <p className="text-sm leading-relaxed text-fg-muted">
                  {t(`cards.${card.key}.purpose`)}
                </p>
                {card.key === "register" ? (
                  <p className="text-xs text-fg-muted">{t("cards.register.hint")}</p>
                ) : null}
              </div>
              <div className="mt-auto flex flex-wrap gap-2">
                {card.open ? (
                  <a href={card.open} className={downloadLinkClass}>
                    <ExternalLinkIcon aria-hidden className="size-4" />
                    {t("actions.open")}
                    <span className="sr-only"> {title}</span>
                  </a>
                ) : null}
                {card.files.map((ext) => (
                  <a
                    key={ext}
                    href={`/reports/files/${card.name}.${ext}`}
                    className={downloadLinkClass}
                  >
                    <DownloadIcon aria-hidden className="size-4" />
                    {t(ext === "xlsx" ? "actions.excel" : "actions.pdf")}
                    <span className="sr-only"> {title}</span>
                  </a>
                ))}
              </div>
            </section>
          </li>
        );
      })}
    </ul>
  );
}
