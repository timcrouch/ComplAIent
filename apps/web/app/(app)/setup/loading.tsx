import { useTranslations } from "next-intl";
import { glass } from "../../../components/setup/styles";
import { SETUP_STEPS } from "../../../components/setup/steps";

/** Server component: no @isms/ui import (its barrel includes client-only components). */
const cn = (...classes: string[]) => classes.join(" ");

/** Pulses only when motion is allowed (motion-safe); the shapes alone carry the meaning. */
const bone =
  "rounded-full bg-[color-mix(in_oklab,var(--isms-text)_9%,transparent)] motion-safe:animate-pulse";

/** The setup frame's shape while a step loads: the step list and a card, with no numbers. */
export default function SetupLoading() {
  const t = useTranslations("setup");
  return (
    <div
      aria-busy="true"
      aria-label={t("loading")}
      role="status"
      className="mx-auto grid w-full max-w-[1040px] gap-6 lg:grid-cols-[232px_minmax(0,1fr)] lg:gap-10"
    >
      <span className="sr-only">{t("loading")}</span>
      <div
        aria-hidden
        className={cn(
          glass,
          "grid grid-cols-2 gap-1 p-2 sm:grid-cols-3 md:grid-cols-6 lg:grid-cols-1 lg:p-3",
        )}
      >
        {SETUP_STEPS.map((step) => (
          <div key={step.key} className="flex min-h-10 items-center gap-2 px-2 py-1.5">
            <span className={cn(bone, "size-6 shrink-0")} />
            <span className={cn(bone, "h-3 w-full max-w-28")} />
          </div>
        ))}
      </div>
      <div aria-hidden className="flex flex-col gap-6">
        <div className="flex flex-col gap-3">
          <span className={cn(bone, "h-3 w-24")} />
          <span className={cn(bone, "h-8 w-3/5")} />
          <span className={cn(bone, "h-3 w-4/5")} />
        </div>
        <div className={cn(glass, "flex flex-col gap-6 p-5 sm:p-8")}>
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex max-w-[560px] flex-col gap-2">
              <span className={cn(bone, "h-3 w-40")} />
              <span className="h-10 w-full rounded-sm border border-surface-border bg-surface" />
            </div>
          ))}
          <span className={cn(bone, "ml-auto h-10 w-40 rounded-sm")} />
        </div>
      </div>
    </div>
  );
}
