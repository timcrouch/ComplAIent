"use client";

import type { AiSystemDetailDto } from "@isms/contracts";
import { Button, buttonVariants, DetailItem, DetailList } from "@isms/ui";
import { ArrowRightIcon, PencilIcon } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, useRef } from "react";
import { ClassBadge } from "./badges";
import { ReasonList } from "./reason-list";
import type { DraftAnswers, WizardStep } from "./wizard-answers";

const list = new Intl.ListFormat("en-GB", { style: "long", type: "conjunction" });

/** Every answer, with a way back to the step that asks it. */
export function WizardReview({
  draft,
  onChange,
}: {
  draft: DraftAnswers;
  onChange: (step: WizardStep) => void;
}) {
  const t = useTranslations("aiAct.wizard");
  const tr = useTranslations("aiActRules");
  const skipped = draft.isAiSystem === false;
  const yesNo = (v: boolean | null) => (v === null ? t("notAsked") : v ? t("yes") : t("no"));
  const names = (labels: string[]) => (labels.length === 0 ? t("noneChosen") : list.format(labels));
  const change = (step: WizardStep, what: string) => (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="-my-1"
      onClick={() => {
        onChange(step);
      }}
    >
      <PencilIcon aria-hidden />
      {t("change")} <span className="sr-only">{what}</span>
    </Button>
  );
  const rows: { step: WizardStep; label: string; value: string }[] = [
    { step: "aiSystem", label: t("isAiSystem.question"), value: yesNo(draft.isAiSystem) },
  ];
  if (!skipped) {
    rows.push(
      {
        step: "prohibited",
        label: t("prohibited.question"),
        value: names(draft.prohibitedPractices.map((p) => tr(`practices.${p}.label`))),
      },
      {
        step: "annexI",
        label: t("annexI.question"),
        value: yesNo(draft.annexISafetyComponent),
      },
      {
        step: "annexIII",
        label: t("annexIII.question"),
        value: names(draft.annexIIIAreas.map((a) => tr(`areas.${a}.label`))),
      },
      {
        step: "annexIII",
        label: t("profilesPeople.question"),
        value: yesNo(draft.annexIIIAreas.length > 0 ? draft.profilesPeople : null),
      },
      {
        step: "annexIII",
        label: t("derogation.question"),
        value:
          draft.annexIIIAreas.length > 0 && draft.derogation
            ? tr(`derogations.${draft.derogation}.label`)
            : t("notAsked"),
      },
      {
        step: "transparency",
        label: t("transparency.question"),
        value: names(draft.transparency.map((d) => tr(`duties.${d}.label`))),
      },
    );
  }
  return (
    <DetailList>
      {rows.map((row) => (
        <DetailItem key={row.label} label={row.label} action={change(row.step, row.label)}>
          {row.value}
        </DetailItem>
      ))}
    </DetailList>
  );
}

/** What the server decided after saving: the class, why, and how many obligations follow. */
export function WizardResult({ system }: { system: AiSystemDetailDto }) {
  const t = useTranslations("aiAct.wizard");
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    headingRef.current?.focus();
  }, []);
  const result = system.classification?.result;
  const applicable = system.obligations.filter((o) => o.applicable).length;
  return (
    <section aria-labelledby="wizard-result" className="flex flex-col gap-4">
      <h2
        id="wizard-result"
        ref={headingRef}
        tabIndex={-1}
        className="text-[22px] font-bold text-fg outline-none"
      >
        {t("resultTitle")}
      </h2>
      <p className="text-sm text-fg-muted">{t("resultIntro")}</p>
      <ClassBadge riskClass={system.riskClass} />
      {result ? <ReasonList reasons={result.reasons} /> : null}
      <p className="text-sm font-semibold text-fg">
        {t("resultObligations", { count: applicable })}
      </p>
      <Link href={`/ai-act/systems/${system.id}`} className={`${buttonVariants()} w-fit`}>
        {t("done")}
        <ArrowRightIcon aria-hidden />
      </Link>
    </section>
  );
}
