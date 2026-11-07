"use client";

import type { ControlSummaryDto } from "@isms/contracts";
import { Button, buttonVariants, Field, Input } from "@isms/ui";
import { PlusIcon, SearchIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useRef, useState, type SubmitEvent } from "react";
import { addControl, searchControls } from "../../lib/actions/risks";
import { ProblemText } from "./notices";
import { settle, signInAgain } from "./risk-call";
import { useRisk } from "./risk-context";
import { useControlAction } from "./use-control-action";

const MAX_RESULTS = 8;

/**
 * Search the control library and add a control by hand (it is accepted at once). Works with
 * AI off. Focus stays in the search box after adding, so the next search is one step away.
 */
export function ControlPicker() {
  const t = useTranslations("risks.picker");
  const { risk } = useRisk();
  const { busy, run, notices } = useControlAction();
  const id = useId();
  const searchRef = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState("");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<ControlSummaryDto[] | null>(null);
  const [failed, setFailed] = useState(false);
  // Suggested or accepted already: adding again would be a duplicate.
  const onRisk = new Set(risk.controls.filter((c) => c.status !== "rejected").map((c) => c.code));

  async function search(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (searching || q.trim() === "") return;
    setSearching(true);
    setFailed(false);
    const result = await settle(() => searchControls(q.trim()));
    setSearching(false);
    if (result.ok) {
      setResults(result.data.items.slice(0, MAX_RESULTS));
    } else if (!signInAgain(result)) {
      setResults(null);
      setFailed(true);
    }
  }

  async function add(code: string) {
    const done = await run(
      (version) => addControl(risk.id, version, code),
      () => t("added", { code }),
    );
    if (done) searchRef.current?.focus();
  }

  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-[15px] font-semibold text-fg">{t("title")}</h3>
      <form role="search" onSubmit={(e) => void search(e)} className="flex flex-col gap-2">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <Field id={id} label={t("label")} hint={t("hint")} className="flex-1">
            <Input
              ref={searchRef}
              id={id}
              type="search"
              value={q}
              maxLength={200}
              aria-describedby={`${id}-hint`}
              onChange={(e) => {
                setQ(e.target.value);
              }}
            />
          </Field>
          <Button type="submit" variant="secondary" aria-disabled={searching || undefined}>
            <SearchIcon aria-hidden />
            {searching ? t("searching") : t("search")}
          </Button>
        </div>
      </form>
      <p role="status" className="text-[13px] text-fg-muted">
        {results ? t("found", { count: results.length }) : ""}
      </p>
      {failed ? <ProblemText>{t("failed")}</ProblemText> : null}
      {results && results.length > 0 ? (
        <ul aria-label={t("resultsLabel")} className="flex flex-col gap-2">
          {results.map((c) => (
            <li
              key={c.code}
              className="flex flex-col gap-2 rounded-md border border-surface-border p-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <span className="text-[14px] text-fg">
                <span className="font-semibold tabular-nums">{c.code}</span> {c.title}
              </span>
              {onRisk.has(c.code) ? (
                <span className="text-[13px] font-semibold text-fg-muted">{t("onRisk")}</span>
              ) : (
                <button
                  type="button"
                  aria-disabled={busy || undefined}
                  onClick={() => void add(c.code)}
                  className={buttonVariants({ variant: "secondary", size: "sm" })}
                >
                  <PlusIcon aria-hidden />
                  {t("add")} <span className="sr-only">{c.code}</span>
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : null}
      {notices(() => searchRef.current?.focus())}
    </div>
  );
}
