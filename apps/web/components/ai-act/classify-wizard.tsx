"use client";

import {
  conflictReasons,
  type AiClassificationDraftResponse,
  type AiSystemDetailDto,
} from "@isms/contracts";
import { AiBadge, Button, cn } from "@isms/ui";
import { ArrowLeftIcon, ArrowRightIcon, CircleAlertIcon, SparklesIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { classifyAiSystem, draftAiClassification } from "../../lib/actions/ai-act";
import { settle, signInAgain } from "../risks/risk-call";
import { glass } from "../setup/styles";
import { ModuleHeader } from "./module-header";
import {
  draftFrom,
  finalAnswers,
  nextStep,
  previousStep,
  unansweredOn,
  WIZARD_STEPS,
  type DraftAnswers,
  type WizardStep,
} from "./wizard-answers";
import { WizardResult, WizardReview } from "./wizard-review";
import { WizardStepQuestions } from "./wizard-steps";

type Rationales = AiClassificationDraftResponse["rationales"];
type Problem = "draftUnavailable" | "draftFailed" | "saveFailed" | "forbidden";

type Props = {
  system: AiSystemDetailDto;
  /** The system's `canDraftClassification`: the viewer may, and the AI purpose is ready. */
  canDraft: boolean;
};

/**
 * The classification questionnaire as a short wizard: one question group per step, help for
 * every option, and a review. "Draft answers with AI" fills every answer and shows the AI's
 * rationale under each question; the person changes what they want and saves. The server
 * decides the class, and its result is shown before going back to the system.
 */
export function ClassifyWizard({ system, canDraft }: Props) {
  const t = useTranslations("aiAct");
  const [draft, setDraft] = useState<DraftAnswers>(() =>
    draftFrom(system.classification?.answers ?? null),
  );
  const [step, setStep] = useState<WizardStep>("aiSystem");
  const [furthest, setFurthest] = useState(system.classification ? WIZARD_STEPS.length - 1 : 0);
  const [showMissing, setShowMissing] = useState(false);
  const [rationales, setRationales] = useState<Rationales | null>(null);
  const [interactionId, setInteractionId] = useState<string | null>(null);
  const [busy, setBusy] = useState<"drafting" | "saving" | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [saved, setSaved] = useState<AiSystemDetailDto | null>(null);
  const stepHeading = useRef<HTMLHeadingElement>(null);
  const moved = useRef(false);
  const index = WIZARD_STEPS.indexOf(step);

  // After moving between steps, start at the new step's heading.
  useEffect(() => {
    if (moved.current) stepHeading.current?.focus();
  }, [step]);

  function go(next: WizardStep) {
    moved.current = true;
    setShowMissing(false);
    setProblem(null);
    setStep(next);
    setFurthest((f) => Math.max(f, WIZARD_STEPS.indexOf(next)));
  }

  function forward() {
    if (unansweredOn(step, draft)) {
      setShowMissing(true);
      requestAnimationFrame(() => {
        document.querySelector<HTMLElement>('[data-wizard-step] [aria-invalid="true"]')?.focus();
      });
      return;
    }
    go(nextStep(step, draft));
  }

  async function aiDraft() {
    if (busy) return;
    setBusy("drafting");
    setProblem(null);
    setAnnouncement(t("wizard.announceDrafting"));
    const result = await settle(() => draftAiClassification(system.id));
    setBusy(null);
    if (result.ok) {
      setDraft(draftFrom(result.data.answers));
      setRationales(result.data.rationales);
      setInteractionId(result.data.interactionId);
      setFurthest(WIZARD_STEPS.length - 1);
      setAnnouncement(t("wizard.announceDrafted"));
      go("aiSystem");
    } else if (!signInAgain(result)) {
      const ai =
        result.kind === "conflict" &&
        conflictReasons(result.details).some((r) => r.reason === "aiUnavailable");
      setAnnouncement("");
      setProblem(ai ? "draftUnavailable" : "draftFailed");
    }
  }

  async function save() {
    const answers = finalAnswers(draft);
    if (busy || !answers) return;
    setBusy("saving");
    setProblem(null);
    const result = await settle(() => classifyAiSystem(system.id, { answers, interactionId }));
    setBusy(null);
    if (result.ok) setSaved(result.data);
    else if (!signInAgain(result)) {
      setProblem(result.kind === "forbidden" ? "forbidden" : "saveFailed");
    }
  }

  const header = (
    <ModuleHeader
      title={t("wizard.title", { name: system.name })}
      intro={saved ? undefined : t("wizard.intro")}
      back={{
        href: `/ai-act/systems/${system.id}`,
        label: t("backToSystem", { name: system.name }),
      }}
    />
  );

  if (saved) {
    return (
      <div className="flex flex-col gap-6">
        {header}
        <div className={cn(glass, "p-5 sm:p-8")}>
          <WizardResult system={saved} />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {header}
      <p role="status" className="sr-only">
        {announcement}
      </p>
      {canDraft ? (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
          <Button
            type="button"
            variant="secondary"
            disabled={busy !== null}
            focusableWhenDisabled
            onClick={() => void aiDraft()}
            className="w-fit"
          >
            <SparklesIcon aria-hidden />
            {busy === "drafting" ? t("wizard.drafting") : t("wizard.draft")}
          </Button>
          {interactionId ? (
            <span className="flex flex-wrap items-center gap-2 text-[13px] text-fg-muted">
              <AiBadge state="draft" label={t("wizard.draftBadge")} />
              {t("wizard.draftNote")}
            </span>
          ) : null}
        </div>
      ) : null}

      <nav aria-label={t("wizard.stepsLabel")}>
        <ol className="grid grid-cols-3 gap-1 sm:grid-cols-6">
          {WIZARD_STEPS.map((s, i) => {
            const current = s === step;
            const reachable = i <= furthest && !current;
            const body = (
              <>
                <span
                  aria-hidden
                  className={cn(
                    "inline-flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold",
                    current ? "bg-accent text-on-accent" : "border border-control-border",
                  )}
                >
                  {i + 1}
                </span>
                <span className="leading-tight">{t(`wizard.steps.${s}`)}</span>
              </>
            );
            const itemClass = cn(
              "flex min-h-10 w-full flex-col items-center gap-1 rounded-md px-1.5 py-1.5 text-center text-[12px] font-semibold",
              current ? "bg-accent-soft text-accent" : "text-fg-muted",
            );
            return (
              <li key={s}>
                {reachable ? (
                  <button
                    type="button"
                    onClick={() => {
                      go(s);
                    }}
                    className={cn(
                      itemClass,
                      "hover:text-fg focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:outline-none",
                    )}
                  >
                    {body}
                  </button>
                ) : (
                  <span aria-current={current ? "step" : undefined} className={itemClass}>
                    {body}
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      </nav>

      <section
        data-wizard-step={step}
        aria-labelledby="wizard-step-title"
        className={cn(glass, "flex flex-col gap-6 p-5 sm:p-8")}
      >
        <div className="flex flex-col gap-1">
          <p className="text-[13px] font-semibold text-accent">
            {t("wizard.stepOf", { current: index + 1, total: WIZARD_STEPS.length })}
          </p>
          <h2
            id="wizard-step-title"
            ref={stepHeading}
            tabIndex={-1}
            className="text-[22px] font-bold text-fg outline-none"
          >
            {t(`wizard.steps.${step}`)}
          </h2>
        </div>
        {step === "review" ? (
          <WizardReview draft={draft} onChange={go} />
        ) : (
          <WizardStepQuestions
            step={step}
            draft={draft}
            onChange={setDraft}
            rationales={rationales}
            showMissing={showMissing}
          />
        )}
        {problem ? (
          <p
            role="alert"
            className="flex items-start gap-2 rounded-md bg-critical-soft px-3.5 py-3 text-sm font-medium text-critical"
          >
            <CircleAlertIcon aria-hidden className="mt-px size-4 shrink-0" />
            <span>{t(`wizard.${problem}`)}</span>
          </p>
        ) : null}
        <div className="flex flex-col-reverse gap-3 border-t border-[color-mix(in_oklab,var(--isms-text)_8%,transparent)] pt-6 sm:flex-row sm:items-center">
          {index > 0 ? (
            <Button
              type="button"
              variant="ghost"
              className="sm:mr-auto"
              onClick={() => {
                go(previousStep(step, draft));
              }}
            >
              <ArrowLeftIcon aria-hidden />
              {t("wizard.back")}
            </Button>
          ) : null}
          {step === "review" ? (
            <Button
              type="button"
              className="sm:ml-auto"
              disabled={busy !== null || finalAnswers(draft) === null}
              focusableWhenDisabled
              onClick={() => void save()}
            >
              {busy === "saving" ? t("wizard.saving") : t("wizard.save")}
            </Button>
          ) : (
            <Button type="button" className="sm:ml-auto" onClick={forward}>
              {t("wizard.next")}
              <ArrowRightIcon aria-hidden />
            </Button>
          )}
        </div>
      </section>
    </div>
  );
}
