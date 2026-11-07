"use client";

import type { DepartmentDto, SiteDto, UserSummaryDto } from "@isms/contracts";
import { Button, cn } from "@isms/ui";
import { CircleCheckIcon, InfoIcon, UserRoundCogIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { RoleDialog } from "./role-dialog";

type PeopleListProps = {
  users: readonly UserSummaryDto[];
  sites: readonly SiteDto[];
  departments: readonly DepartmentDto[];
};

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");

/**
 * Everyone who has signed in, with their roles as chips (role and where it applies). People
 * who have not signed in yet are unknown to the workspace, and the step says so.
 */
export function PeopleList({ users, sites, departments }: PeopleListProps) {
  const t = useTranslations("setup.people");
  const tr = useTranslations("roles");
  const [editing, setEditing] = useState<string | null>(null);
  const [saved, setSaved] = useState("");
  const editingUser = users.find((u) => u.id === editing);

  return (
    <div className="flex flex-col gap-5">
      <p className="flex items-start gap-2 text-[13px] leading-relaxed text-fg-muted">
        <InfoIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-info" />
        <span>{t("signInNote")}</span>
      </p>

      <ul aria-label={t("listLabel")} className="flex flex-col gap-3">
        {users.map((user) => (
          <li
            key={user.id}
            className="flex flex-col gap-3 rounded-md border border-[color-mix(in_oklab,var(--isms-text)_9%,transparent)] bg-[color-mix(in_oklab,var(--isms-surface),transparent_35%)] p-4 sm:flex-row sm:items-center"
          >
            <div className="flex min-w-0 flex-1 items-start gap-3">
              <span
                aria-hidden
                className="inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-accent-soft text-sm font-bold text-accent"
              >
                {initials(user.displayName)}
              </span>
              <div className="flex min-w-0 flex-col gap-2">
                <div className="min-w-0">
                  <p className="truncate text-[15px] font-semibold text-fg">{user.displayName}</p>
                  <p className="truncate text-[13px] text-fg-muted">{user.email}</p>
                </div>
                {user.roles.length === 0 ? (
                  <p className="text-[13px] font-medium text-fg-muted italic">{t("noRoles")}</p>
                ) : (
                  <ul className="flex flex-wrap gap-1.5">
                    {user.roles.map((a) => (
                      <li
                        key={a.id}
                        className="inline-flex items-center gap-1 rounded-full border border-[color-mix(in_oklab,var(--isms-accent)_30%,transparent)] bg-accent-soft px-2.5 py-0.5 text-xs font-semibold text-accent"
                      >
                        <span>{tr(`${a.role}.label`)}</span>
                        <span aria-hidden>·</span>
                        <span className="font-medium">{a.scopeName ?? t("wholeOrganisation")}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              aria-label={t("changeFor", { name: user.displayName })}
              onClick={() => {
                setSaved("");
                setEditing(user.id);
              }}
              className="self-start sm:self-center"
            >
              <UserRoundCogIcon aria-hidden />
              {t("change")}
            </Button>
          </li>
        ))}
      </ul>

      <p
        role="status"
        className={cn(
          "flex min-h-5 items-center gap-1.5 text-sm font-medium text-fg-muted",
          !saved && "sr-only",
        )}
      >
        {saved ? <CircleCheckIcon aria-hidden className="size-4 text-ok" /> : null}
        {saved}
      </p>

      {editingUser ? (
        <RoleDialog
          key={editingUser.id}
          user={editingUser}
          sites={sites}
          departments={departments}
          open
          onOpenChange={(open) => {
            if (!open) setEditing(null);
          }}
          onSaved={() => {
            setEditing(null);
            setSaved(t("saved", { name: editingUser.displayName }));
          }}
        />
      ) : null}
    </div>
  );
}
