import {
  CircleCheckIcon,
  CircleQuestionMarkIcon,
  InfoIcon,
  OctagonXIcon,
  TriangleAlertIcon,
  type LucideIcon,
} from "lucide-react";
import type { ComponentProps } from "react";
import { cn } from "../lib/cn";

type Status = "ok" | "attention" | "aboveAppetite" | "critical" | "info" | "unknown";

const statusStyles: Record<Status, { icon: LucideIcon; className: string }> = {
  ok: { icon: CircleCheckIcon, className: "bg-ok-soft text-ok" },
  attention: { icon: TriangleAlertIcon, className: "bg-attention-soft text-attention" },
  aboveAppetite: { icon: TriangleAlertIcon, className: "bg-critical-soft text-critical" },
  critical: { icon: OctagonXIcon, className: "bg-critical-soft text-critical" },
  info: { icon: InfoIcon, className: "bg-info-soft text-info" },
  unknown: {
    icon: CircleQuestionMarkIcon,
    className: "border border-dashed border-control-border bg-surface text-fg-muted",
  },
};

type StatusBadgeProps = Omit<ComponentProps<"span">, "children"> & {
  status: Status;
  /** Required visible text: status is never conveyed by colour or icon alone. */
  label: string;
};

function StatusBadge({ status, label, className, ...props }: StatusBadgeProps) {
  const { icon: Icon, className: tone } = statusStyles[status];
  return (
    <span
      data-slot="status-badge"
      data-status={status}
      className={cn(
        "inline-flex h-6 w-fit items-center gap-1.5 rounded-full pr-2.5 pl-2 font-sans text-xs leading-none font-semibold whitespace-nowrap",
        tone,
        className,
      )}
      {...props}
    >
      <Icon aria-hidden="true" strokeWidth={2.25} className="size-3.5 shrink-0" />
      <span>{label}</span>
    </span>
  );
}

export { StatusBadge };
export type { Status, StatusBadgeProps };
