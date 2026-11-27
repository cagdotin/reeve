import type { Category } from "@reeve/contract";
import { kindOf } from "@reeve/contract/targets";
import type { LucideIcon } from "lucide-react";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@reeve/ui/components/tooltip";
import { cn } from "@reeve/ui/lib/utils";
import { ICONS, LEFTOVER_ICON } from "@/components/budget/targets/icons";
import { hasTargets, useCategoryTargets } from "@/components/budget/targets/use-targets";

/**
 * A category's targets as the icons of their kinds, with them as sentences in a tooltip. It opens
 * the target editor; a category without targets gets one from its menu.
 */
export function TargetButton({
  category,
  onOpen,
  className,
}: {
  category: Category;
  onOpen: () => void;
  className?: string;
}) {
  const targets = useCategoryTargets(category.id);
  if (!hasTargets(targets)) return null;
  const icons: Array<[string, LucideIcon]> = [...new Set(targets.targets.map(kindOf))].map(
    (kind) => [kind, ICONS[kind]],
  );
  if (targets.leftovers.length > 0) icons.push(["leftovers", LEFTOVER_ICON]);
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label={`${category.name} targets`}
            onClick={onOpen}
            className={cn(
              "flex h-5 shrink-0 cursor-pointer items-center gap-1 rounded px-0.5 text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
              className,
            )}
          />
        }
      >
        {icons.map(([key, Icon]) => (
          <Icon key={key} className="size-3.5" />
        ))}
      </TooltipTrigger>
      <TooltipPopup className="max-w-72">
        <ul className="grid gap-1 py-0.5 text-xs">
          {targets.sentences.map((sentence) => (
            <li key={sentence}>{sentence}</li>
          ))}
        </ul>
      </TooltipPopup>
    </Tooltip>
  );
}
