"use client";

import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { CornerDownLeftIcon, SearchIcon } from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import { cn } from "../lib/cn";
import { DialogOverlay } from "./dialog";

interface CommandItem {
  id: string;
  label: string;
  onSelect: () => void;
}

interface CommandPaletteLabels {
  title: string;
  placeholder: string;
  empty: string;
  results: (count: number) => string;
  navigate: string;
  select: string;
  close: string;
  /** Visible name of the Escape key in the footer hint. */
  escapeKey: string;
}

/** English defaults; the web app passes translated labels. */
const defaultLabels: CommandPaletteLabels = {
  title: "Command palette",
  placeholder: "Search or jump to…",
  empty: "No matches",
  results: (count) => (count === 1 ? "1 result" : `${String(count)} results`),
  navigate: "Navigate",
  select: "Select",
  close: "Close",
  escapeKey: "Esc",
};

interface CommandPaletteProps {
  items: readonly CommandItem[];
  labels?: Partial<CommandPaletteLabels>;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  modal?: boolean;
  /** Where to portal the palette; defaults to document.body. */
  container?: DialogPrimitive.Portal.Props["container"];
  /** Extra classes for the floating panel (e.g. to reposition it). */
  className?: string;
}

function isPaletteShortcut(event: globalThis.KeyboardEvent): boolean {
  return (
    (event.metaKey || event.ctrlKey) &&
    !event.altKey &&
    !event.shiftKey &&
    event.key.toLowerCase() === "k"
  );
}

function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded-[5px] border border-surface-border bg-surface px-1 font-sans text-[11px] font-semibold text-fg-muted shadow-glass">
      {children}
    </kbd>
  );
}

/**
 * ⌘K / Ctrl+K command palette. Focus stays in the search field (combobox);
 * the active option is exposed with aria-activedescendant and the number of
 * results is announced through a polite live region.
 */
