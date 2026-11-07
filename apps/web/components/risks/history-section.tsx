"use client";

import { HistoryIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { formatDate } from "../../lib/dates";
import { useRisk } from "./risk-context";
import { Section } from "./section";

const list = new Intl.ListFormat("en-GB", { style: "long", type: "conjunction" });

/** Every version of the risk, newest first: who, when and which fields changed. */
export function HistorySection() {
  const t = useTranslations("risks.history");
  const { risk, timeZone } = useRisk();

  // Field names the page does not know yet (later plans) read as "other details".
  const name = (field: string) =>
    t.has(`fields.${field}` as "fields.other")
      ? t(`fields.${field}` as "fields.other")
      : t("fields.other");
  const changed = (fields: readonly string[]) => list.format([...new Set(fields.map(name))]);

  return (
    <Section title={t("title")}>
      <ol aria-label={t("listLabel")} className="flex flex-col gap-3">
        {risk.history.map((entry) => (
          <li key={entry.version} className="flex items-start gap-3">
            <HistoryIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-fg-muted" />
            <div className="flex min-w-0 flex-col gap-0.5 text-[14px]">
              <p className="font-semibold text-fg">{t("entry", { version: entry.version })}</p>
              <p className="text-fg-muted">
                {t("by", {
                  name: entry.changedBy.displayName,
                  date: formatDate(entry.at, timeZone),
                })}
              </p>
              <p className="text-fg">
                {entry.changedFields.length === 0
                  ? t("reported")
                  : t("changed", { fields: changed(entry.changedFields) })}
              </p>
            </div>
          </li>
        ))}
      </ol>
    </Section>
  );
}
