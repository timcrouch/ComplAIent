"use client";

import type { DemoStatusResponse } from "@isms/contracts";
import { Button, cn } from "@isms/ui";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { loadSampleData, resetEverything } from "../../app/(app)/setup/demo-actions";
import { DemoConfirmDialog, type DemoMode } from "./demo-confirm-dialog";
import { glass } from "./styles";

/** The typed confirmation: the organisation name, or RESET when none is set up yet. */
const expectedText = (status: DemoStatusResponse) => status.organisationName ?? "RESET";

/**
 * "Demo and training" at the bottom of Setup. `status` is null when the API has no demo
 * routes (demo mode off), and then nothing is shown.
 */
export function DemoTools({ status }: { status: DemoStatusResponse | null }) {
  const t = useTranslations("setup.demo");
  const [open, setOpen] = useState<DemoMode | null>(null);
  if (!status) return null;

  const actions: { mode: DemoMode; run: (confirm: string) => ReturnType<typeof loadSampleData> }[] =
    [
      { mode: "load", run: loadSampleData },
      { mode: "reset", run: resetEverything },
    ];

  return (
    <section
      aria-labelledby="demo-tools-title"
      className={cn(glass, "mx-auto mt-6 w-full max-w-[1040px] p-5 sm:p-8")}
    >
      <h2 id="demo-tools-title" className="text-lg font-bold text-fg">
        {t("title")}
      </h2>
      <p className="mt-1 text-sm font-semibold text-accent">{t("on")}</p>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        {actions.map(({ mode }) => (
          <div key={mode} className="flex flex-col items-start gap-3">
            <p className="text-sm text-fg-muted">{t(`${mode}.description`)}</p>
            <Button
              type="button"
              // Reset only deletes; opening the load dialog leads to a choice (its confirm is red).
              variant={mode === "reset" ? "destructive" : "secondary"}
              onClick={() => {
                setOpen(mode);
              }}
            >
              {t(`${mode}.button`)}
            </Button>
          </div>
        ))}
      </div>
      {actions.map(({ mode, run }) => (
        <DemoConfirmDialog
          key={mode}
          mode={mode}
          expected={expectedText(status)}
          open={open === mode}
          onOpenChange={(next) => {
            setOpen(next ? mode : null);
          }}
          run={run}
        />
      ))}
    </section>
  );
}
