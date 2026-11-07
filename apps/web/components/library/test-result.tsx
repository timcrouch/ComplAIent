"use client";

import type { ControlTestResult } from "@isms/contracts";
import { StatusBadge, type Status } from "@isms/ui";
import { CircleCheckIcon, OctagonXIcon, TriangleAlertIcon, type LucideIcon } from "lucide-react";
import { useTranslations } from "next-intl";

export const RESULT_STATUS: Record<ControlTestResult, Status> = {
  effective: "ok",
  partially_effective: "attention",
  ineffective: "critical",
};

export const RESULT_ICON: Record<ControlTestResult, LucideIcon> = {
  effective: CircleCheckIcon,
  partially_effective: TriangleAlertIcon,
  ineffective: OctagonXIcon,
};

/** A test result as an icon and words (never colour alone): Effective, Partly effective, Not effective. */
export function TestResultBadge({ result }: { result: ControlTestResult }) {
  const t = useTranslations("library.operation.results");
  return <StatusBadge status={RESULT_STATUS[result]} label={t(result)} />;
}
