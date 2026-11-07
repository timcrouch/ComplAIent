"use client";

import type { RiskDetailDto } from "@isms/contracts";
import { useState, type ReactNode } from "react";
import type { CallResult } from "../../lib/server-api";
import { ErrorText, StaleNotice } from "./notices";
import type { RiskErrorKey } from "./risk-call";
import { useRisk } from "./risk-context";

/**
 * One change at a time from a section (a control decision, a suggestion request, the AI
 * estimate, a resolved question), with its refusal shown where it was made. `notices(onReloaded)` renders the error or the stale-version reload.
 */
export function useControlAction() {
  const { change, reload } = useRisk();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<RiskErrorKey | null>(null);
  const [stale, setStale] = useState(false);

  async function run(
    call: (version: number) => Promise<CallResult<RiskDetailDto>>,
    done?: (risk: RiskDetailDto) => string,
  ): Promise<RiskDetailDto | null> {
    if (busy) return null;
    setBusy(true);
    setError(null);
    setStale(false);
    const outcome = await change(call, done);
    setBusy(false);
    if (outcome.ok) return outcome.risk;
    if (outcome.stale) setStale(true);
    else setError(outcome.error);
    return null;
  }

  function notices(onReloaded: () => void): ReactNode {
    return (
      <>
        {error ? <ErrorText error={error} /> : null}
        {stale ? (
          <StaleNotice
            onReload={async () => {
              const reloaded = await reload();
              if (reloaded) {
                setStale(false);
                onReloaded();
              }
              return reloaded;
            }}
          />
        ) : null}
      </>
    );
  }

  return { busy, run, notices };
}
