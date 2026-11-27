import { useState } from "react";
import { cn } from "@reeve/ui/lib/utils";

/** Real captures of the app on a seeded scratch book, made by `pnpm --filter landing screenshots`. */
const SCREENS = [
  {
    id: "home",
    label: "Home",
    caption: "A dashboard of what you spent, what is waiting to be budgeted, and what comes next.",
  },
  {
    id: "budget",
    label: "Budget",
    caption: "Envelope budgeting: give every dollar a job, and leftovers roll into next month.",
  },
  {
    id: "transactions",
    label: "Transactions",
    caption: "One register across every account, with transfers, splits and cleared state.",
  },
  {
    id: "sankey",
    label: "Sankey",
    caption: "Follow money from payees through income and accounts into every category.",
  },
  {
    id: "net-worth",
    label: "Net worth",
    caption: "Assets and debts month by month, read straight from the ledger.",
  },
] as const;

export function Screens() {
  const [current, setCurrent] = useState<(typeof SCREENS)[number]["id"]>("home");
  const screen = SCREENS.find((s) => s.id === current) ?? SCREENS[0];
  return (
    <section className="mx-auto mt-24 w-full max-w-[1296px] scroll-mt-24 px-2 sm:px-4" id="tour">
      <div className="flex justify-center">
        <div
          className="flex max-w-full gap-1 overflow-x-auto rounded-xl bg-muted p-1"
          role="tablist"
        >
          {SCREENS.map((s) => (
            <button
              aria-selected={s.id === current}
              className={cn(
                "h-9 shrink-0 cursor-pointer rounded-lg px-4 font-medium text-sm transition-colors",
                s.id === current
                  ? "bg-background text-foreground shadow-xs/5"
                  : "text-muted-foreground hover:text-foreground",
              )}
              key={s.id}
              onClick={() => setCurrent(s.id)}
              role="tab"
              type="button"
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>
      <figure className="mt-6">
        <div className="relative overflow-hidden rounded-[28px] bg-[#0B3A2E] px-3 pt-3 sm:px-14 sm:pt-14">
          <div
            aria-hidden
            className="absolute inset-0 bg-[radial-gradient(rgb(255_255_255/0.14)_1px,transparent_1.2px)] bg-size-[6px_6px] [mask-image:radial-gradient(ellipse_at_top,black,transparent_75%)]"
          />
          <div className="relative overflow-hidden rounded-t-xl shadow-2xl ring-1 ring-black/10 sm:rounded-t-2xl">
            <img
              alt={`reeve's ${screen.label} page`}
              className="block aspect-[1440/860] w-full object-cover object-top dark:hidden"
              src={`/screens/${screen.id}-light.png`}
            />
            <img
              alt={`reeve's ${screen.label} page`}
              className="hidden aspect-[1440/860] w-full object-cover object-top dark:block"
              src={`/screens/${screen.id}-dark.png`}
            />
          </div>
        </div>
        <figcaption className="mt-4 text-center text-muted-foreground text-sm">
          {screen.caption}
        </figcaption>
      </figure>
    </section>
  );
}
