import { ShieldCheckIcon } from "lucide-react";

/** A restrained signal-to-shield acknowledgement: recognition, never a legitimacy verdict. */
export function SignalAcknowledgement() {
  return (
    <div
      aria-hidden
      data-testid="signal-acknowledgement"
      className="relative flex size-20 items-center justify-center"
    >
      <span className="absolute size-14 rounded-full border border-accent/40 motion-safe:animate-[signal-ring_900ms_ease-out_100ms_both] motion-reduce:hidden" />
      <span className="absolute size-14 rounded-full border border-accent/25 motion-safe:animate-[signal-ring_900ms_ease-out_260ms_both] motion-reduce:hidden" />
      <span className="absolute size-2 rounded-full bg-accent shadow-[0_0_20px_color-mix(in_oklab,var(--isms-accent)_70%,transparent)] motion-safe:animate-[signal-beacon_720ms_ease-out_both] motion-reduce:hidden" />
      <span className="relative inline-flex size-12 items-center justify-center rounded-full border border-[color-mix(in_oklab,var(--isms-accent)_38%,transparent)] bg-accent-soft text-accent shadow-[0_10px_28px_color-mix(in_oklab,var(--isms-accent)_18%,transparent)] motion-safe:animate-[signal-shield_850ms_cubic-bezier(.2,.8,.2,1)_420ms_both]">
        <ShieldCheckIcon className="size-6" />
      </span>
    </div>
  );
}
