import { CircleAlertIcon, CircleCheckIcon, InfoIcon, TriangleAlertIcon } from "lucide-react";
import { createContext, useContext, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "@reeve/ui/lib/utils";

/** In the order they stack: a failure is never pushed below a notice, and only a failure interrupts a screen reader. */
const VARIANTS = {
  error: {
    icon: CircleAlertIcon,
    tone: "order-1 bg-destructive/8 text-destructive-foreground",
    role: "alert",
  },
  warning: {
    icon: TriangleAlertIcon,
    tone: "order-2 bg-warning/8 text-warning-foreground",
    role: "status",
  },
  info: { icon: InfoIcon, tone: "order-3 bg-info/8 text-info-foreground", role: "status" },
  success: {
    icon: CircleCheckIcon,
    tone: "order-4 bg-success/8 text-success-foreground",
    role: "status",
  },
} as const;

const SlotContext = createContext<HTMLElement | null>(null);

export function PageAlertSlot({
  slot,
  children,
}: {
  slot: HTMLElement | null;
  children: ReactNode;
}) {
  return <SlotContext.Provider value={slot}>{children}</SlotContext.Provider>;
}

/** What a person should know or act on about this page, in a strip along its top, wherever it is rendered. */
export function PageAlert({
  variant,
  title,
  action,
  children,
}: {
  variant: keyof typeof VARIANTS;
  title: ReactNode;
  action?: ReactNode;
  children?: ReactNode;
}) {
  const slot = useContext(SlotContext);
  if (slot === null) return null;
  const { icon: Icon, tone, role } = VARIANTS[variant];
  return createPortal(
    <div
      role={role}
      data-variant={variant}
      className={cn("flex min-h-9 items-center gap-2 border-b px-4 py-1 text-[13px]", tone)}
    >
      <Icon className="size-3.5 shrink-0" />
      <p className="min-w-0 flex-1">
        <span className="font-medium">{title}</span>
        {children !== undefined && <span className="ms-1.5">{children}</span>}
      </p>
      {action !== undefined && <div className="shrink-0">{action}</div>}
    </div>,
    slot,
  );
}
