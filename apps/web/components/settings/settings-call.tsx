"use client";

import { conflictReasons } from "@isms/contracts";
import { CircleAlertIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import type messages from "../../messages/index";
import { goTo } from "../../lib/navigate";
import type { CallResult } from "../../lib/server-api";

export type SettingsErrorKey = keyof (typeof messages)["settings"]["ai"]["errors"];
type Failure = Exclude<CallResult<unknown>, { ok: true }>;

/** The plain message for a refused settings call; the API's own text is never shown. */
export function settingsFailureMessage(result: Failure): SettingsErrorKey {
  switch (result.kind) {
    case "forbidden":
      return "forbidden";
    case "invalid":
      return result.details.some((d) => d.path.startsWith("models"))
        ? "modelNotOffered"
        : "notAccepted";
    case "conflict": {
      const first = conflictReasons(result.details)[0];
      if (first?.reason === "secretsKeyMissing" || first?.reason === "keyUnreadable") {
        return first.reason;
      }
      if (
        first?.reason === "aiUnavailable" &&
        (first.item === "privacyOff" || first.item === "noKey")
      ) {
        return first.item;
      }
      return "notAccepted";
    }
    case "not-found":
      return "notAccepted";
    default:
      return "unavailable";
  }
}

/**
 * One settings call at a time, with its error. A step-up or ended session goes to sign in (a
 * full page load); `onInvalid` lets a form place a field problem on its field instead.
 */
export function useSettingsCall() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<SettingsErrorKey | null>(null);

  async function run<T>(
    call: () => Promise<CallResult<T>>,
    onInvalid?: (result: Failure) => boolean,
  ): Promise<T | null> {
    setBusy(true);
    setError(null);
    let result: CallResult<T>;
    try {
      result = await call();
    } catch {
      // The server action itself could not be reached (network, deployment in progress).
      result = { ok: false, kind: "unavailable", details: [] };
    } finally {
      setBusy(false);
    }
    if (result.ok) return result.data;
    if (result.kind === "signed-out" || result.kind === "reauth") {
      if (result.href) goTo(result.href);
      return null;
    }
    if (!(result.kind === "invalid" && onInvalid?.(result))) {
      setError(settingsFailureMessage(result));
    }
    return null;
  }

  return { busy, error, run };
}

/** A refused call, in words with an icon. */
export function SettingsError({ error }: { error: SettingsErrorKey | null }) {
  const t = useTranslations("settings.ai.errors");
  if (!error) return null;
  return (
    <p
      role="alert"
      className="flex items-start gap-2 rounded-md bg-critical-soft px-3.5 py-3 text-sm font-medium text-critical"
    >
      <CircleAlertIcon aria-hidden className="mt-px size-4 shrink-0" />
      <span>{t(error)}</span>
    </p>
  );
}
