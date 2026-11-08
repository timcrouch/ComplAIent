"use client";

import type { AiSystemDetailDto } from "@isms/contracts";
import { buttonVariants, cn, DetailItem, DetailList } from "@isms/ui";
import { PencilIcon } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Section } from "../risks/section";

/** The system's profile as recorded, with a way to edit it for people who may. */
export function ProfileSection({
  system,
  canManage,
}: {
  system: AiSystemDetailDto;
  canManage: boolean;
}) {
  const t = useTranslations("aiAct");
  const notGiven = t("detail.notGiven");
  return (
    <Section title={t("detail.profile")}>
      <DetailList>
        <DetailItem label={t("detail.fields.intendedPurpose")} emphasis="long" empty={notGiven}>
          {system.intendedPurpose}
        </DetailItem>
        <DetailItem label={t("detail.fields.description")} emphasis="long" empty={notGiven}>
          {system.description}
        </DetailItem>
        <DetailItem label={t("detail.fields.role")}>{t(`roles.${system.role}`)}</DetailItem>
        <DetailItem label={t("detail.fields.status")}>{t(`statuses.${system.status}`)}</DetailItem>
        <DetailItem label={t("detail.fields.supplier")} empty={notGiven}>
          {system.supplier}
        </DetailItem>
        <DetailItem label={t("detail.fields.model")} empty={notGiven}>
          {system.model}
        </DetailItem>
        <DetailItem label={t("detail.fields.usesGpai")}>
          {system.usesGeneralPurposeModel ? t("detail.yes") : t("detail.no")}
        </DetailItem>
        <DetailItem label={t("detail.fields.owner")}>{system.owner.displayName}</DetailItem>
        <DetailItem label={t("detail.fields.department")} empty={t("form.noDepartment")}>
          {system.department?.name}
        </DetailItem>
      </DetailList>
      {canManage ? (
        <Link
          href={`/ai-act/systems/${system.id}/edit`}
          className={cn(buttonVariants({ variant: "secondary", size: "sm" }), "w-fit")}
        >
          <PencilIcon aria-hidden />
          {t("detail.edit")}
        </Link>
      ) : null}
    </Section>
  );
}
