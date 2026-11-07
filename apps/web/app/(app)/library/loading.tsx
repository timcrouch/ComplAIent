import { useTranslations } from "next-intl";
import { glass } from "../../../components/setup/styles";

/** Server component: no @isms/ui import (its barrel includes client-only components). */
const cn = (...classes: string[]) => classes.join(" ");

/** Pulses only when motion is allowed (motion-safe); the shapes alone carry the meaning. */
const bone =
  "rounded-full bg-[color-mix(in_oklab,var(--isms-text)_9%,transparent)] motion-safe:animate-pulse";

/** The library's shape while it loads: a heading, the search panel, the filter bar and cards, no numbers. */
export default function LibraryLoading() {
  const t = useTranslations("library");
  return (
    <div
      aria-busy="true"
      aria-label={t("loading")}
      role="status"
      className="mx-auto flex w-full max-w-[1200px] flex-col gap-6"
    >
      <span className="sr-only">{t("loading")}</span>
      <div aria-hidden className="flex flex-col gap-3">
        <span className={cn(bone, "h-3 w-28")} />
        <span className={cn(bone, "h-8 w-48")} />
        <span className={cn(bone, "h-3 w-full max-w-[560px]")} />
      </div>
      <div aria-hidden className={cn(glass, "flex flex-col gap-3 p-4 sm:p-5")}>
        <span className={cn(bone, "h-3 w-32")} />
        <span className="h-10 w-full rounded-sm border border-surface-border bg-surface" />
      </div>
      <div aria-hidden className="flex flex-col gap-3">
        <span className={cn(bone, "h-3 w-20")} />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <span key={i} className="h-10 rounded-sm border border-surface-border bg-surface" />
          ))}
        </div>
      </div>
      <ul aria-hidden className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <li key={i} className={cn(glass, "flex flex-col gap-3 p-4 sm:p-5")}>
            <span className={cn(bone, "h-3 w-20")} />
            <span className={cn(bone, "h-5 w-16 rounded-sm")} />
            <span className={cn(bone, "h-4 w-4/5")} />
            <span className={cn(bone, "mt-2 h-6 w-40")} />
          </li>
        ))}
      </ul>
    </div>
  );
}
