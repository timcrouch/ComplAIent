"use client";

import type { MeResponse } from "@isms/contracts";
import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@isms/ui";
import Image from "next/image";
import { useTranslations } from "next-intl";

type ConcernRank = NonNullable<MeResponse["concernRank"]>;

export function RankPromotion({ rank, onDismiss }: { rank: ConcernRank; onDismiss: () => void }) {
  const t = useTranslations("report.promotion");
  const rankName = t(`ranks.${rank}`);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onDismiss();
      }}
    >
      <DialogContent
        data-testid="rank-promotion"
        closeLabel={t("close")}
        className="max-w-lg overflow-hidden p-7 text-center sm:p-9"
      >
        <div className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-[radial-gradient(circle_at_50%_20%,color-mix(in_oklab,var(--isms-accent)_20%,transparent),transparent_68%)]" />
        <div className="relative mx-auto flex size-52 items-center justify-center">
          <span className="absolute size-36 rounded-full border border-accent/40 motion-safe:animate-[rank-halo_1.4s_ease-out_both] motion-reduce:hidden" />
          <span className="absolute size-36 rounded-full border border-accent/25 motion-safe:animate-[rank-halo_1.4s_ease-out_180ms_both] motion-reduce:hidden" />
          <div className="relative size-40 motion-safe:animate-[rank-crest_900ms_cubic-bezier(.16,1,.3,1)_180ms_both]">
            <Image
              src={`/images/concern-rewards/ranks/${rank.replaceAll("_", "-")}.png`}
              alt=""
              fill
              sizes="160px"
              priority
              className="object-contain drop-shadow-[0_18px_32px_color-mix(in_oklab,var(--isms-accent)_36%,transparent)]"
            />
          </div>
        </div>
        <div className="relative flex flex-col gap-3">
          <p className="text-xs font-bold tracking-[0.16em] text-accent uppercase">
            {t("eyebrow")}
          </p>
          <DialogTitle className="text-3xl tracking-[-0.03em]">
            {t("title", { rank: rankName })}
          </DialogTitle>
          <DialogDescription className="mx-auto max-w-[44ch] text-[15px]">
            {t("body")}
          </DialogDescription>
        </div>
        <DialogFooter className="relative mt-3 sm:justify-center">
          <DialogClose render={<Button variant="primary" className="sm:min-w-40" />}>
            {t("continue")}
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
