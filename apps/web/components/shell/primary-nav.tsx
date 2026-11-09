"use client";

import { cn } from "@isms/ui";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { PendingLink } from "../navigation/pending-link";
import { BrandMark, BrandWordmark } from "./brand";
import { isCurrent, type NavItem } from "./nav-items";
import { focusRingClass } from "./styles";

type PrimaryNavLinkProps = {
  item: NavItem;
  current: boolean;
  label: string;
  pendingLabel: string;
};

function PrimaryNavLink({ item, current, label, pendingLabel }: PrimaryNavLinkProps) {
  const { href, icon: Icon } = item;

  return (
    <PendingLink
      href={href}
      aria-current={current ? "page" : undefined}
      preventNavigation={current}
      pendingLabel={pendingLabel}
      showIndicator={false}
      pendingClassName="bg-accent-soft text-accent lg:bg-accent-soft lg:hover:bg-accent-soft"
      className={cn(
        "flex min-w-16 flex-col items-center gap-1 rounded-md px-3 py-1.5 text-[11px] font-semibold text-fg-muted",
        "lg:h-10 lg:flex-row lg:gap-3 lg:px-3 lg:py-0 lg:text-sm",
        "transition-colors duration-(--motion-fast) ease-standard hover:text-fg",
        "lg:hover:bg-[color-mix(in_oklab,transparent,var(--isms-text)_6%)]",
        current && "text-accent lg:bg-accent-soft lg:text-accent lg:hover:bg-accent-soft",
        focusRingClass,
      )}
    >
      {(pending) => (
        <>
          <span className="relative size-5 shrink-0 lg:size-[18px]">
            <Icon
              aria-hidden
              className={cn("size-5 lg:size-[18px]", pending && "opacity-25")}
              strokeWidth={2}
            />
            {pending ? (
              <span
                aria-hidden
                data-nav-pending-indicator=""
                className="absolute inset-[3px] animate-spin rounded-full border-2 border-accent border-t-transparent motion-reduce:animate-none"
              />
            ) : null}
          </span>
          <span>{label}</span>
        </>
      )}
    </PendingLink>
  );
}

/**
 * Persistent primary navigation: a glass sidebar on large screens, a bottom bar on small
 * ones. `items` come from navItemsFor; `account` is the user menu, placed at the end of the bar.
 */
export function PrimaryNav({ items, account }: { items: readonly NavItem[]; account: ReactNode }) {
  const t = useTranslations();
  const pathname = usePathname();
  return (
    <nav
      aria-label={t("nav.label")}
      className={cn(
        "fixed inset-x-0 bottom-0 z-40 flex items-center justify-around gap-2 px-4 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]",
        "border-t border-surface-border bg-[color-mix(in_oklab,var(--isms-bg)_82%,transparent)] backdrop-blur-xl",
        "lg:inset-y-3 lg:right-auto lg:left-3 lg:w-60 lg:flex-col lg:items-stretch lg:justify-start lg:gap-1 lg:rounded-lg lg:border lg:bg-surface lg:p-3 lg:shadow-glass lg:backdrop-blur-none",
      )}
    >
      <div className="hidden items-center gap-2.5 px-2 pt-1 pb-5 lg:flex">
        <BrandMark />
        <div className="flex flex-col leading-tight">
          <BrandWordmark name={t("app.name")} className="text-fg" />
          <span className="text-[11px] whitespace-nowrap text-fg-muted">{t("app.tagline")}</span>
        </div>
      </div>
      <ul className="contents lg:flex lg:flex-col lg:gap-1">
        {items.map((item) => {
          const { key } = item;
          const current = isCurrent(item, pathname);
          const label = t(`nav.${key}`);
          return (
            <li key={key} className="contents lg:block">
              <PrimaryNavLink
                item={item}
                current={current}
                label={label}
                pendingLabel={t("nav.loading", { destination: label })}
              />
            </li>
          );
        })}
      </ul>
      <div className="lg:mt-auto lg:border-t lg:border-[color-mix(in_oklab,var(--isms-text)_8%,transparent)] lg:pt-2">
        {account}
      </div>
    </nav>
  );
}
