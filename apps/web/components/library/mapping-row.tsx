"use client";

import type { MappingDto } from "@isms/contracts";
import { Button, StatusBadge } from "@isms/ui";
import { CircleAlertIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useId, useRef, useState } from "react";
import { reviewMapping } from "../../lib/actions/library";
import { formatDate } from "../../lib/dates";
import { goTo } from "../../lib/navigate";

type MappingRowProps = {
  mapping: MappingDto;
  /** The viewer holds library.review; the API still decides. */
  canReview: boolean;
  /** The viewer's time zone, for the review date. */
  timeZone: string;
  /** Told about the stored mapping after a successful review, so summaries can update. */
  onReviewed?: (mapping: MappingDto) => void;
};

type ReviewError = "reviewForbidden" | "reviewChanged" | "reviewFailed";

/**
 * One requirement a control helps meet, with its review status in words and an icon. A
 * security lead can mark it reviewed here; the new status is announced, and focus moves to
 * it because the button it replaces is gone.
 */
export function MappingRow({ mapping, canReview, timeZone, onReviewed }: MappingRowProps) {
  const t = useTranslations("library");
  const id = useId();
  const [review, setReview] = useState(mapping.review);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ReviewError | null>(null);
  const [announced, setAnnounced] = useState("");
  const statusRef = useRef<HTMLDivElement>(null);
  const focusStatus = useRef(false);

  useEffect(() => {
    if (!focusStatus.current) return;
    focusStatus.current = false;
    statusRef.current?.focus();
  }, [review]);

  const reviewedLabel =
    review.status === "reviewed"
      ? t("reviewedBy", {
          name: review.reviewedBy.displayName,
          date: formatDate(review.reviewedAt, timeZone),
        })
      : null;

  async function mark() {
    if (busy) return;
    setBusy(true);
    setError(null);
    let result: Awaited<ReturnType<typeof reviewMapping>>;
    try {
      result = await reviewMapping(mapping.id);
    } catch {
      // The action transport itself failed (network, deploy, action mismatch).
      result = { ok: false, kind: "unavailable", details: [] };
    } finally {
      setBusy(false);
    }
    if (result.ok) {
      const next = result.data.review;
      focusStatus.current = true;
      setReview(next);
      onReviewed?.(result.data);
      if (next.status === "reviewed") {
        setAnnounced(
          t("reviewedBy", {
            name: next.reviewedBy.displayName,
            date: formatDate(next.reviewedAt, timeZone),
          }),
        );
      }
      return;
    }
    if (result.kind === "signed-out" || result.kind === "reauth") {
      if (result.href) goTo(result.href);
      return;
    }
    setError(
      result.kind === "forbidden"
        ? "reviewForbidden"
        : result.kind === "not-found"
          ? "reviewChanged"
          : "reviewFailed",
    );
  }

  return (
    <li className="flex flex-col gap-3 py-4 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
      <div id={`${id}-req`} className="flex min-w-0 items-start gap-3">
        <span className="mt-px shrink-0 rounded-sm border border-control-border px-1.5 py-0.5 font-mono text-xs font-semibold text-fg">
          {mapping.requirementRef}
        </span>{" "}
        <span className="text-sm leading-relaxed text-fg">{mapping.requirementTitle}</span>
      </div>
      <div className="flex shrink-0 flex-col items-start gap-2 sm:items-end">
        <div
          ref={statusRef}
          tabIndex={-1}
          className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
        >
          {reviewedLabel ? (
            <StatusBadge
              status="ok"
              label={reviewedLabel}
              className="h-auto min-h-6 py-1 leading-snug whitespace-normal"
            />
          ) : (
            <StatusBadge status="attention" label={t("notReviewed")} />
          )}
        </div>
        {canReview && review.status === "unreviewed" ? (
          <Button
            variant="secondary"
            size="sm"
            focusableWhenDisabled
            disabled={busy}
            aria-describedby={`${id}-req`}
            onClick={() => void mark()}
          >
            {busy ? t("marking") : t("markReviewed")}
          </Button>
        ) : null}
        {error ? (
          <p
            role="alert"
            className="flex max-w-[36ch] items-start gap-1.5 text-[13px] leading-snug font-medium text-critical"
          >
            <CircleAlertIcon aria-hidden className="mt-px size-4 shrink-0" />
            <span>{t(error)}</span>
          </p>
        ) : null}
        <p role="status" className="sr-only">
          {announced}
        </p>
      </div>
    </li>
  );
}
