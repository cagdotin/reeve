import { InfoIcon } from "lucide-react";
import type { ReactNode } from "react";
import {
  PreviewCard,
  PreviewCardPopup,
  PreviewCardTrigger,
} from "@reeve/ui/components/preview-card";
import { cn } from "@reeve/ui/lib/utils";

/** An info mark, after `children` if any, that explains something in a card on hover or focus. */
export function HelpCard({
  label,
  title,
  body,
  align = "end",
  className,
  children,
}: {
  label: string;
  title: string;
  body: ReadonlyArray<string>;
  align?: "start" | "end";
  className?: string;
  children?: ReactNode;
}) {
  return (
    <PreviewCard>
      <PreviewCardTrigger
        render={
          <button
            type="button"
            aria-label={label}
            className={cn(
              "inline-flex cursor-help items-center gap-1 rounded-sm outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
              className,
            )}
          />
        }
      >
        {children}
        <InfoIcon className="size-3.5" />
      </PreviewCardTrigger>
      <PreviewCardPopup align={align} className="w-72 flex-col gap-2 text-[13px]">
        <p className="font-medium">{title}</p>
        {body.map((paragraph) => (
          <p key={paragraph} className="text-muted-foreground">
            {paragraph}
          </p>
        ))}
      </PreviewCardPopup>
    </PreviewCard>
  );
}
