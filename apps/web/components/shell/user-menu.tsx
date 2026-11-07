"use client";

import { Popover } from "@base-ui/react/popover";
import type { MeResponse } from "@isms/contracts";
import { cn } from "@isms/ui";
import { ChevronsUpDownIcon, LogOutIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRef } from "react";
import type { Theme } from "../../lib/theme";
import { focusRingClass } from "./styles";
import { ThemeToggle } from "./theme-toggle";
import { ViewModeSwitch } from "./view-mode-switch";

export const SIGN_OUT_FORM_ID = "sign-out-form";

/** Only what the shell displays; never tokens or anything else from the session. */
export type ShellUser = Pick<MeResponse, "displayName" | "email">;

function initials(name: string, email: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters = words.length > 0 ? words.slice(0, 2).map((w) => w[0]) : [email[0]];
  return letters.join("").toLocaleUpperCase();
}

export function Avatar({ user, className }: { user: ShellUser; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex size-9 shrink-0 items-center justify-center rounded-full text-[13px] font-bold tracking-wide text-on-accent",
        "bg-[linear-gradient(140deg,color-mix(in_oklab,var(--isms-accent)_70%,var(--isms-info-soft)),var(--isms-accent))]",
        "shadow-[inset_0_1px_0_rgb(255_255_255/0.25)]",
        className,
      )}
    >
      {initials(user.displayName, user.email)}
    </span>
  );
}

type UserMenuProps = {
  user: ShellUser;
  viewMode: MeResponse["viewMode"];
  theme: Theme;
  onThemeChange: (theme: Theme) => void;
};

/**
 * Account popover: who is signed in, view mode, theme and sign-out. Sign-out submits the
 * shell's POST form (`form` attribute), so it is never a link a crawler or image could follow.
 */
export function UserMenu({ user, viewMode, theme, onThemeChange }: UserMenuProps) {
  const t = useTranslations("account");
  // Focus the panel itself on open: its first control has a tooltip, which would otherwise
  // open at once and take the first Escape.
  const popupRef = useRef<HTMLDivElement>(null);
  return (
    <Popover.Root>
      <Popover.Trigger
        className={cn(
          "group flex items-center gap-3 rounded-md p-1.5 text-left text-fg lg:w-full lg:p-2",
          "transition-colors duration-(--motion-fast) ease-standard",
          "hover:bg-[color-mix(in_oklab,transparent,var(--isms-text)_6%)] data-popup-open:bg-[color-mix(in_oklab,transparent,var(--isms-text)_6%)]",
          focusRingClass,
        )}
      >
        <span className="sr-only">{t("trigger")}</span>
        <Avatar user={user} />
        <span className="hidden min-w-0 flex-1 flex-col lg:flex" aria-hidden>
          <span className="truncate text-sm font-semibold">{user.displayName}</span>
          <span className="truncate text-xs text-fg-muted">{user.email}</span>
        </span>
        <ChevronsUpDownIcon aria-hidden className="hidden size-4 text-fg-muted lg:block" />
      </Popover.Trigger>
      <Popover.Portal>
        {/* Fixed, like its trigger (the fixed sidebar or bottom bar): an absolutely positioned
            panel moves with the page on scroll and jumps back a frame later, so a press made
            while the page scrolls (focusing a radio scrolls it) can miss the control. */}
        <Popover.Positioner
          side="top"
          align="start"
          sideOffset={10}
          positionMethod="fixed"
          className="z-50"
        >
          <Popover.Popup
            ref={popupRef}
            initialFocus={popupRef}
            className={cn(
              "w-[min(320px,calc(100vw-2rem))] origin-(--transform-origin) rounded-lg border border-surface-border p-4 font-sans text-sm text-fg shadow-float outline-none",
              "bg-[color-mix(in_oklab,var(--isms-bg)_86%,transparent)] bg-[image:linear-gradient(var(--isms-surface),var(--isms-surface))] backdrop-blur-xl",
              "transition-[opacity,scale] duration-(--motion-base) ease-standard data-ending-style:scale-[0.97] data-ending-style:opacity-0 data-starting-style:scale-[0.97] data-starting-style:opacity-0",
            )}
          >
            <Popover.Title className="sr-only">{t("title")}</Popover.Title>
            <div className="flex items-center gap-3">
              <Avatar user={user} className="size-10" />
              <div className="flex min-w-0 flex-col">
                <span className="truncate font-semibold">{user.displayName}</span>
                <span className="truncate text-xs text-fg-muted">{user.email}</span>
              </div>
            </div>
            <div className="my-4 h-px bg-[color-mix(in_oklab,var(--isms-text)_8%,transparent)]" />
            <div className="flex flex-col gap-4">
              <ViewModeSwitch initial={viewMode} />
              <ThemeToggle value={theme} onChange={onThemeChange} />
            </div>
            <div className="my-4 h-px bg-[color-mix(in_oklab,var(--isms-text)_8%,transparent)]" />
            <button
              type="submit"
              form={SIGN_OUT_FORM_ID}
              className={cn(
                "flex h-10 w-full items-center gap-2.5 rounded-sm px-3 font-semibold text-fg",
                "transition-colors duration-(--motion-fast) ease-standard hover:bg-[color-mix(in_oklab,transparent,var(--isms-text)_6%)]",
                focusRingClass,
              )}
            >
              <LogOutIcon aria-hidden className="size-4 text-fg-muted" />
              {t("signOut")}
            </button>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
