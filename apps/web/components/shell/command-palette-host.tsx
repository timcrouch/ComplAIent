"use client";

import { CommandPalette, type CommandItem } from "@isms/ui";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useMemo } from "react";
import { SIGN_OUT_FORM_ID } from "./user-menu";

type CommandPaletteHostProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSwitchTheme: () => void;
  /** The viewer may manage the organisation, so setup is offered. */
  canSetUp: boolean;
  /** The viewer may read the control library. */
  canBrowseLibrary: boolean;
  /** The viewer may report a concern. */
  canReport: boolean;
};

/** The ⌘K / Ctrl+K palette with the shell's commands; every label comes from en.json. */
export function CommandPaletteHost({
  open,
  onOpenChange,
  onSwitchTheme,
  canSetUp,
  canBrowseLibrary,
  canReport,
}: CommandPaletteHostProps) {
  const t = useTranslations("palette");
  const router = useRouter();

  const items = useMemo<CommandItem[]>(
    () => [
      {
        id: "go-home",
        label: t("goHome"),
        onSelect: () => {
          router.push("/");
        },
      },
      ...(canReport
        ? [
            {
              id: "report",
              label: t("report"),
              onSelect: () => {
                router.push("/report");
              },
            },
          ]
        : []),
      ...(canBrowseLibrary
        ? [
            {
              id: "go-library",
              label: t("goLibrary"),
              onSelect: () => {
                router.push("/library");
              },
            },
          ]
        : []),
      ...(canSetUp
        ? [
            {
              id: "set-up",
              label: t("setUp"),
              onSelect: () => {
                router.push("/setup");
              },
            },
          ]
        : []),
      { id: "switch-theme", label: t("switchTheme"), onSelect: onSwitchTheme },
      {
        id: "sign-out",
        label: t("signOut"),
        onSelect: () => {
          const form = document.getElementById(SIGN_OUT_FORM_ID);
          if (form instanceof HTMLFormElement) form.requestSubmit();
        },
      },
    ],
    [t, router, onSwitchTheme, canSetUp, canBrowseLibrary, canReport],
  );

  return (
    <CommandPalette
      items={items}
      open={open}
      onOpenChange={onOpenChange}
      labels={{
        title: t("title"),
        placeholder: t("placeholder"),
        empty: t("empty"),
        results: (count) => t("results", { count }),
        navigate: t("navigate"),
        select: t("select"),
        close: t("close"),
        escapeKey: t("escapeKey"),
      }}
    />
  );
}
