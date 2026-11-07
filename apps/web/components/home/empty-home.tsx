"use client";

import { buttonVariants, cn } from "@isms/ui";
import { ArrowRightIcon, CompassIcon, InboxIcon, ShieldIcon, UsersIcon } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Entrance } from "../motion/entrance";
import { glass } from "./styles";
import { WorkspaceIllustration } from "./workspace-illustration";

type SetupProps = {
  /** The viewer may manage the organisation (`organisation.manage`), so setup is theirs. */
  canSetUp: boolean;
  /** The API reports setup as finished. */
  setupDone: boolean;
};

const UPCOMING = [
  { key: "posture", icon: ShieldIcon },
  { key: "attention", icon: InboxIcon },
  { key: "next", icon: CompassIcon },
] as const;

/**
 * The designed empty state, for a workspace with no records the viewer can see. It shows no
 * metrics or placeholder numbers; nothing here is computed from data that does not exist yet.
 */
export function EmptyHome({ canSetUp, setupDone }: SetupProps) {
  const t = useTranslations("home");
  return (
    <>
      <Entrance order={1}>
        <section
          aria-labelledby="home-empty-title"
          className={cn(
            glass,
            "relative grid overflow-hidden p-6 sm:p-10 md:grid-cols-[minmax(0,1fr)_260px] md:items-center md:gap-8",
          )}
        >
          <div
            aria-hidden
            className="pointer-events-none absolute -top-24 -right-24 size-72 rounded-full bg-[radial-gradient(closest-side,color-mix(in_oklab,var(--isms-accent)_14%,transparent),transparent)]"
          />
          <WorkspaceIllustration className="mx-auto mb-6 w-56 md:order-2 md:mb-0 md:w-full" />
          <div className="relative flex flex-col gap-4">
            <h2
              id="home-empty-title"
              className="text-2xl leading-tight font-bold tracking-[-0.02em] text-fg sm:text-[28px]"
            >
              {t("empty.title")}
            </h2>
            <p className="max-w-[46ch] text-[15px] leading-relaxed text-fg-muted">
              {setupDone ? t("empty.bodyDone") : t("empty.body")}
            </p>
            <SetupHint canSetUp={canSetUp} setupDone={setupDone} />
          </div>
        </section>
      </Entrance>

      <Entrance order={2}>
        <section aria-labelledby="home-upcoming-title" className="flex flex-col gap-3">
          <h2
            id="home-upcoming-title"
            className="px-1 text-xs font-bold tracking-[0.08em] text-fg-muted uppercase"
          >
            {t("empty.upcomingTitle")}
          </h2>
          <ul className="grid gap-3 md:grid-cols-3">
            {UPCOMING.map(({ key, icon: Icon }) => (
              <li key={key} className={cn(glass, "flex flex-col gap-3 rounded-md p-5")}>
                <div className="flex items-center justify-between gap-3">
                  <span className="inline-flex size-9 items-center justify-center rounded-full bg-accent-soft text-accent">
                    <Icon aria-hidden className="size-[18px]" strokeWidth={2} />
                  </span>
                  <span className="rounded-full border border-dashed border-control-border px-2.5 py-0.5 text-[11px] font-semibold text-fg-muted">
                    {setupDone ? t("empty.upcomingStatusDone") : t("empty.upcomingStatus")}
                  </span>
                </div>
                <div className="flex flex-col gap-1">
                  <h3 className="text-[15px] font-semibold text-fg">{t(`empty.${key}`)}</h3>
                  <p className="text-[13px] leading-relaxed text-fg-muted">
                    {t(`empty.${key}Plain`)}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </section>
      </Entrance>
    </>
  );
}

const hintIcon =
  "inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-info-soft text-info";

/** Who sets up the organisation, and the way into setup (or its review) for administrators. */
export function SetupHint({ canSetUp, setupDone }: SetupProps) {
  const t = useTranslations("home.hint");
  if (!canSetUp) {
    return (
      <p className="mt-2 flex items-center gap-2.5 text-sm font-medium text-fg">
        <span className={hintIcon}>
          <UsersIcon aria-hidden className="size-3.5" strokeWidth={2.25} />
        </span>
        {setupDone ? t("memberDone") : t("member")}
      </p>
    );
  }
  return (
    <div className="mt-2 flex flex-col items-start gap-3">
      <p className="text-sm font-medium text-fg">{setupDone ? t("adminDone") : t("admin")}</p>
      <Link
        href={setupDone ? "/setup/review" : "/setup"}
        className={buttonVariants({ variant: setupDone ? "secondary" : "primary" })}
      >
        {setupDone ? t("reviewSetup") : t("setupAction")}
        <ArrowRightIcon aria-hidden />
      </Link>
    </div>
  );
}
