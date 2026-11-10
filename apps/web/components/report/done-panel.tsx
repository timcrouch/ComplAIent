"use client";

import { Button, buttonVariants } from "@isms/ui";
import { ArrowRightIcon, CircleCheckIcon } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import type { MeResponse } from "@isms/contracts";
import { useEffect, useId, useRef, useState } from "react";
import { getConcernReward } from "../../lib/actions/report";
import { announceConcernRank, rankOrder, type ConcernRank } from "../rewards/concern-rank-event";
import { RankPromotion } from "./rank-promotion";
import { SignalAcknowledgement } from "./signal-acknowledgement";

const POLL_INTERVAL_MS = 1_500;
const MAX_POLLS = 20;
const useful = new Set(["confirmed", "plausible", "confirmed_duplicate"]);

/** The report is in: its reference, and the way to follow it. The heading takes focus. */
export function DonePanel({
  riskId,
  reference,
  rewardsEnabled,
  aiAvailable,
  initialRank,
  onAnother,
}: {
  riskId: string;
  reference: string;
  rewardsEnabled: boolean;
  aiAvailable: boolean;
  initialRank: MeResponse["concernRank"];
  onAnother: () => void;
}) {
  const t = useTranslations("report.done");
  const id = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const [promotion, setPromotion] = useState<ConcernRank | null>(null);
  useEffect(() => {
    heading.current?.focus();
  }, []);
  useEffect(() => {
    if (!rewardsEnabled || !aiAvailable) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let polls = 0;
    const check = async () => {
      polls += 1;
      const result = await getConcernReward(riskId);
      if (cancelled) return;
      if (result.ok) {
        const { evaluation, contribution } = result.data;
        if (
          evaluation.status === "provisional" &&
          evaluation.source === "ai" &&
          evaluation.legitimacy &&
          useful.has(evaluation.legitimacy)
        ) {
          const rank = contribution.rank.key;
          const seenKey = `complaient:rank-promotion:${evaluation.id}:${rank}`;
          if (
            rankOrder(rank) > rankOrder(initialRank) &&
            sessionStorage.getItem(seenKey) === null
          ) {
            sessionStorage.setItem(seenKey, "shown");
            announceConcernRank(rank);
            setPromotion(rank);
          }
          return;
        }
        if (
          evaluation.status === "final" ||
          evaluation.status === "overridden" ||
          evaluation.status === "suspended" ||
          (evaluation.legitimacy !== null && !useful.has(evaluation.legitimacy))
        ) {
          return;
        }
      } else if (result.kind === "signed-out" || result.kind === "forbidden") {
        return;
      }
      if (polls < MAX_POLLS) {
        timer = setTimeout(() => {
          void check();
        }, POLL_INTERVAL_MS);
      }
    };
    void check();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [aiAvailable, initialRank, rewardsEnabled, riskId]);
  return (
    <>
      <section
        aria-labelledby={`${id}-title`}
        className="flex flex-col items-start gap-4 rounded-lg border border-surface-border bg-surface p-6 shadow-glass sm:p-8"
      >
        {rewardsEnabled ? (
          <SignalAcknowledgement />
        ) : (
          <span className="inline-flex size-11 items-center justify-center rounded-full bg-ok-soft text-ok">
            <CircleCheckIcon aria-hidden className="size-5" />
          </span>
        )}
        <h2
          ref={heading}
          id={`${id}-title`}
          tabIndex={-1}
          className="text-[24px] leading-tight font-bold tracking-[-0.02em] text-fg outline-none"
        >
          {t("title")}
        </h2>
        <p className="flex items-baseline gap-2 text-[15px] text-fg">
          <span className="text-fg-muted">{t("referenceLabel")}</span>
          <span data-testid="report-reference" className="font-bold tabular-nums">
            {reference}
          </span>
        </p>
        <p className="max-w-[60ch] text-[15px] leading-relaxed text-fg-muted">
          {rewardsEnabled ? t("rewardBody") : t("body")}
        </p>
        <div className="flex flex-wrap gap-3">
          <Link href="/concerns" className={buttonVariants({ variant: "primary" })}>
            {t("concernsLink")}
            <ArrowRightIcon aria-hidden />
          </Link>
          <Link href="/security-contribution" className={buttonVariants({ variant: "secondary" })}>
            {t("rewardsLink")}
            <ArrowRightIcon aria-hidden />
          </Link>
          <Button type="button" variant="secondary" onClick={onAnother}>
            {t("another")}
          </Button>
        </div>
      </section>
      {promotion ? (
        <RankPromotion
          rank={promotion}
          onDismiss={() => {
            setPromotion(null);
          }}
        />
      ) : null}
    </>
  );
}
