"use client";

import { Tooltip } from "@base-ui/react/tooltip";
import type { MeResponse, Permission } from "@isms/contracts";
import { buttonVariants, cn } from "@isms/ui";
import { MessageSquareWarningIcon, SearchIcon } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Theme } from "../../lib/theme";
import { BrandMark, BrandWordmark } from "./brand";
import { CommandPaletteHost } from "./command-palette-host";
import { navItemsFor } from "./nav-items";
import { PrimaryNav } from "./primary-nav";
import { focusRingClass } from "./styles";
import { applyTheme, oppositeTheme } from "./theme-toggle";
import { SIGN_OUT_FORM_ID, UserMenu, type ShellUser } from "./user-menu";

type AppShellProps = {
  user: ShellUser;
  viewMode: MeResponse["viewMode"];
  theme: Theme;
  /** The viewer's permissions, only to choose which navigation items to show. */
  permissions: readonly Permission[];
  children: ReactNode;
};

/**
 * True once hydrated. Platform-specific markup (⌘K on Apple devices, Ctrl K elsewhere) waits
 * for it, so server and client render the same HTML; `<main data-ready>` exposes it to tests.
 */
function useHydrated(): boolean {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    setHydrated(true);
  }, []);
  return hydrated;
}

const isApple = (): boolean => /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

/**
 * ⌘⇧R / Ctrl+Shift+R: "Report a concern" from anywhere, for people who may report. On /report
 * itself it does nothing, so a half-written report is never replaced by a fresh one.
 */
function useReportShortcut(enabled: boolean): void {
  const router = useRouter();
  const onReport = usePathname().startsWith("/report");
  useEffect(() => {
    if (!enabled || onReport) return;
    function onKeyDown(event: KeyboardEvent) {
      if (
        !event.defaultPrevented &&
        !event.repeat &&
        (event.metaKey || event.ctrlKey) &&
        event.shiftKey &&
        !event.altKey &&
        (event.code === "KeyR" || event.key.toLowerCase() === "r")
      ) {
        event.preventDefault();
        router.push("/report");
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [enabled, onReport, router]);
}

export function AppShell({
  user,
  viewMode,
  theme: initialTheme,
  permissions,
  children,
}: AppShellProps) {
  const t = useTranslations();
  const navItems = useMemo(() => navItemsFor(permissions), [permissions]);
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const hydrated = useHydrated();
  const canReport = permissions.includes("risks.report");
  useReportShortcut(canReport);

  const changeTheme = useCallback((next: Theme) => {
    applyTheme(next);
    setTheme(next);
  }, []);
  const switchTheme = useCallback(() => {
    changeTheme(oppositeTheme());
  }, [changeTheme]);

  return (
    <Tooltip.Provider delay={300}>
      <a
        href="#main"
        className={cn(
          "fixed top-3 left-3 z-[70] -translate-y-20 rounded-sm bg-accent px-4 py-2 text-sm font-semibold text-on-accent shadow-float focus-visible:translate-y-0",
          focusRingClass,
        )}
      >
        {t("app.skipToContent")}
      </a>

      <PrimaryNav
        items={navItems}
        account={
          <UserMenu user={user} viewMode={viewMode} theme={theme} onThemeChange={changeTheme} />
        }
      />

      <div className="flex min-h-dvh flex-col lg:pl-[264px]">
        <header className="flex items-center gap-3 px-5 pt-5 sm:px-8 lg:px-12 lg:pt-6">
          <div className="flex items-center gap-2.5 lg:hidden">
            <BrandMark />
            <BrandWordmark name={t("app.name")} />
          </div>
          <button
            type="button"
            onClick={() => {
              setPaletteOpen(true);
            }}
            className={cn(
              "ml-auto flex h-10 items-center gap-2.5 rounded-full border border-surface-border bg-surface px-3 text-sm text-fg-muted shadow-glass sm:w-72 sm:pr-2 sm:pl-4",
              "transition-[color,box-shadow] duration-(--motion-fast) ease-standard hover:text-fg",
              focusRingClass,
            )}
          >
            <SearchIcon aria-hidden className="size-4 shrink-0" />
            <span className="sr-only sm:not-sr-only sm:flex-1 sm:text-left">
              {t("search.button")}
            </span>
            <kbd
              aria-hidden
              className="hidden h-6 items-center rounded-[6px] border border-surface-border bg-bg px-1.5 font-sans text-[11px] font-semibold text-fg-muted sm:inline-flex"
            >
              {hydrated && isApple() ? t("search.shortcutMac") : t("search.shortcutOther")}
            </kbd>
          </button>
          {canReport ? (
            <Link
              href="/report"
              aria-keyshortcuts="Meta+Shift+R Control+Shift+R"
              className={cn(buttonVariants({ variant: "primary" }), "rounded-full px-3 sm:px-4")}
            >
              <MessageSquareWarningIcon aria-hidden />
              <span className="sr-only sm:not-sr-only">{t("reportButton.label")}</span>
              <kbd
                aria-hidden
                className="hidden h-6 items-center rounded-[6px] bg-[rgb(255_255_255/0.16)] px-1.5 font-sans text-[11px] font-semibold xl:inline-flex"
              >
                {hydrated && isApple()
                  ? t("reportButton.shortcutMac")
                  : t("reportButton.shortcutOther")}
              </kbd>
            </Link>
          ) : null}
        </header>

        <main
          id="main"
          tabIndex={-1}
          data-ready={hydrated ? "" : undefined}
          className="flex-1 px-5 pt-8 pb-32 outline-none sm:px-8 lg:px-12 lg:pt-10 lg:pb-16"
        >
          {children}
        </main>
      </div>

      <form id={SIGN_OUT_FORM_ID} method="post" action="/auth/logout" hidden />
      <CommandPaletteHost
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        onSwitchTheme={switchTheme}
        canSetUp={permissions.includes("organisation.manage")}
        canBrowseLibrary={permissions.includes("library.read")}
        canReport={canReport}
      />
    </Tooltip.Provider>
  );
}
