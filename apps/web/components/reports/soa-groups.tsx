"use client";

import type { SoaGroupDto, SoaResponse, SoaRowDto } from "@isms/contracts";
import { cn } from "@isms/ui";
import { ChevronRightIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { SoaRows } from "./soa-rows";

const OTHER_GROUP_KEY = "_other";

/**
 * One group as a native disclosure (keyboard and screen-reader friendly), open by default. The
 * summary holds a real heading, so the groups can be reached by heading navigation too.
 */
function Disclosure({
  group,
  level,
  children,
}: {
  group: SoaGroupDto;
  level: 2 | 3;
  children: ReactNode;
}) {
  const t = useTranslations("reports.soaPage");
  const Heading = level === 2 ? "h2" : "h3";
  // The API's synthetic group for requirements the content no longer groups (#19).
  const other = group.key === OTHER_GROUP_KEY;
  return (
    <details open className={cn("group/disc flex flex-col", level === 3 && "pl-1")}>
      <summary
        className={cn(
          "flex cursor-pointer list-none items-center gap-2 rounded-sm py-1 outline-none focus-visible:ring-2 focus-visible:ring-focus-ring [&::-webkit-details-marker]:hidden",
          level === 2 ? "text-lg" : "text-base",
        )}
      >
        <ChevronRightIcon
          aria-hidden
          className="size-4 shrink-0 text-fg-muted transition-transform group-open/disc:rotate-90 motion-reduce:transition-none"
        />
        <Heading className="flex flex-wrap items-baseline gap-x-2 font-semibold text-fg">
          {other ? null : (
            <>
              <span className="text-sm font-semibold text-fg-muted">{group.key}</span>{" "}
            </>
          )}
          <span>
            {t("groupHeading", {
              title: other ? t("otherGroup") : group.title,
              decided: group.decided,
              total: group.total,
            })}
          </span>
        </Heading>
      </summary>
      <div className="mt-2 flex flex-col gap-4">{children}</div>
    </details>
  );
}

/**
 * The statement by group (#19): each top-level group, then its subgroups (two levels) or its
 * requirements (one level). Groups whose shown rows are all filtered out are hidden; counts
 * always cover the whole group.
 */
export function SoaGroups({
  soa,
  rows,
  timeZone,
  onEdit,
}: {
  soa: SoaResponse;
  /** The rows to show, after the "Only undecided" filter. */
  rows: SoaRowDto[];
  timeZone: string;
  onEdit: (row: SoaRowDto, trigger: HTMLElement) => void;
}) {
  const t = useTranslations("reports.soaPage");
  const rowsOf = (key: string) => rows.filter((r) => r.groupKey === key);
  const table = (group: SoaGroupDto, groupRows: SoaRowDto[]) => (
    <SoaRows
      rows={groupRows}
      caption={t("table.groupCaption", {
        framework: soa.framework?.name ?? "",
        group: group.key === OTHER_GROUP_KEY ? t("otherGroup") : `${group.key} ${group.title}`,
      })}
      canManage={soa.canManage}
      timeZone={timeZone}
      scroll={false}
      onEdit={onEdit}
    />
  );
  return (
    <div className="flex flex-col gap-5">
      {soa.groups
        .filter((g) => g.parentKey === null)
        .map((top) => {
          const children = soa.groups
            .filter((c) => c.parentKey === top.key)
            .map((c) => ({ group: c, rows: rowsOf(c.key) }))
            .filter((c) => c.rows.length > 0);
          const own = rowsOf(top.key);
          if (children.length === 0 && own.length === 0) return null;
          return (
            <Disclosure key={top.key} group={top} level={2}>
              {own.length > 0 ? table(top, own) : null}
              {children.map((c) => (
                <Disclosure key={c.group.key} group={c.group} level={3}>
                  {table(c.group, c.rows)}
                </Disclosure>
              ))}
            </Disclosure>
          );
        })}
    </div>
  );
}
