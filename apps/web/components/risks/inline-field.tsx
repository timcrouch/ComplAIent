"use client";

import type { RiskChanges } from "@isms/contracts";
import { buttonVariants, cn, DetailItem, Field, fieldA11y } from "@isms/ui";
import { PencilIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type SubmitEvent,
} from "react";
import { updateRisk } from "../../lib/actions/risks";
import { ErrorText, StaleNotice, useErrorText } from "./notices";
import type { RiskErrorKey } from "./risk-call";
import { useRisk } from "./risk-context";

export type EditorProps<T> = {
  /** The control's id (single control), or a prefix for a group's controls. */
  id: string;
  draft: T;
  setDraft: (next: T) => void;
  /** Links a single control to the field's error; empty for groups. */
  a11y: ReturnType<typeof fieldA11y>;
};

type InlineFieldProps<T> = {
  label: string;
  value: T;
  /** The read view of the stored value; null or blank text shows `empty` instead. */
  display: ReactNode;
  /** System text for a missing value ("Not given yet"), shown muted and italic. */
  empty?: string;
  /** `short` (names, sites, choices) or `long` free text; see DetailItem. */
  emphasis?: "short" | "long";
  /** The edit to send for a draft; null when the viewer may not edit this field. */
  toChanges: ((draft: T) => RiskChanges) | null;
  editor: (props: EditorProps<T>) => ReactNode;
  /** Several controls (selects, radios): labelled as a group instead of one `<label>`. */
  group?: "group" | "radiogroup";
  hint?: string;
};

/** The chosen radio, else the first control. */
function firstControl(form: HTMLFormElement | null): HTMLElement | null {
  return (
    form?.querySelector<HTMLElement>("input[type=radio]:checked") ??
    form?.querySelector<HTMLElement>("input, select, textarea") ??
    null
  );
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * One field of the risk with edit, save and cancel, as a `DetailItem` (render it inside a
 * `DetailList`): the edit button sits beside the value and the form opens in place. Saving sends
 * the version the editor opened at; when someone else saved first it offers a reload. Focus goes into the editor when it opens and
 * back to the field's edit button when it closes, so it never falls to the page.
 */
export function InlineField<T>(props: InlineFieldProps<T>) {
  const { label, value, display, empty, emphasis, toChanges, editor, group, hint } = props;
  const t = useTranslations("risks.inline");
  const errorText = useErrorText();
  const { risk, change, reload, baseVersion } = useRisk();
  const id = useId();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<RiskErrorKey | null>(null);
  const [stale, setStale] = useState(false);
  const editRef = useRef<HTMLButtonElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const restoreFocus = useRef(false);
  // The version this editor's draft started from. It follows this page's own saves, but not a
  // background refresh: someone else's change must still come back as 409 staleVersion.
  const openedAt = useRef(risk.version);

  useEffect(() => {
    if (editing) {
      firstControl(formRef.current)?.focus();
    } else if (restoreFocus.current) {
      restoreFocus.current = false;
      editRef.current?.focus();
    }
  }, [editing]);

  function open() {
    openedAt.current = risk.version;
    setDraft(value);
    setError(null);
    setStale(false);
    setEditing(true);
  }

  function close() {
    restoreFocus.current = true;
    setEditing(false);
    setError(null);
    setStale(false);
  }

  async function save(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || !toChanges) return;
    if (same(draft, value)) {
      close();
      return;
    }
    setSaving(true);
    setError(null);
    const outcome = await change(
      (version) => updateRisk(risk.id, version, toChanges(draft)),
      () => t("saved", { field: label }),
      baseVersion(openedAt.current),
    );
    setSaving(false);
    if (outcome.ok) close();
    else if (outcome.stale) setStale(true);
    else setError(outcome.error);
  }

  async function reloadAndClose(): Promise<boolean> {
    const reloaded = await reload();
    if (reloaded) close();
    return reloaded;
  }

  function onKeyDown(event: KeyboardEvent<HTMLFormElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
    }
  }

  if (!editing) {
    return (
      <DetailItem
        label={label}
        emphasis={emphasis}
        empty={empty}
        action={
          toChanges ? (
            <button
              ref={editRef}
              type="button"
              onClick={open}
              className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "shrink-0")}
            >
              <PencilIcon aria-hidden />
              {t("edit")} <span className="sr-only">{label}</span>
            </button>
          ) : null
        }
      >
        {display}
      </DetailItem>
    );
  }

  const errorId = `${id}-error`;
  const form = (
    <form
      ref={formRef}
      noValidate
      onSubmit={(e) => void save(e)}
      onKeyDown={onKeyDown}
      className="flex flex-col gap-3 rounded-md bg-[color-mix(in_oklab,var(--isms-accent)_5%,transparent)] p-3"
    >
      {group ? (
        <div
          role={group}
          aria-labelledby={`${id}-label`}
          aria-describedby={error ? errorId : undefined}
          className="flex flex-col gap-2"
        >
          <p id={`${id}-label`} className="text-sm font-semibold text-fg">
            {label}
          </p>
          {editor({ id, draft, setDraft, a11y: {} })}
          {error ? <ErrorText id={errorId} error={error} /> : null}
        </div>
      ) : (
        <Field id={id} label={label} hint={hint} error={error ? errorText(error) : undefined}>
          {editor({ id, draft, setDraft, a11y: fieldA11y(id, { hint, error }) })}
        </Field>
      )}
      {stale ? <StaleNotice onReload={reloadAndClose} /> : null}
      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          aria-disabled={saving || undefined}
          className={buttonVariants({ size: "sm" })}
        >
          {saving ? t("saving") : t("save")}
        </button>
        <button
          type="button"
          onClick={close}
          className={buttonVariants({ variant: "secondary", size: "sm" })}
        >
          {t("cancel")}
        </button>
      </div>
    </form>
  );
  return <DetailItem label={label} editor={form} />;
}
