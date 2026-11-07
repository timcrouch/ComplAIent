"use client";

import type { BoardPackResponse, RiskScaleDto, WorkspaceResponse } from "@isms/contracts";
import { cn } from "@isms/ui";
import { CircleCheckIcon, SparkleIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Entrance } from "../motion/entrance";
import { AtAGlance } from "./at-a-glance";
import { Dimensions } from "./dimensions";
import { EmptyHome, SetupHint } from "./empty-home";
import { MyConcerns } from "./my-concerns";
import { MyTasks } from "./my-tasks";
import { RiskPicture } from "./risk-picture";
import { Statements } from "./statements";
import { glass } from "./styles";

type HomeViewProps = {
  /** Already formatted on the server in the user's time zone ("Good morning, Anna."). */
  greeting: string;
  /** The viewer may manage the organisation (`organisation.manage`), so setup is theirs. */
  canSetUp: boolean;
  /** The API reports setup as finished. */
  setupDone: boolean;
  /** The viewer has just finished setup (`?setup=done`): announce it once. */
  justFinished: boolean;
  /** What needs the viewer and the counts over what they see, from the API. */
  workspace: WorkspaceResponse;
  /** The risk scale for the risk picture; loaded only when the workspace has one. */
  scale?: RiskScaleDto | null;
  /** Executive view with `reports.read`: the board facts for the default period, and that period. */
  glance?: { tiles: BoardPackResponse["tiles"]; period: BoardPackResponse["period"] } | undefined;
};

/** Nothing to show yet: no statements, no visible risks, and no concerns or tasks of one's own. */
export function isEmptyWorkspace(w: WorkspaceResponse): boolean {
  return (
    w.statements.length === 0 &&
    (w.dimensions?.risks.total ?? 0) === 0 &&
    w.myConcerns.length === 0 &&
    w.myTasks.length === 0
  );
}

/**
 * Each person's workspace: plain statements of what needs them, four simple counts, and their
 * own concerns and tasks. Every number comes from the API's records; nothing is a composite
 * score. With nothing to show yet, the designed empty state takes their place.
 */
export function HomeView({
  greeting,
  canSetUp,
  setupDone,
  justFinished,
  workspace,
  scale = null,
  glance,
}: HomeViewProps) {
  const t = useTranslations("home");
  const empty = isEmptyWorkspace(workspace);
  return (
    <div className="mx-auto flex w-full max-w-[960px] flex-col gap-8">
      <SetupDoneStatus show={justFinished} />
      <Entrance className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="mb-2 inline-flex items-center gap-1.5 text-[13px] font-semibold text-accent">
            <SparkleIcon aria-hidden className="size-3.5" />
            {t("eyebrow")}
          </p>
          <h1 className="text-[32px] leading-[1.15] font-bold tracking-[-0.025em] text-fg sm:text-[40px]">
            {greeting}
          </h1>
        </div>
      </Entrance>

      {glance ? (
        <Entrance order={1}>
          <AtAGlance tiles={glance.tiles} period={glance.period} />
        </Entrance>
      ) : null}

      {empty ? (
        <EmptyHome canSetUp={canSetUp} setupDone={setupDone} />
      ) : (
        <>
          {canSetUp && !setupDone ? (
            <Entrance order={1}>
              <div className={cn(glass, "rounded-md p-5")}>
                <SetupHint canSetUp setupDone={false} />
              </div>
            </Entrance>
          ) : null}
          <Entrance order={1}>
            <Statements statements={workspace.statements} />
          </Entrance>
          {workspace.dimensions ? (
            <Entrance order={2}>
              <Dimensions dimensions={workspace.dimensions} />
            </Entrance>
          ) : null}
          {workspace.riskPicture && scale ? (
            <Entrance order={3}>
              <RiskPicture picture={workspace.riskPicture} scale={scale} />
            </Entrance>
          ) : null}
          {workspace.myConcerns.length > 0 || workspace.myTasks.length > 0 ? (
            <Entrance order={4} className="grid gap-8 md:grid-cols-2">
              {workspace.myConcerns.length > 0 ? (
                <MyConcerns concerns={workspace.myConcerns} />
              ) : null}
              {workspace.myTasks.length > 0 ? <MyTasks tasks={workspace.myTasks} /> : null}
            </Entrance>
          ) : null}
        </>
      )}
    </div>
  );
}

/**
 * "Your organisation is set up." in a polite live region. The text is added after mount, so
 * screen readers announce it (content already present on load is not announced).
 */
function SetupDoneStatus({ show }: { show: boolean }) {
  const t = useTranslations("home");
  const [message, setMessage] = useState("");
  useEffect(() => {
    if (!show) return;
    setMessage(t("setupDone"));
    // Announce once: a reload or a bookmark of this URL must not announce it again.
    window.history.replaceState(window.history.state, "", "/");
  }, [show, t]);
  return (
    <p
      role="status"
      // Kept in the accessibility tree while empty, so the region exists before the message.
      className={
        message
          ? "flex items-center gap-2 self-start rounded-full bg-ok-soft px-3.5 py-1.5 text-sm font-semibold text-ok"
          : "sr-only"
      }
    >
      {message ? (
        <>
          <CircleCheckIcon aria-hidden className="size-4" />
          <span>{message}</span>
        </>
      ) : null}
    </p>
  );
}
