import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { XIcon } from "lucide-react";
import type { ComponentProps } from "react";
import { cn } from "../lib/cn";
import { Button } from "./button";

function Dialog(props: DialogPrimitive.Root.Props) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />;
}

function DialogTrigger(props: DialogPrimitive.Trigger.Props) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />;
}

function DialogClose(props: DialogPrimitive.Close.Props) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />;
}

/** Overlay and popup motion share the --motion-* tokens, so reduced motion is instant. */
const fade =
  "transition-[opacity,scale,translate] duration-(--motion-base) ease-standard data-starting-style:opacity-0 data-ending-style:opacity-0";

function DialogOverlay({ className, ...props }: DialogPrimitive.Backdrop.Props) {
  return (
    <DialogPrimitive.Backdrop
      data-slot="dialog-overlay"
      className={cn("fixed inset-0 z-50 bg-overlay", fade, className)}
      {...props}
    />
  );
}

type DialogContentProps = DialogPrimitive.Popup.Props & {
  /** Where to portal the dialog; defaults to document.body. */
  container?: DialogPrimitive.Portal.Props["container"];
  showCloseButton?: boolean;
  /** Accessible name of the close button (translate in the app). */
  closeLabel?: string;
};

/** Opaque glass: the translucent surface composited over the page colour. */
const popupSurface =
  "rounded-lg border border-surface-border bg-bg bg-[image:linear-gradient(var(--isms-surface),var(--isms-surface))] font-sans text-sm text-fg shadow-float outline-none";

function DialogContent({
  className,
  children,
  container,
  showCloseButton = true,
  closeLabel = "Close",
  ...props
}: DialogContentProps) {
  return (
    <DialogPrimitive.Portal container={container}>
      <DialogOverlay />
      <DialogPrimitive.Popup
        data-slot="dialog-content"
        className={cn(
          "fixed top-1/2 left-1/2 z-50 grid w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 gap-4 p-6 sm:max-w-md",
          popupSurface,
          fade,
          "data-starting-style:scale-[0.97] data-ending-style:scale-[0.97]",
          className,
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close
            data-slot="dialog-close"
            aria-label={closeLabel}
            render={
              <Button
                variant="ghost"
                size="sm"
                className="absolute top-3 right-3 w-8 px-0 text-fg-muted hover:text-fg"
              />
            }
          >
            <XIcon aria-hidden="true" />
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Popup>
    </DialogPrimitive.Portal>
  );
}

function DialogHeader({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex flex-col gap-1.5 pr-8", className)}
      {...props}
    />
  );
}

function DialogFooter({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn("mt-2 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end", className)}
      {...props}
    />
  );
}

function DialogTitle({ className, ...props }: DialogPrimitive.Title.Props) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn("text-lg leading-tight font-bold tracking-[-0.015em]", className)}
      {...props}
    />
  );
}

function DialogDescription({ className, ...props }: DialogPrimitive.Description.Props) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn("leading-relaxed text-fg-muted", className)}
      {...props}
    />
  );
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogTitle,
  DialogTrigger,
};
export type { DialogContentProps };
