"use client";

import type { EvidenceDto, PersonRef } from "@isms/contracts";
import { Button, cn } from "@isms/ui";
import { CopyIcon, DownloadIcon, FileCheckIcon, SendIcon, UploadIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { getRisk } from "../../lib/actions/risks";
import { formatDate } from "../../lib/dates";
import { focusRingClass } from "../shell/styles";
import { settle } from "../risks/risk-call";
import { useRisk } from "../risks/risk-context";
import { Section } from "../risks/section";
import { RequestDialog } from "./request-dialog";
import { UploadDialog, type ControlChoice } from "./upload-dialog";

const linkClass = cn(
  "inline-flex min-h-6 items-center gap-1.5 rounded-sm font-semibold break-all text-accent underline-offset-4 hover:underline",
  focusRingClass,
);

function EvidenceItem({ file }: { file: EvidenceDto }) {
  const t = useTranslations("evidence");
  const { timeZone, announce } = useRisk();

  async function copy() {
    try {
      await navigator.clipboard.writeText(file.sha256);
      announce(t("copied"));
    } catch {
      announce(t("copyFailed"));
    }
  }

  return (
    <li className="flex flex-col gap-2 rounded-md border border-surface-border p-3 text-[14px]">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <a href={`/evidence/${file.id}/download`} className={linkClass}>
          <DownloadIcon aria-hidden className="size-4 shrink-0" />
          <span className="sr-only">{t("downloadLabel")} </span>
          {file.fileName}
        </a>
        <span className="text-[13px] text-fg-muted">
          {t("classificationLabel", { value: t(`classification.${file.classification}`) })}
        </span>
      </div>
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-2">
        <span className="text-[13px] font-semibold text-fg-muted">{t("sha256")}</span>
        <code className="font-mono text-[12.5px] break-all text-fg">{file.sha256}</code>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="self-start sm:self-auto"
          onClick={() => void copy()}
        >
          <CopyIcon aria-hidden />
          {t("copy")} <span className="sr-only">{file.fileName}</span>
        </Button>
      </div>
      <p className="flex flex-wrap gap-x-3 text-[13px] text-fg-muted">
        <span>{t("uploadedBy", { name: file.uploadedBy.displayName })}</span>
        <span>{t("collected", { date: formatDate(file.collectedAt, timeZone) })}</span>
      </p>
      <div className="flex flex-wrap items-baseline gap-x-2 text-[13px] text-fg">
        <span aria-hidden className="font-semibold text-fg-muted">
          {t("supports")}
        </span>
        <ul aria-label={t("supportsLabel")} className="flex flex-wrap gap-x-3 gap-y-1">
          {file.controls.map((c) => (
            <li key={c.code}>
              <span className="font-semibold tabular-nums">{c.code}</span> {c.title}
            </li>
          ))}
        </ul>
      </div>
    </li>
  );
}

type EvidenceSectionProps = {
  /** People who can be asked for evidence; null when the viewer may not list people. */
  people: readonly PersonRef[] | null;
  maxBytes: number;
};

/**
 * The risk's evidence, newest first, each with its SHA-256; reviewers upload files for
 * accepted controls and ask colleagues for them. Neither changes the risk's version.
 */
export function EvidenceSection({ people, maxBytes }: EvidenceSectionProps) {
  const t = useTranslations("evidence");
  const { risk, announce, refreshed } = useRisk();
  const [dialog, setDialog] = useState<"upload" | "request" | null>(null);
  // A fresh form each time a dialog opens.
  const [round, setRound] = useState(0);
  const openDialog = (which: "upload" | "request") => {
    setRound((r) => r + 1);
    setDialog(which);
  };
  const accepted: ControlChoice[] = risk.controls
    .filter((c) => c.status === "accepted")
    .map(({ controlId, code, title }) => ({ controlId, code, title }));
  const canAdd = risk.can.addEvidence && accepted.length > 0;

  async function uploaded(file: EvidenceDto) {
    setDialog(null);
    announce(t("uploadDialog.done", { name: file.fileName }));
    const result = await settle(() => getRisk(risk.id));
    if (result.ok) refreshed(result.data);
  }

  return (
    <Section title={t("title")} intro={t("intro")}>
      {risk.can.addEvidence && accepted.length === 0 ? (
        <p className="text-[14px] text-fg-muted">{t("needsControl")}</p>
      ) : null}
      {canAdd ? (
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              openDialog("upload");
            }}
          >
            <UploadIcon aria-hidden />
            {t("upload")}
          </Button>
          {people ? (
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                openDialog("request");
              }}
            >
              <SendIcon aria-hidden />
              {t("request")}
            </Button>
          ) : null}
        </div>
      ) : null}
      {risk.evidence.length === 0 ? (
        <p className="flex items-center gap-1.5 text-[14px] text-fg-muted">
          <FileCheckIcon aria-hidden className="size-4" />
          {t("empty")}
        </p>
      ) : (
        <ul aria-label={t("listLabel")} className="flex flex-col gap-2">
          {risk.evidence.map((file) => (
            <EvidenceItem key={file.id} file={file} />
          ))}
        </ul>
      )}
      {canAdd ? (
        <UploadDialog
          key={`upload-${String(round)}`}
          open={dialog === "upload"}
          onOpenChange={(open) => {
            setDialog(open ? "upload" : null);
          }}
          title={t("uploadDialog.title")}
          description={t("uploadDialog.description")}
          url={`/risks/${risk.id}/evidence`}
          controls={accepted}
          maxBytes={maxBytes}
          onUploaded={(file) => void uploaded(file)}
        />
      ) : null}
      {canAdd && people ? (
        <RequestDialog
          key={`request-${String(round)}`}
          open={dialog === "request"}
          onOpenChange={(open) => {
            setDialog(open ? "request" : null);
          }}
          riskId={risk.id}
          people={people}
          controls={accepted}
          onSent={(person) => {
            setDialog(null);
            announce(t("requestDialog.done", { name: person.displayName }));
          }}
        />
      ) : null}
    </Section>
  );
}
