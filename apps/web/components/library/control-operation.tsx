"use client";

import type { ControlOperationDto } from "@isms/contracts";
import { DetailItem, DetailList, StatusBadge, cn } from "@isms/ui";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { formatDate } from "../../lib/dates";
import { glass } from "../setup/styles";
import { focusRingClass } from "../shell/styles";
import { RecordTestForm } from "./record-test-form";
import { TestResultBadge } from "./test-result";

type Props = { operation: ControlOperationDto | null; timeZone: string };

/** A control in operation: the risks using it, its latest result, test history and the form to record a test. */
export function ControlOperation({ operation, timeZone }: Props) {
  const t = useTranslations("library.operation");
  if (!operation) {
    return (
      <section
        aria-labelledby="control-operation"
        className={cn(glass, "flex flex-col gap-2 p-5 sm:p-6")}
      >
        <h2 id="control-operation" className="text-lg font-bold tracking-[-0.01em] text-fg">
          {t("title")}
        </h2>
        <p role="status" className="text-sm text-fg-muted">
          {t("loadFailed")}
        </p>
      </section>
    );
  }
  const { latest, tests } = operation;

  return (
    <section
      aria-labelledby="control-operation"
      className={cn(glass, "flex flex-col gap-5 p-5 sm:p-6")}
    >
      <div className="flex flex-col gap-1">
        <h2 id="control-operation" className="text-lg font-bold tracking-[-0.01em] text-fg">
          {t("title")}
        </h2>
        <p className="max-w-[60ch] text-[13px] leading-relaxed text-fg-muted">{t("intro")}</p>
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        <div className="flex flex-col gap-2">
          <h3 className="text-[15px] font-semibold text-fg">{t("risksHeading")}</h3>
          {operation.risks.length === 0 ? (
            <p className="text-sm text-fg-muted">{t("noRisks")}</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {operation.risks.map((risk) => (
                <li key={risk.id} className="text-sm">
                  <Link
                    href={`/risks/${risk.id}`}
                    className={cn(
                      "rounded-xs font-semibold text-accent underline-offset-4 hover:underline",
                      focusRingClass,
                    )}
                  >
                    {risk.reference} {risk.title}
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <p className="text-sm text-fg-muted">
            {t("evidenceCount", { count: operation.evidenceCount })}
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <h3 className="text-[15px] font-semibold text-fg">{t("latestHeading")}</h3>
          {latest ? (
            <div className="flex flex-col items-start gap-1.5">
              <TestResultBadge result={latest.result} />
              <p className="text-sm text-fg-muted">
                {formatDate(latest.testedOn, timeZone)} ·{" "}
                {t("testedBy", { name: latest.testedBy.displayName })}
              </p>
            </div>
          ) : (
            <p className="text-sm text-fg-muted">{t("neverTested")}</p>
          )}
          {operation.testDue ? <StatusBadge status="attention" label={t("testDue")} /> : null}
        </div>
      </div>

      {tests.length > 0 ? (
        <div className="flex flex-col gap-2">
          <h3 className="text-[15px] font-semibold text-fg">{t("historyHeading")}</h3>
          <ul className="flex flex-col gap-2">
            {tests.map((test) => (
              <li key={test.id}>
                <details className="rounded-md border border-[color-mix(in_oklab,var(--isms-text)_10%,transparent)] px-3.5 py-2.5">
                  <summary
                    className={cn(
                      "flex cursor-pointer flex-wrap items-center gap-2 rounded-xs text-sm font-semibold text-fg",
                      focusRingClass,
                    )}
                  >
                    <span>{formatDate(test.testedOn, timeZone)}</span>
                    <TestResultBadge result={test.result} />
                  </summary>
                  <DetailList className="mt-1">
                    <DetailItem label={t("methodLabel")} emphasis="long">
                      {test.method}
                    </DetailItem>
                    {test.notes ? (
                      <DetailItem label={t("notesLabel")} emphasis="long">
                        {test.notes}
                      </DetailItem>
                    ) : null}
                    <DetailItem label={t("evidenceLabel")} empty={t("noEvidence")}>
                      {test.evidence.length > 0 || test.hiddenEvidenceCount > 0 ? (
                        <>
                          {test.evidence.map((e) => e.fileName).join(", ")}
                          {test.hiddenEvidenceCount > 0 ? (
                            <span
                              className={cn(
                                "font-normal text-fg-muted",
                                test.evidence.length > 0 && "ml-1",
                              )}
                            >
                              {t("hiddenEvidence", { count: test.hiddenEvidenceCount })}
                            </span>
                          ) : null}
                        </>
                      ) : null}
                    </DetailItem>
                  </DetailList>
                  <p className="pt-1 text-[13px] text-fg-muted">
                    {t("testedBy", { name: test.testedBy.displayName })}
                  </p>
                </details>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {operation.canRecordTest ? (
        <RecordTestForm
          code={operation.code}
          evidenceOptions={operation.evidenceOptions}
          canSuggestSteps={operation.canSuggestSteps}
        />
      ) : null}
    </section>
  );
}
