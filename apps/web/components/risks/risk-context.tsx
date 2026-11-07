"use client";

import type { RiskDetailDto } from "@isms/contracts";
import { useTranslations } from "next-intl";
import { createContext, useContext, useRef, useState, type ReactNode } from "react";
import { getRisk } from "../../lib/actions/risks";
import type { CallResult } from "../../lib/server-api";
import {
  isStale,
  riskFailureMessage,
  settle,
  signInAgain,
  type Failure,
  type RiskErrorKey,
} from "./risk-call";

export type ChangeOutcome =
  | { ok: true; risk: RiskDetailDto }
  | {
      ok: false;
      stale: boolean;
      error: RiskErrorKey | null;
      /** The refusal as the API gave it, for sections with their own reasons (approval). */
      failure: Failure | null;
    };

type RiskContextValue = {
  risk: RiskDetailDto;
  timeZone: string;
  /** Says something politely in the page's status region. */
  announce: (message: string) => void;
  /**
   * Runs one change against the version on screen. On success the page shows the API's risk
   * and `done` is announced; a stale version, a refusal or a sign-in come back as an outcome.
   */
  change: (
    call: (version: number) => Promise<CallResult<RiskDetailDto>>,
    done?: (risk: RiskDetailDto) => string,
    /** The version to send instead of the one on screen (an open editor's base). */
    version?: number,
  ) => Promise<ChangeOutcome>;
  /**
   * The version an editor opened at `openedAt` should send now: advanced through this page's
   * own successful writes, never through a background refresh (someone else's change).
   */
  baseVersion: (openedAt: number) => number;
  /** Re-reads the risk after someone else changed it; true when the page now shows it. */
  reload: () => Promise<boolean>;
  /** Shows a newer copy read in the background (suggestion refreshes); never an older one. */
  refreshed: (risk: RiskDetailDto) => void;
};

const RiskContext = createContext<RiskContextValue | null>(null);

export function useRisk(): RiskContextValue {
  const value = useContext(RiskContext);
  if (!value) throw new Error("useRisk outside RiskProvider");
  return value;
}

/** The risk on screen, shared by every section, and the page's one announcement region. */
export function RiskProvider({
  initial,
  timeZone,
  children,
}: {
  initial: RiskDetailDto;
  timeZone: string;
  children: ReactNode;
}) {
  const t = useTranslations("risks");
  const [risk, setRisk] = useState(initial);
  const [message, setMessage] = useState("");
  // The version the next change sends, current even between renders.
  const latest = useRef(initial);
  // This page's own writes: the version each one was sent with → the version it produced.
  const ownWrites = useRef(new Map<number, number>());

  function show(next: RiskDetailDto) {
    latest.current = next;
    setRisk(next);
  }

  const value: RiskContextValue = {
    risk,
    timeZone,
    announce: setMessage,
    async change(call, done, version) {
      const sent = version ?? latest.current.version;
      const result = await settle(() => call(sent));
      if (result.ok) {
        if (result.data.version > sent) ownWrites.current.set(sent, result.data.version);
        show(result.data);
        if (done) setMessage(done(result.data));
        return { ok: true, risk: result.data };
      }
      if (signInAgain(result)) return { ok: false, stale: false, error: null, failure: null };
      if (isStale(result)) return { ok: false, stale: true, error: null, failure: result };
      return { ok: false, stale: false, error: riskFailureMessage(result), failure: result };
    },
    baseVersion(openedAt) {
      let base = openedAt;
      for (let next = ownWrites.current.get(base); next !== undefined && next > base;) {
        base = next;
        next = ownWrites.current.get(base);
      }
      return base;
    },
    async reload() {
      const result = await settle(() => getRisk(latest.current.id));
      if (!result.ok) {
        signInAgain(result);
        return false;
      }
      show(result.data);
      setMessage(t("stale.reloaded"));
      return true;
    },
    refreshed(next) {
      if (next.id === latest.current.id && next.version >= latest.current.version) show(next);
    },
  };

  return (
    <RiskContext.Provider value={value}>
      {children}
      <p data-testid="risk-announcer" role="status" className="sr-only">
        {message}
      </p>
    </RiskContext.Provider>
  );
}
