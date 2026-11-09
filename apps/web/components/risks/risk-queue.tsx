"use client";

import type { RiskListFilter, RiskListResponse, RiskSummaryDto } from "@isms/contracts";
import { Button, cn } from "@isms/ui";
import { MapPinIcon, UserRoundIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { listRisks, type RiskListCell } from "../../lib/actions/risks";
import { formatDate } from "../../lib/dates";
import { PendingLink } from "../navigation/pending-link";
import { glass } from "../setup/styles";
import { focusRingClass } from "../shell/styles";
import { ProblemText } from "./notices";
import { RiskStateBadge, ScoreBadges } from "./risk-badges";
import { settle, signInAgain } from "./risk-call";

function RiskRow({ risk, timeZone }: { risk: RiskSummaryDto; timeZone: string }) {
  const t = useTranslations("risks.queue");
  return (
    <li className={cn(glass, "flex flex-col gap-3 rounded-md p-4 sm:p-5")}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[12px] font-semibold text-fg-muted tabular-nums">
          {risk.reference}
        </span>
        <RiskStateBadge state={risk.state} />
      </div>
      <PendingLink
        href={`/risks/${risk.id}`}
        data-risk-link={risk.id}
        pendingLabel={t("opening", { risk: risk.title })}
        pendingClassName="text-accent underline"
        className={cn(
          "inline-flex w-fit items-center gap-2 rounded-sm text-[16px] font-semibold break-words text-fg underline-offset-4 hover:text-accent hover:underline",
          focusRingClass,
        )}
      >
        {risk.title}
      </PendingLink>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px] text-fg-muted">
        <ScoreBadges score={risk.score} aboveAppetite={risk.aboveAppetite} />
        <span className="inline-flex items-center gap-1.5">
          <UserRoundIcon aria-hidden className="size-4" />
          {risk.owner ? t("owner", { name: risk.owner.displayName }) : t("noOwner")}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <MapPinIcon aria-hidden className="size-4" />
          {risk.siteName ? t("site", { name: risk.siteName }) : t("noSite")}
        </span>
        <span>{t("updated", { date: formatDate(risk.updatedAt, timeZone) })}</span>
      </div>
    </li>
  );
}

type RiskQueueProps = {
  filter: RiskListFilter;
  initial: RiskListResponse;
  timeZone: string;
  /** Narrows the list to one map cell; carried when paging. */
  cell?: RiskListCell | undefined;
};

/**
 * One filter's risks with "Load more" by cursor. Loading more announces how many came and
 * moves focus to the first new risk, so keyboard users continue where the list grew.
 */
export function RiskQueue({ filter, initial, timeZone, cell }: RiskQueueProps) {
  const t = useTranslations("risks.queue");
  const [items, setItems] = useState(initial.items);
  const [cursor, setCursor] = useState(initial.nextCursor);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [message, setMessage] = useState("");
  const [focusId, setFocusId] = useState<string | null>(null);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    if (!focusId) return;
    listRef.current
      ?.querySelector<HTMLElement>(`[data-risk-link="${CSS.escape(focusId)}"]`)
      ?.focus();
  }, [focusId]);

  async function loadMore() {
    if (busy || !cursor) return;
    setBusy(true);
    setFailed(false);
    const result = await settle(() =>
      cell ? listRisks(filter, cursor, cell) : listRisks(filter, cursor),
    );
    setBusy(false);
    if (!result.ok) {
      if (!signInAgain(result)) setFailed(true);
      return;
    }
    const known = new Set(items.map((i) => i.id));
    const added = result.data.items.filter((i) => !known.has(i.id));
    setItems([...items, ...added]);
    setCursor(result.data.nextCursor);
    setMessage(t("loaded", { count: added.length }));
    setFocusId(added[0]?.id ?? items.at(-1)?.id ?? null);
  }

  if (items.length === 0) {
    return (
      <div className={cn(glass, "p-6 sm:p-8")}>
        <p className="text-[15px] leading-relaxed text-fg">{t("empty")}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <ul ref={listRef} aria-label={t("listLabel")} className="flex flex-col gap-3">
        {items.map((risk) => (
          <RiskRow key={risk.id} risk={risk} timeZone={timeZone} />
        ))}
      </ul>
      <p role="status" className="sr-only">
        {message}
      </p>
      {failed ? <ProblemText>{t("loadFailed")}</ProblemText> : null}
      {cursor ? (
        <Button
          type="button"
          variant="secondary"
          className="self-start"
          aria-disabled={busy || undefined}
          onClick={() => void loadMore()}
        >
          {busy ? t("loading") : t("loadMore")}
        </Button>
      ) : null}
    </div>
  );
}
