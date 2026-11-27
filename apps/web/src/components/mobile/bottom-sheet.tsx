import type { ReactNode } from "react";
import {
  Sheet,
  SheetDescription,
  SheetHeader,
  SheetPanel,
  SheetPopup,
  SheetTitle,
} from "@reeve/ui/components/sheet";
import { cn } from "@reeve/ui/lib/utils";

/** A sheet that rises from the bottom of a phone screen, as Actual's mobile modals do. */
export function BottomSheet({
  open,
  onOpenChange,
  title,
  description,
  footer,
  className,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  /** Kept in view under the scrolling content, as the sheet's actions. */
  footer?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetPopup
        side="bottom"
        className={cn(
          "max-h-[calc(100svh-3rem)] rounded-t-2xl border-x-0 pb-[env(safe-area-inset-bottom)]",
          className,
        )}
      >
        <span aria-hidden className="mx-auto mt-2 h-1 w-9 shrink-0 rounded-full bg-border" />
        <SheetHeader className="gap-1 px-4 pt-2 pb-3">
          <SheetTitle className="pe-8 text-lg">{title}</SheetTitle>
          {description && <SheetDescription>{description}</SheetDescription>}
        </SheetHeader>
        <SheetPanel className="px-4 pt-0 pb-4">{children}</SheetPanel>
        {footer && <div className="flex shrink-0 gap-2 border-t px-4 py-3">{footer}</div>}
      </SheetPopup>
    </Sheet>
  );
}