function CommandPalette({
  items,
  labels: labelOverrides,
  open,
  defaultOpen = false,
  onOpenChange,
  modal = true,
  container,
  className,
}: CommandPaletteProps) {
  const labels = { ...defaultLabels, ...labelOverrides };
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen);
  const isOpen = open ?? uncontrolledOpen;
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listboxId = useId();

  const setOpen = useCallback(
    (next: boolean) => {
      if (open === undefined) setUncontrolledOpen(next);
      if (next) {
        setQuery("");
        setActiveIndex(0);
      }
      onOpenChange?.(next);
    },
    [open, onOpenChange],
  );

  useEffect(() => {
    function onKeyDown(event: globalThis.KeyboardEvent) {
      if (event.defaultPrevented || !isPaletteShortcut(event)) return;
      event.preventDefault();
      setOpen(!isOpen);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [isOpen, setOpen]);

  const results = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return needle ? items.filter((i) => i.label.toLocaleLowerCase().includes(needle)) : items;
  }, [items, query]);

  const active = results.length === 0 ? -1 : Math.min(activeIndex, results.length - 1);
  const optionId = (item: CommandItem) => `${listboxId}-${item.id}`;
  const activeItem = active >= 0 ? results[active] : undefined;
  const activeId = activeItem ? optionId(activeItem) : undefined;

  useEffect(() => {
    const option = activeId ? document.getElementById(activeId) : null;
    // `in` guard: some environments (e.g. jsdom) do not implement scrollIntoView.
    if (option && "scrollIntoView" in option) option.scrollIntoView({ block: "nearest" });
  }, [activeId]);

  function choose(item: CommandItem) {
    setOpen(false);
    item.onSelect();
  }

  function onInputKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    const count = results.length;
    const moves: Record<string, () => number> = {
      ArrowDown: () => (active + 1) % count,
      ArrowUp: () => (active - 1 + count) % count,
    };
    const move = moves[event.key];
    if (move && count > 0) {
      event.preventDefault();
      setActiveIndex(move());
    } else if (event.key === "Enter" && !event.nativeEvent.isComposing && activeItem) {
      event.preventDefault();
      choose(activeItem);
    }
  }

  return (
    <DialogPrimitive.Root open={isOpen} onOpenChange={setOpen} modal={modal}>
      <DialogPrimitive.Portal container={container}>
        <DialogOverlay />
        <DialogPrimitive.Popup
          data-slot="command-palette"
          initialFocus={inputRef}
          className={cn(
            "fixed top-[14vh] left-1/2 z-50 flex w-[min(640px,calc(100%-2rem))] -translate-x-1/2 flex-col overflow-hidden",
            "rounded-lg border border-surface-border font-sans text-sm text-fg shadow-float outline-none",
            // Small floating layer: the one place backdrop blur is allowed.
            "bg-[color-mix(in_oklab,var(--isms-bg)_86%,transparent)] bg-[image:linear-gradient(var(--isms-surface),var(--isms-surface))] backdrop-blur-xl",
            "transition-[opacity,scale] duration-(--motion-base) ease-standard data-ending-style:scale-[0.98] data-ending-style:opacity-0 data-starting-style:scale-[0.98] data-starting-style:opacity-0",
            className,
          )}
        >
          <DialogPrimitive.Title className="sr-only">{labels.title}</DialogPrimitive.Title>
          <div className="flex items-center gap-3 border-b border-[color-mix(in_oklab,var(--isms-text)_8%,transparent)] px-4">
            <SearchIcon aria-hidden="true" className="size-[18px] shrink-0 text-fg-muted" />
            <input
              ref={inputRef}
              type="text"
              role="combobox"
              aria-label={labels.title}
              aria-expanded={results.length > 0}
              aria-controls={listboxId}
              aria-autocomplete="list"
              aria-activedescendant={activeId}
              autoComplete="off"
              spellCheck={false}
              placeholder={labels.placeholder}
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setActiveIndex(0);
              }}
              onKeyDown={onInputKeyDown}
              className="h-14 w-full bg-transparent text-[15px] text-fg outline-none placeholder:text-fg-muted"
            />
          </div>

          <ul
            id={listboxId}
            role="listbox"
            aria-label={labels.title}
            className={cn("max-h-80 overflow-y-auto p-2", results.length === 0 && "hidden")}
          >
            {results.map((item, index) => {
              const selected = index === active;
              return (
                <li
                  key={item.id}
                  id={optionId(item)}
                  role="option"
                  aria-selected={selected}
                  onMouseMove={() => {
                    setActiveIndex(index);
                  }}
                  onClick={() => {
                    choose(item);
                  }}
                  className={cn(
                    "flex h-10 cursor-pointer items-center gap-3 rounded-sm px-3 font-medium text-fg",
                    "transition-colors duration-(--motion-fast) ease-standard",
                    selected && "bg-accent-soft text-accent",
                  )}
                >
                  <span className="truncate">{item.label}</span>
                  {selected && (
                    <CornerDownLeftIcon aria-hidden="true" className="ml-auto size-4 shrink-0" />
                  )}
                </li>
              );
            })}
          </ul>

          {results.length === 0 && (
            <p aria-hidden="true" className="px-4 py-10 text-center text-fg-muted">
              {labels.empty}
            </p>
          )}

          <div
            aria-hidden="true"
            className="flex items-center gap-4 border-t border-[color-mix(in_oklab,var(--isms-text)_8%,transparent)] px-4 py-2.5 text-xs text-fg-muted"
          >
            <span className="inline-flex items-center gap-1.5">
              <Kbd>↑</Kbd>
              <Kbd>↓</Kbd>
              {labels.navigate}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Kbd>↵</Kbd>
              {labels.select}
            </span>
            <span className="ml-auto inline-flex items-center gap-1.5">
              <Kbd>{labels.escapeKey}</Kbd>
              {labels.close}
            </span>
          </div>

          <div role="status" aria-live="polite" className="sr-only">
            {results.length === 0 ? labels.empty : labels.results(results.length)}
          </div>
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export { CommandPalette };
export type { CommandItem, CommandPaletteLabels, CommandPaletteProps };
