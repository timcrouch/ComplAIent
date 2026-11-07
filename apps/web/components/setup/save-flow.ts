"use client";

import { useState } from "react";
import type messages from "../../messages/index";
import { goTo } from "../../lib/navigate";
import type { CallResult } from "../../lib/server-api";

export type SetupErrorKey = keyof (typeof messages)["setup"]["errors"];
export type FormErrorKey = Extract<
  SetupErrorKey,
  "summary" | "notAccepted" | "unavailable" | "forbidden"
>;
export type SaveStatus = "idle" | "saving" | "saved";

/**
 * The save cycle the setup forms share: pending and saved states for the live region, and
 * the failures that are not about a field. An ended session or a step-up goes to sign-in
 * (a full page load, since sign-in leaves the app) instead of showing a generic error.
 * Field problems (`invalid`, `conflict`) are returned to the form to place on its fields.
 */
export function useSaveFlow() {
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [formError, setFormError] = useState<FormErrorKey | null>(null);

  async function run<T>(save: () => Promise<CallResult<T>>): Promise<CallResult<T>> {
    setStatus("saving");
    setFormError(null);
    let result: CallResult<T>;
    try {
      result = await save();
    } catch {
      // The server action itself could not be reached (network, deployment in progress).
      result = { ok: false, kind: "unavailable", details: [] };
    }
    if (result.ok) {
      setStatus("saved");
      return result;
    }
    setStatus("idle");
    if ((result.kind === "signed-out" || result.kind === "reauth") && result.href) {
      goTo(result.href);
    } else if (result.kind === "forbidden") {
      setFormError("forbidden");
    } else if (result.kind !== "invalid" && result.kind !== "conflict") {
      setFormError("unavailable");
    }
    return result;
  }

  return { status, busy: status !== "idle", formError, setFormError, run };
}

/** Focuses the first control marked invalid inside `form`, after React has rendered. */
export function focusFirstInvalid(form: HTMLFormElement | null): void {
  requestAnimationFrame(() => {
    form?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  });
}
