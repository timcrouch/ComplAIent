"use client";

import { conflictReasons, type AiSystemDetailDto } from "@isms/contracts";
import { Button, cn, Field, Input } from "@isms/ui";
import { LinkIcon, UnlinkIcon } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useId, useRef, useState } from "react";
import { linkAiSystemRisk, unlinkAiSystemRisk } from "../../lib/actions/ai-act";
import { formatDate } from "../../lib/dates";
import { ProblemText } from "../risks/notices";
import { RiskStateBadge } from "../risks/risk-badges";
import { settle, signInAgain, type Failure } from "../risks/risk-call";
import { Section } from "../risks/section";
import { focusRingClass } from "../shell/styles";

const MAX_RESULTS = 8;

/** A risk the viewer may see and could link. */
export type RiskOption = { id: string; reference: string; title: string };

type ErrorKey = "duplicate" | "notFound" | "forbidden" | "unavailable";

function errorOf(result: Failure): ErrorKey {
  if (
    result.kind === "conflict" &&
    conflictReasons(result.details).some((c) => c.reason === "duplicateAiSystemRisk")
  ) {
    return "duplicate";
  }
  if (result.kind === "not-found") return "notFound";
  return result.kind === "forbidden" ? "forbidden" : "unavailable";
}

type Props = {
  system: AiSystemDetailDto;
  /** The viewer holds aiact.manage and risks.read. */
  canLink: boolean;
  /** Risks the viewer may see, to pick from; null when they may not link. */
  options: readonly RiskOption[] | null;
  timeZone: string;
  onChanged: (system: AiSystemDetailDto) => void;
};

/**
 * The register risks linked to this system (only the ones the viewer may see), and for
 * people who may, a picker in the style of the control picker: type, then link.
 */
export function RiskLinksSection({ system, canLink, options, timeZone, onChanged }: Props) {
  const t = useTranslations("aiAct.risks");
  const id = useId();
  const searchRef = useRef<HTMLInputElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ErrorKey | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const linked = new Set(system.risks.map((r) => r.id));
  const query = q.trim().toLowerCase();
  const matches =
    query === ""
      ? []
      : (options ?? [])
          .filter((r) => !linked.has(r.id))
          .filter((r) => `${r.reference} ${r.title}`.toLowerCase().includes(query))
          .slice(0, MAX_RESULTS);

  async function change(run: () => ReturnType<typeof linkAiSystemRisk>, done: string) {
    if (busy) return false;
    setBusy(true);
    setError(null);
    const result = await settle(run);
    setBusy(false);
    if (result.ok) {
      onChanged(result.data);
      setAnnouncement(done);
      return true;
    }
    if (!signInAgain(result)) setError(errorOf(result));
    return false;
  }

  return (
    <Section title={t("title")} intro={t("intro")} headingRef={headingRef}>
      {system.risks.length === 0 ? (
        <p className="text-sm text-fg-muted">{t("none")}</p>
      ) : (
        <ul aria-label={t("title")} className="flex flex-col gap-2">
          {system.risks.map((risk) => (
            <li
              key={risk.id}
              className="flex flex-col gap-2 rounded-md border border-surface-border p-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="flex min-w-0 flex-col gap-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[13px] font-semibold text-fg-muted tabular-nums">
                    {risk.reference}
                  </span>
                  <Link
                    href={`/risks/${risk.id}`}
                    className={cn(
                      "rounded-sm font-semibold break-words text-accent underline-offset-4 hover:underline",
                      focusRingClass,
                    )}
                  >
                    {risk.title}
                  </Link>
                  <RiskStateBadge state={risk.state} />
                </div>
                <p className="text-[13px] text-fg-muted">
                  {t("linkedBy", {
                    name: risk.linkedBy.displayName,
                    date: formatDate(risk.linkedAt, timeZone),
                  })}
                </p>
              </div>
              {canLink ? (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  aria-disabled={busy || undefined}
                  onClick={() =>
                    void change(
                      () => unlinkAiSystemRisk(system.id, risk.id),
                      t("unlinked", { reference: risk.reference }),
                    ).then((ok) => {
                      if (ok) headingRef.current?.focus();
                    })
                  }
                >
                  <UnlinkIcon aria-hidden />
                  {t("unlink")} <span className="sr-only">{risk.reference}</span>
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {canLink && options ? (
        <div className="flex flex-col gap-3">
          <h3 className="text-[15px] font-semibold text-fg">{t("pickerTitle")}</h3>
          <Field id={id} label={t("pickerLabel")} hint={t("pickerHint")}>
            <Input
              ref={searchRef}
              id={id}
              type="search"
              value={q}
              maxLength={200}
              autoComplete="off"
              aria-describedby={`${id}-hint`}
              onValueChange={setQ}
            />
          </Field>
          <p role="status" className="text-[13px] text-fg-muted">
            {query === "" ? "" : t("found", { count: matches.length })}
          </p>
          {matches.length > 0 ? (
            <ul aria-label={t("resultsLabel")} className="flex flex-col gap-2">
              {matches.map((r) => (
                <li
                  key={r.id}
                  className="flex flex-col gap-2 rounded-md border border-surface-border p-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <span className="text-[14px] text-fg">
                    <span className="font-semibold tabular-nums">{r.reference}</span> {r.title}
                  </span>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    aria-disabled={busy || undefined}
                    onClick={() =>
                      void change(
                        () => linkAiSystemRisk(system.id, r.id),
                        t("linked", { reference: r.reference }),
                      ).then((ok) => {
                        if (ok) searchRef.current?.focus();
                      })
                    }
                  >
                    <LinkIcon aria-hidden />
                    {t("link")} <span className="sr-only">{r.reference}</span>
                  </Button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
      <p role="status" className="sr-only">
        {announcement}
      </p>
      {error ? (
        <div role="alert">
          <ProblemText>{t(`errors.${error}`)}</ProblemText>
        </div>
      ) : null}
    </Section>
  );
}
