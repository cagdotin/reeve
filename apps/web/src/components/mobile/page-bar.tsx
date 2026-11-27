import { Link, useRouterState } from "@tanstack/react-router";
import { SearchIcon } from "lucide-react";
import { cn } from "@reeve/ui/lib/utils";
import { useBook } from "@/lib/book";
import { useCommands } from "@/lib/commands";
import { destinationPlace, usePlaces } from "@/lib/home-session";
import { DESTINATIONS, destinationOf } from "@/lib/nav";

const ITEM =
  "flex size-9 items-center justify-center rounded-lg outline-none transition-colors duration-150 ease-fey focus-visible:ring-2 focus-visible:ring-ring [&>svg]:size-[18px]";

/** The pages along the foot of a phone's window, with search. */
export function PageBar() {
  const path = useRouterState({ select: (state) => state.location.pathname });
  const setCommands = useCommands();
  const { id: book } = useBook();
  usePlaces();
  const here = destinationOf(path);
  return (
    <nav
      aria-label="Pages"
      className="flex w-full shrink-0 flex-row items-center justify-around border-t px-1 py-1 pb-[max(0.25rem,env(safe-area-inset-bottom))]"
    >
      {DESTINATIONS.map((destination) => (
        <Link
          key={destination.id}
          {...destinationPlace(book, destination)}
          aria-label={destination.label}
          aria-current={here?.id === destination.id ? "page" : undefined}
          draggable={false}
          className={cn(ITEM, here?.id === destination.id ? "text-mark" : "text-muted-foreground")}
        >
          <destination.icon />
        </Link>
      ))}
      <button
        type="button"
        aria-label="Search"
        onClick={() => setCommands(true)}
        className={cn(ITEM, "cursor-pointer text-muted-foreground")}
      >
        <SearchIcon />
      </button>
    </nav>
  );
}
