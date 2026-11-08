"use client";

import type { AiSystemDetailDto } from "@isms/contracts";
import { AiBadge, buttonVariants, cn, StatusBadge } from "@isms/ui";
import { ListChecksIcon } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useId } from "react";
import { formatDate } from "../../lib/dates";
import { Section } from "../risks/section";
import { ClassBadge } from "./badges";
import { ReasonList } from "./reason-list";

/**
 * The class the rules gave, why (as sentences with their articles), whether the answers
 * started from an AI draft, and who classified it when.
 */
export function ClassificationSection({
  system,
  canManage,
  timeZone,
}: {
  system: AiSystemDetailDto;
  canManage: boolean;
  timeZone: string;
}) {
  const t = useTranslations("aiAct.classification");
  const whyId = useId();
  const c = system.classification;
  return (
    <Section title={t("title")} intro={c ? t("intro") : undefined}>
      {c ? (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <ClassBadge riskClass={c.result.riskClass} />
            {c.source === "ai_assisted" ? (
              <AiBadge state="draft" label={t("source.ai_assisted")} />
            ) : (
              <StatusBadge status="info" label={t("source.manual")} />
            )}
          </div>
          <div className="flex flex-col gap-2">
            <h3 id={whyId} className="text-[15px] font-semibold text-fg">
              {t("why")}
            </h3>
            <ReasonList reasons={c.result.reasons} labelledBy={whyId} />
          </div>
          <p className="text-[13px] text-fg-muted">
            {t("by", {
              name: c.classifiedBy.displayName,
              date: formatDate(c.classifiedAt, timeZone),
            })}
          </p>
        </div>
      ) : (
        <p className="text-sm text-fg-muted">{t("none")}</p>
      )}
      {canManage ? (
        <Link
          href={`/ai-act/systems/${system.id}/classify`}
          className={cn(
            buttonVariants({ variant: c ? "secondary" : "primary", size: "sm" }),
            "w-fit",
          )}
        >
          <ListChecksIcon aria-hidden />
          {c ? t("reclassify") : t("classify")}
        </Link>
      ) : null}
    </Section>
  );
}
