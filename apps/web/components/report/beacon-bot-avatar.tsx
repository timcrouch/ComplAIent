import { cn } from "@isms/ui";
import Image from "next/image";

/** Decorative avatar: nearby copy always names BeaconBot and discloses that it is an AI bot. */
export function BeaconBotAvatar({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "relative inline-flex size-9 shrink-0 overflow-hidden rounded-full bg-[#0b1740] shadow-[0_5px_16px_color-mix(in_oklab,var(--isms-accent)_24%,transparent)]",
        className,
      )}
    >
      <Image
        src="/images/reporting/beacon-bot.png"
        alt=""
        fill
        sizes="36px"
        className="object-contain"
      />
    </span>
  );
}
