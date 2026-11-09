"use client";

import type { WorkspaceStatementDto, WorkspaceStatementKey } from "@isms/contracts";
import { ABOVE_APPETITE_CELL, ABOVE_APPETITE_TEXT, AboveAppetiteIcon, cn } from "@isms/ui";
import {
  ArrowRightIcon,
  CircleCheckIcon,
  ClipboardCheckIcon,
  FileWarningIcon,
  ListTodoIcon,
  MessageSquareTextIcon,
  StampIcon,
  type LucideIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { PendingLink } from "../navigation/pending-link";
import { focusRingClass } from "../shell/styles";
import { glass, sectionTitle } from "./styles";

const ICON: Record<WorkspaceStatementKey, LucideIcon> = {
  approvalsWaiting: StampIcon,
  toReview: ClipboardCheckIcon,
  aboveAppetite: AboveAppetiteIcon,
  evidenceMissing: FileWarningIcon,
  tasksOpen: ListTodoIcon,
  actionsOverdue: ListTodoIcon,
  reviewsDue: ClipboardCheckIcon,
  concernsUpdated: MessageSquareTextIcon,
};

/**
 * What needs the viewer, as plain sentences in the API's order. Each one links to the list of
 * exactly what was counted. The API sends only statements with a count above zero.
 */
export function Statements({ statements }: { statements: readonly WorkspaceStatementDto[] }) {
  const t = useTranslations("home.statements");
  return (
    <section aria-labelledby="home-needs-title" className="flex flex-col gap-3">
      <h2 id="home-needs-title" className={sectionTitle}>
        {t("title")}
      </h2>
      {statements.length === 0 ? (
        <p
          className={cn(
            glass,
            "flex items-center gap-2.5 rounded-md p-5 text-[15px] font-medium text-fg",
          )}
        >
          <CircleCheckIcon aria-hidden className="size-5 shrink-0 text-ok" />
          {t("none")}
        </p>
      ) : (
        <ul aria-labelledby="home-needs-title" className="flex flex-col gap-2">
          {statements.map(({ key, count, href }) => {
            const Icon = ICON[key];
            return (
              <li key={key}>
                <PendingLink
                  href={href}
                  pendingLabel={t("opening", { item: t(key, { count }) })}
                  pendingClassName="border-accent text-accent"
                  className={cn(
                    glass,
                    focusRingClass,
                    "group flex min-h-12 items-center gap-3 rounded-md px-4 py-3 text-[15px] font-semibold text-fg hover:border-accent",
                  )}
                >
                  <span
                    className={cn(
                      "inline-flex size-8 shrink-0 items-center justify-center rounded-full",
                      key === "aboveAppetite" ? ABOVE_APPETITE_CELL : "bg-accent-soft text-accent",
                    )}
                  >
                    <Icon aria-hidden className="size-4" strokeWidth={2.25} />
                  </span>
                  <span className={cn("flex-1", key === "aboveAppetite" && ABOVE_APPETITE_TEXT)}>
                    {t(key, { count })}
                  </span>
                  <ArrowRightIcon
                    aria-hidden
                    className="size-4 shrink-0 text-fg-muted transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none"
                  />
                </PendingLink>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
