"use client";

import type { ModuleKey } from "@isms/contracts";
import {
  Button,
  buttonVariants,
  cn,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@isms/ui";
import { ArrowRightIcon, CircleAlertIcon, CircleCheckIcon, CircleOffIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { setModule } from "../../lib/actions/setup";
import { settle, signInAgain } from "../risks/risk-call";
import { SwitchRow } from "../settings/switch-row";

type ErrorKey = "forbidden" | "unavailable";

/**
 * One card per optional module: what it is for, who needs it and who doesn't, and a switch.
 * Turning a module on is immediate; turning it off asks first and says the data is kept.
 * Only the EU AI Act exists today; a later module adds its own card here.
 */
export function ModulesForm({ enabled }: { enabled: readonly ModuleKey[] }) {
  const t = useTranslations("aiAct.module");
  const ts = useTranslations("setup.modules");
  const router = useRouter();
  const [on, setOn] = useState(enabled.includes("eu_ai_act"));
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<ErrorKey | null>(null);
  const [announcement, setAnnouncement] = useState("");

  async function change(next: boolean): Promise<void> {
    if (busy) return;
    setBusy(true);
    setError(null);
    const result = await settle(() => setModule("eu_ai_act", next));
    setBusy(false);
    if (result.ok) {
      setOn(result.data.modules.includes("eu_ai_act"));
      setConfirming(false);
      setAnnouncement(next ? t("turnedOn") : t("turnedOff"));
      // The navigation lives in the layout: refresh it so the item appears or goes.
      router.refresh();
    } else if (!signInAgain(result)) {
      setError(result.kind === "forbidden" ? "forbidden" : "unavailable");
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <ul aria-label={ts("listLabel")} className="flex flex-col gap-4">
        <li>
          <article
            aria-labelledby="module-eu-ai-act"
            className="flex flex-col gap-4 rounded-md border border-[color-mix(in_oklab,var(--isms-text)_10%,transparent)] bg-[color-mix(in_oklab,var(--isms-surface),transparent_35%)] p-4 sm:p-5"
          >
            <div className="flex flex-col gap-1.5">
              <h2 id="module-eu-ai-act" className="text-lg font-bold text-fg">
                {t("name")}
              </h2>
              <p className="max-w-[64ch] text-sm leading-relaxed text-fg">{t("purpose")}</p>
            </div>
            <dl className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1">
                <dt className="flex items-center gap-1.5 text-[13px] font-semibold text-fg">
                  <CircleCheckIcon aria-hidden className="size-4 text-ok" />
                  {t("whoNeedsTitle")}
                </dt>
                <dd className="text-[13px] leading-relaxed text-fg-muted">{t("whoNeeds")}</dd>
              </div>
              <div className="flex flex-col gap-1">
                <dt className="flex items-center gap-1.5 text-[13px] font-semibold text-fg">
                  <CircleOffIcon aria-hidden className="size-4 text-fg-muted" />
                  {t("whoDoesntTitle")}
                </dt>
                <dd className="text-[13px] leading-relaxed text-fg-muted">{t("whoDoesnt")}</dd>
              </div>
            </dl>
            <div className="border-t border-[color-mix(in_oklab,var(--isms-text)_8%,transparent)]">
              <SwitchRow
                label={t("switchLabel")}
                hint={t("switchHint")}
                checked={on}
                busy={busy}
                onChange={(next) => {
                  if (next) void change(true);
                  else setConfirming(true);
                }}
              />
            </div>
            {on ? (
              <Link
                href="/ai-act"
                className={cn(buttonVariants({ variant: "secondary", size: "sm" }), "w-fit")}
              >
                {t("open")}
                <ArrowRightIcon aria-hidden />
              </Link>
            ) : null}
          </article>
        </li>
      </ul>
      <p role="status" className="text-sm font-medium text-fg-muted">
        {announcement}
      </p>
      {error && !confirming ? <ErrorNote>{t(`errors.${error}`)}</ErrorNote> : null}
      <Dialog
        open={confirming}
        onOpenChange={(next) => {
          if (busy) return;
          setConfirming(next);
          if (!next) setError(null);
        }}
      >
        <DialogContent closeLabel={t("confirm.cancel")} className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("confirm.title")}</DialogTitle>
            <DialogDescription>{t("confirm.body")}</DialogDescription>
          </DialogHeader>
          <p className="text-sm leading-relaxed text-fg">{t("confirm.kept")}</p>
          {error ? <ErrorNote>{t(`errors.${error}`)}</ErrorNote> : null}
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="ghost" disabled={busy} />}>
              {t("confirm.cancel")}
            </DialogClose>
            <Button
              type="button"
              variant="destructive"
              disabled={busy}
              focusableWhenDisabled
              onClick={() => void change(false)}
            >
              {busy ? t("confirm.working") : t("confirm.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ErrorNote({ children }: { children: string }) {
  return (
    <p
      role="alert"
      className="flex items-start gap-2 rounded-md bg-critical-soft px-3.5 py-3 text-sm font-medium text-critical"
    >
      <CircleAlertIcon aria-hidden className="mt-px size-4 shrink-0" />
      <span>{children}</span>
    </p>
  );
}
