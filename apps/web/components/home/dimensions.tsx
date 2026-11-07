"use client";

import type { WorkspaceDimensionsDto } from "@isms/contracts";
import { cn } from "@isms/ui";
import { useTranslations } from "next-intl";
import { glass, sectionTitle } from "./styles";

type DimensionKey = "controls" | "evidence" | "risks" | "tasks";

/** One dimension: the count shown, and the part of a whole its bar and sentence describe. */
type Dimension = { name: DimensionKey; count: number; part: number; whole: number };

function dimensionsOf(d: WorkspaceDimensionsDto): Dimension[] {
  return [
    {
      name: "controls",
      count: d.controls.accepted,
      part: d.controls.withEvidence,
      whole: d.controls.accepted,
    },
    { name: "evidence", count: d.evidence.items, part: d.evidence.missing, whole: d.risks.total },
    { name: "risks", count: d.risks.total, part: d.risks.aboveAppetite, whole: d.risks.total },
    { name: "tasks", count: d.tasks.open, part: d.tasks.overdue, whole: d.tasks.open },
  ];
}

/**
 * Four plain counts from the viewer's records: controls, evidence, risks and tasks. Each has a
 * simple bar of part over whole, whose text alternative is the sentence beside it. There is no
 * composite score, and every number shown comes from the API's response.
 */
export function Dimensions({ dimensions }: { dimensions: WorkspaceDimensionsDto }) {
  const t = useTranslations("home.dimensions");
  return (
    <section aria-labelledby="home-dimensions-title" className="flex flex-col gap-3">
      <div className="flex flex-col gap-1 px-1">
        <h2 id="home-dimensions-title" className={cn(sectionTitle, "px-0")}>
          {t("title")}
        </h2>
        <p className="text-[13px] text-fg-muted">{t("intro")}</p>
      </div>
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {dimensionsOf(dimensions).map((d) => (
          <DimensionCard key={d.name} {...d} />
        ))}
      </ul>
    </section>
  );
}

function DimensionCard({ name, count, part, whole }: Dimension) {
  const t = useTranslations(`home.dimensions.${name}`);
  const sentence = whole === 0 ? t("none") : t("sentence", { part, whole });
  // Width only: the share is drawn, never printed, so no derived number appears as text.
  const share = whole === 0 ? 0 : Math.min(1, part / whole);
  return (
    <li className={cn(glass, "flex flex-col gap-3 rounded-md p-5")}>
      <h3 className="text-[13px] font-semibold text-fg-muted">{t("title")}</h3>
      <p className="flex items-baseline gap-2">
        <span data-count className="text-[28px] leading-none font-bold text-fg tabular-nums">
          {count}
        </span>
        <span className="text-[13px] text-fg-muted">{t("count", { count })}</span>
      </p>
      <div
        role="img"
        aria-label={sentence}
        className="h-2 w-full overflow-hidden rounded-full bg-control-border"
      >
        <div
          className="h-full rounded-full bg-accent"
          style={{ width: `${String(share * 100)}%` }}
        />
      </div>
      <p className="text-[13px] leading-snug text-fg">{sentence}</p>
    </li>
  );
}
