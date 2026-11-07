"use client";

import { Tooltip } from "@base-ui/react/tooltip";
import type { ViewMode } from "@isms/contracts";
import { focusRingClass } from "./styles";
import { InfoIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useId, useRef, useState } from "react";
import { saveViewMode } from "../../lib/actions/view-mode";
import { Segmented } from "./segmented";

/**
 * Guided / Professional / Executive. The choice shows at once, is saved on the server, and the
 * page is refreshed so server-rendered content follows it. If saving fails the choice reverts
 * and a message says so. It only changes how much detail is shown, never what the user may do.
 */
export function ViewModeSwitch({ initial }: { initial: ViewMode }) {
  const t = useTranslations("viewMode");
  const router = useRouter();
  const [mode, setMode] = useState<ViewMode>(initial);
  const [failed, setFailed] = useState(false);
  const latest = useRef(0);
  const noteId = useId();

  async function choose(next: ViewMode) {
    const previous = mode;
    const attempt = ++latest.current;
    setMode(next);
    setFailed(false);
    const saved = await saveViewMode(next).then(
      (result) => result.ok,
      () => false,
    );
    if (attempt !== latest.current) return; // a newer choice supersedes this one
    if (saved) {
      router.refresh();
    } else {
      setMode(previous);
      setFailed(true);
    }
  }

  return (
    <>
      <Segmented
        legend={t("legend")}
        name="view-mode"
        value={mode}
        onChange={(next) => void choose(next)}
        describedBy={noteId}
        options={[
          { value: "guided", label: t("guided") },
          { value: "professional", label: t("professional") },
          { value: "executive", label: t("executive") },
        ]}
        aside={
          <Tooltip.Root>
            <Tooltip.Trigger
              aria-label={t("about")}
              className={`inline-flex size-5 items-center justify-center rounded-full text-fg-muted hover:text-fg ${focusRingClass}`}
            >
              <InfoIcon aria-hidden className="size-3.5" />
            </Tooltip.Trigger>
            <Tooltip.Portal>
              <Tooltip.Positioner side="top" sideOffset={6} className="z-[60]">
                <Tooltip.Popup className="max-w-60 rounded-sm bg-fg px-2.5 py-1.5 text-xs leading-snug font-medium text-bg shadow-float transition-opacity duration-(--motion-fast) data-ending-style:opacity-0 data-starting-style:opacity-0">
                  {t("aboutText")}
                </Tooltip.Popup>
              </Tooltip.Positioner>
            </Tooltip.Portal>
          </Tooltip.Root>
        }
      />
      <span id={noteId} hidden>
        {t("aboutText")}
      </span>
      <p role="status" className="text-xs text-fg-muted">
        {failed ? t("saveFailed") : null}
      </p>
    </>
  );
}
