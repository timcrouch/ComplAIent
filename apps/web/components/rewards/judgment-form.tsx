"use client";

import type { ConcernEvaluationQueueDto, JudgeConcernInput } from "@isms/contracts";
import { Button } from "@isms/ui";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { judgeConcern } from "../../lib/actions/concern-rewards-judgment";
import { goTo } from "../../lib/navigate";

type Item = ConcernEvaluationQueueDto["items"][number];

export function JudgmentForm({ item }: { item: Item }) {
  const t = useTranslations("judgments");
  const current = item.evaluation;
  const [legitimacy, setLegitimacy] = useState<JudgeConcernInput["legitimacy"]>(
    current.legitimacy ?? "plausible",
  );
  const [severity, setSeverity] = useState<JudgeConcernInput["severity"]>(
    current.severity ?? "moderate",
  );
  const [duplicateRiskId, setDuplicateRiskId] = useState("");
  const [feedback, setFeedback] = useState(
    current.feedback ?? "Thank you for reporting this concern.",
  );
  const [rationale, setRationale] = useState(item.rationale ?? "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function submit(event: React.SyntheticEvent<HTMLFormElement, SubmitEvent>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const result = await judgeConcern(current.riskId, {
        legitimacy,
        severity,
        duplicateRiskId: legitimacy === "confirmed_duplicate" ? duplicateRiskId : null,
        feedback,
        rationale,
      });
      if (result.ok) {
        setMessage(t("saved"));
        window.location.reload();
      } else if ((result.kind === "signed-out" || result.kind === "reauth") && result.href) {
        goTo(result.href);
      } else setMessage(t("failed"));
    } catch {
      setMessage(t("failed"));
    } finally {
      setBusy(false);
    }
  }

  const field = "flex flex-col gap-1.5 text-sm font-semibold text-fg";
  const control =
    "min-h-11 rounded-lg border border-control-border bg-control px-3 py-2 text-sm text-fg outline-none focus:ring-2 focus:ring-focus-ring";
  return (
    <form
      onSubmit={(event) => {
        void submit(event);
      }}
      className="flex flex-col gap-4"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <label className={field}>
          {t("legitimacy")}
          <select
            className={control}
            value={legitimacy}
            onChange={(e) => {
              setLegitimacy(e.target.value as typeof legitimacy);
            }}
          >
            {[
              "confirmed",
              "plausible",
              "confirmed_duplicate",
              "not_confirmed",
              "out_of_scope",
              "abusive",
            ].map((value) => (
              <option key={value} value={value}>
                {value.replaceAll("_", " ")}
              </option>
            ))}
          </select>
        </label>
        <label className={field}>
          {t("severity")}
          <select
            className={control}
            value={severity}
            onChange={(e) => {
              setSeverity(e.target.value as typeof severity);
            }}
          >
            {["informational", "minor", "moderate", "major", "critical"].map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
      </div>
      {legitimacy === "confirmed_duplicate" ? (
        <label className={field}>
          {t("duplicate")}
          <input
            required
            className={control}
            value={duplicateRiskId}
            onChange={(e) => {
              setDuplicateRiskId(e.target.value);
            }}
          />
        </label>
      ) : null}
      <label className={field}>
        {t("feedback")}
        <textarea
          required
          minLength={1}
          maxLength={500}
          rows={3}
          className={control}
          value={feedback}
          onChange={(e) => {
            setFeedback(e.target.value);
          }}
        />
      </label>
      <label className={field}>
        {t("reason")}
        <textarea
          required
          minLength={1}
          maxLength={1000}
          rows={3}
          className={control}
          value={rationale}
          onChange={(e) => {
            setRationale(e.target.value);
          }}
        />
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={busy}>
          {busy ? t("saving") : t("save")}
        </Button>
        <Link
          href={`/risks/${current.riskId}`}
          className="text-sm font-semibold text-accent hover:underline"
        >
          {t("openRisk", { reference: current.riskReference })}
        </Link>
        <p role="status" className="text-sm font-medium text-fg-muted">
          {message}
        </p>
      </div>
    </form>
  );
}
