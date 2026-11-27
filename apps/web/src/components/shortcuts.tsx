import { FEATURES } from "@reeve/contract/features";
import { Link } from "@tanstack/react-router";
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "@reeve/ui/components/dialog";
import { Kbd } from "@reeve/ui/components/kbd";
import { DESTINATIONS } from "@/lib/nav";

const GROUPS: ReadonlyArray<{
  label: string;
  keys: ReadonlyArray<readonly [string, string]>;
}> = [
  {
    label: "Anywhere",
    keys: [
      ["⌘K", "Search and commands"],
      ["/", "Search and commands"],
      ["⌘B", "Fold the sidebar"],
      ["?", "This list"],
      ["⌘Z", "Undo"],
      ["⇧⌘Z", "Redo"],
    ],
  },
  {
    label: "Go to",
    keys: DESTINATIONS.flatMap((destination) => [
      [destination.hotkey, destination.label] as const,
      ...destination.tabs.flatMap((tab) =>
        tab.hotkey === undefined ? [] : [[tab.hotkey, tab.label] as const],
      ),
    ]),
  },
  {
    label: "Budget",
    keys: [
      ["←", "Previous month"],
      ["→", "Next month"],
      ["T", "This month"],
    ],
  },
  {
    label: FEATURES.purchases ? "Transactions and receipts" : "Transactions",
    keys: [
      ["N", "Add one"],
      ["Esc", "Clear the selection"],
    ],
  },
];

/** The cheat sheet, on `?` from anywhere. */
export function ShortcutsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Shortcuts</DialogTitle>
          <DialogDescription>
            Single keys work whenever you aren't typing. More in the{" "}
            <Link
              to="/docs/$"
              params={{ _splat: "" }}
              onClick={() => onOpenChange(false)}
              className="underline"
            >
              docs
            </Link>
            .
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <div className="grid grid-cols-2 gap-x-8 gap-y-5 max-md:grid-cols-1">
            {GROUPS.map((group) => (
              <section key={group.label}>
                <h3 className="pb-1 text-xs text-muted-foreground">{group.label}</h3>
                <ul>
                  {group.keys.map(([key, label]) => (
                    <li
                      key={`${key}${label}`}
                      className="flex h-7 items-center justify-between gap-3 text-[13px]"
                    >
                      {label}
                      <Kbd className="uppercase">{key}</Kbd>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  );
}
