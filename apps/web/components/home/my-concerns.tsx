"use client";

import type { WorkspaceConcernDto } from "@isms/contracts";
import { cn } from "@isms/ui";
import { useTranslations } from "next-intl";
import { ConcernStatus } from "../report/concern-list";
import { glass } from "./styles";
import { HomeSection } from "./home-section";

/** The viewer's latest reports (at most five, newest first), with where each one stands. */
export function MyConcerns({ concerns }: { concerns: readonly WorkspaceConcernDto[] }) {
  const t = useTranslations("home.concerns");
  return (
    <HomeSection
      id="home-concerns-title"
      title={t("title")}
      more={{ href: "/concerns", label: t("all") }}
    >
      <ul className="flex flex-col gap-2">
        {concerns.map((c) => (
          <li
            key={c.id}
            className={cn(
              glass,
              "flex flex-col gap-2 rounded-md p-4 sm:flex-row sm:items-center sm:gap-4",
            )}
          >
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <p className="text-[12px] font-semibold text-fg-muted tabular-nums">{c.reference}</p>
              <p className="text-[15px] font-semibold break-words text-fg">{c.title}</p>
            </div>
            <ConcernStatus state={c.state} />
          </li>
        ))}
      </ul>
    </HomeSection>
  );
}
