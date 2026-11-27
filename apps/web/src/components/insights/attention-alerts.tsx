import { Button } from "@reeve/ui/components/button";
import { PageAlert } from "@/components/page-alert";

export interface AttentionCheck {
  readonly id: string;
  /** How many fail it; the check passes at zero. */
  readonly count: number;
  /** What follows the count while it fails. */
  readonly open: string;
  /** What it says once it passes. */
  readonly done: string;
  readonly title?: string;
}

/** Each open check as a strip along the page's top, as the budget's uncategorized warning; its button narrows the page. */
export function AttentionAlerts<Item extends AttentionCheck>({
  items,
  isActive,
  onChoose,
}: {
  items: ReadonlyArray<Item>;
  isActive: (item: Item) => boolean;
  onChoose: (item: Item) => void;
}) {
  return items
    .filter((item) => item.count > 0)
    .map((item) => {
      const active = isActive(item);
      const name = `${item.count} ${item.open}`;
      return (
        <PageAlert
          key={item.id}
          variant="warning"
          title={name}
          action={
            <Button
              variant="ghost"
              aria-pressed={active}
              aria-label={name}
              title={item.title}
              onClick={() => onChoose(item)}
            >
              {active ? "Show all" : "Show"}
            </Button>
          }
        />
      );
    });
}
