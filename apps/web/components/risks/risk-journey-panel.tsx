"use client";

import { useRisk } from "./risk-context";
import { RiskJourney } from "./risk-journey";

/** The journey from the risk on screen, so it follows every action. */
export function RiskJourneyPanel() {
  const { risk, timeZone } = useRisk();
  return <RiskJourney journey={risk.journey} timeZone={timeZone} />;
}
