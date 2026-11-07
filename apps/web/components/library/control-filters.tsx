"use client";

import type { ControlListQuery, FrameworkVersionDto } from "@isms/contracts";
import { Button, cn, Input } from "@isms/ui";
import { SearchIcon } from "lucide-react";
import Form from "next/form";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  useEffect,
  useId,
  useOptimistic,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import { libraryHref, type LibraryFilter } from "../../lib/library-url";
import { glass } from "../setup/styles";
import { FilterBar } from "./filter-bar";

type ControlFiltersProps = {
  frameworks: readonly FrameworkVersionDto[];
  /** The view the list currently shows (from the URL, the single source of truth). */
  query: Partial<ControlListQuery>;
  /** The list. It stays in place, dimmed, until the next one arrives. */
  children?: ReactNode;
};

/** How long typing has to pause before the search applies. */
export const SEARCH_PAUSE_MS = 300;

const labelClass = "text-[13px] font-semibold text-fg";

/**
 * The library search and the page filters, kept in the URL so every view can be shared.
 *
 * A filter applies as soon as it changes: a client navigation (a new history entry, so Back
 * steps between filter states) that keeps the search. The search narrows within the filters;
 * it applies on Enter or "Search", and after a short pause in typing (replacing the history
 * entry, so keystrokes don't pile up). Navigations run in a transition, so the old list stays,
 * dimmed, until the new one arrives, and focus stays on the control in use.
 *
 * Without JavaScript it is one GET form: the selects in the filter bar belong to it through
 * their `form` attribute, and "Search" submits the search and every filter together.
 */
export function ControlFilters({ frameworks, query, children }: ControlFiltersProps) {
  const t = useTranslations("library");
  const router = useRouter();
  const id = useId();
  const formId = `${id}-search`;
  const field = (name: string) => `${id}-${name}`;
  const [pending, startTransition] = useTransition();
  // What the user last chose, shown at once while the URL catches up.
  const [shown, setShown] = useOptimistic(query);
  const urlQ = query.q ?? "";
  const [text, setText] = useState(urlQ);
  // The search this component last sent, and the one it last saw in the URL: a URL change
  // from outside (Back, a link) replaces the text; the echo of our own navigation doesn't.
  const [sent, setSent] = useState(urlQ);
  const [seen, setSeen] = useState(urlQ);
  if (urlQ !== seen) {
    setSeen(urlQ);
    if (urlQ !== sent) {
      setText(urlQ);
      setSent(urlQ);
    }
  }
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(
    () => () => {
      clearTimeout(timer.current);
    },
    [],
  );

  const go = (next: Partial<ControlListQuery>, mode: "push" | "replace") => {
    clearTimeout(timer.current);
    setSent(next.q?.trim() ?? "");
    startTransition(() => {
      setShown(next);
      router[mode](libraryHref(next), { scroll: false });
    });
  };
  const focus = (filter: LibraryFilter) => {
    document.getElementById(field(filter))?.focus();
  };

  return (
    <div className="flex flex-col gap-6">
      <Form
        id={formId}
        action="/library"
        role="search"
        aria-labelledby={`${field("q")}-label`}
        onSubmit={(e) => {
          e.preventDefault();
          const next = { ...shown, q: text };
          // The search the list already shows (the pause in typing applied it): no new entry.
          if (libraryHref(next) === libraryHref(query)) {
            clearTimeout(timer.current);
            return;
          }
          go(next, "push");
        }}
        className={cn(glass, "flex flex-col gap-1.5 p-4 sm:p-5")}
      >
        <label id={`${field("q")}-label`} htmlFor={field("q")} className={labelClass}>
          {t("searchLabel")}
        </label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="relative flex-1">
            <SearchIcon
              aria-hidden
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-muted"
            />
            <Input
              id={field("q")}
              type="search"
              name="q"
              maxLength={200}
              value={text}
              onChange={(e) => {
                const value = e.target.value;
                setText(value);
                clearTimeout(timer.current);
                timer.current = setTimeout(() => {
                  if (value.trim() !== (shown.q ?? "")) go({ ...shown, q: value }, "replace");
                }, SEARCH_PAUSE_MS);
              }}
              aria-describedby={`${field("q")}-hint`}
              className="pl-9"
            />
          </div>
          <Button type="submit" className="sm:w-32">
            {t("search")}
          </Button>
        </div>
        <p id={`${field("q")}-hint`} className="text-[13px] leading-snug text-fg-muted">
          {t("searchHint")}
        </p>
      </Form>
      <div className="flex flex-col gap-4">
        <FilterBar
          frameworks={frameworks}
          query={{ ...shown, q: text }}
          formId={formId}
          fieldId={field}
          onChange={(filter, value) => {
            // Always a new entry: Next drops a navigation still loading when the next one
            // starts, so quick changes (arrowing through a closed select) never pile up.
            go({ ...shown, q: text, [filter]: value || undefined }, "push");
          }}
          onRemove={(filter) => {
            go({ ...shown, q: text, [filter]: undefined }, "push");
            focus(filter);
          }}
          onClear={() => {
            go({ q: text }, "push");
            focus("framework");
          }}
        />
        <div
          aria-busy={pending || undefined}
          className={cn(
            "transition-opacity duration-(--motion-fast) ease-standard",
            pending && "opacity-60",
          )}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
