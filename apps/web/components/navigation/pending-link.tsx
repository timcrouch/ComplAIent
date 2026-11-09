"use client";

import { cn } from "@isms/ui";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ComponentProps, type ReactNode } from "react";

type PendingLinkProps = Omit<ComponentProps<typeof Link>, "children" | "onNavigate"> & {
  children: ReactNode | ((pending: boolean) => ReactNode);
  pendingLabel: string;
  pendingClassName?: string;
  indicatorClassName?: string;
  showIndicator?: boolean;
};

/**
 * A client-side link that acknowledges a slow navigation without changing its layout.
 * A second activation of the same link is ignored; other links remain available.
 */
export function PendingLink({
  children,
  className,
  pendingLabel,
  pendingClassName,
  indicatorClassName,
  showIndicator = true,
  ...props
}: PendingLinkProps) {
  const pathname = usePathname();
  const requested = useRef(false);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    requested.current = false;
    setPending(false);
  }, [pathname]);

  const navigate = (event: { preventDefault: () => void }) => {
    if (requested.current) {
      event.preventDefault();
      return;
    }
    requested.current = true;
    setPending(true);
  };

  return (
    <>
      <Link
        {...props}
        onNavigate={navigate}
        aria-busy={pending || undefined}
        aria-disabled={pending || undefined}
        className={cn(className, pending && pendingClassName)}
      >
        {typeof children === "function" ? children(pending) : children}
        {showIndicator ? (
          <span
            aria-hidden
            data-link-pending-slot=""
            className={cn("relative inline-flex size-4 shrink-0", indicatorClassName)}
          >
            {pending ? (
              <span
                data-link-pending-indicator=""
                className="absolute inset-[2px] animate-spin rounded-full border-2 border-current border-t-transparent motion-reduce:animate-none"
              />
            ) : null}
          </span>
        ) : null}
      </Link>
      {pending ? (
        <span role="status" aria-live="polite" className="sr-only">
          {pendingLabel}
        </span>
      ) : null}
    </>
  );
}
