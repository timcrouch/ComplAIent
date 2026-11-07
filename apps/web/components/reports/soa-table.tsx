"use client";

import type { SoaResponse, SoaRowDto } from "@isms/contracts";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { ApplicabilityDialog } from "./applicability-dialog";
import { SoaGroups } from "./soa-groups";
import { SoaRows } from "./soa-rows";

type Editing = { row: SoaRowDto; open: boolean };

/**
 * The Statement of Applicability: summary, then one line per requirement, under collapsible
 * group headings when the framework has groups (NIST CSF Functions and Categories, ISO themes).
 */
export function SoaTable({
  soa,
  onlyUndecided,
  timeZone,
}: {
  soa: SoaResponse;
  /** From the page's URL (?undecided=1); the filter link lives in the toolbar. */
  onlyUndecided: boolean;
  timeZone: string;
}) {
  const t = useTranslations("reports.soaPage");
  const router = useRouter();
  const [editing, setEditing] = useState<Editing | null>(null);
  const trigger = useRef<HTMLElement | null>(null);

  const decided = soa.rows.filter((r) => r.decision !== null).length;
  const rows = onlyUndecided ? soa.rows.filter((r) => r.decision === null) : soa.rows;
  const onEdit = (row: SoaRowDto, from: HTMLElement) => {
    trigger.current = from;
    setEditing({ row, open: true });
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <p role="status" className="text-sm font-semibold text-fg">
          {t("summary", { decided, total: soa.rows.length })}
        </p>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-fg-muted">
          {soa.rows.length === 0 ? t("empty") : t("nothingUndecided")}
        </p>
      ) : soa.groups.length > 0 ? (
        <SoaGroups soa={soa} rows={rows} timeZone={timeZone} onEdit={onEdit} />
      ) : (
        <SoaRows
          rows={rows}
          caption={t("table.caption", { framework: soa.framework?.name ?? "" })}
          canManage={soa.canManage}
          timeZone={timeZone}
          scroll={soa.rows.length > 12}
          onEdit={onEdit}
        />
      )}
      {editing ? (
        <ApplicabilityDialog
          key={editing.row.requirementId}
          row={editing.row}
          open={editing.open}
          onOpenChange={(open) => {
            setEditing((cur) => (cur ? { ...cur, open } : cur));
          }}
          onChanged={() => {
            router.refresh();
          }}
          finalFocus={trigger}
        />
      ) : null}
    </div>
  );
}
