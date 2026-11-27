import { Link, useRouter, useRouterState } from "@tanstack/react-router";
import { LayoutGroup, m } from "motion/react";
import { ChevronLeftIcon, ChevronsUpDownIcon, type LucideIcon } from "lucide-react";
import { useEffect, useRef, type ReactElement } from "react";
import { Button } from "@reeve/ui/components/button";
import { Kbd } from "@reeve/ui/components/kbd";
import { ScrollArea } from "@reeve/ui/components/scroll-area";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@reeve/ui/components/tooltip";
import { cn } from "@reeve/ui/lib/utils";
import { AppMark } from "@/components/app-logo";
import { BookSwitcher } from "@/components/book-switcher";
import { useBook } from "@/lib/book";
import { destinationPlace, usePlaces } from "@/lib/home-session";
import { DESTINATIONS, destinationOf, STEWARD, type Destination } from "@/lib/nav";

const SPRING = { type: "spring", stiffness: 420, damping: 36 } as const;
const PAGES = DESTINATIONS.filter((destination) => destination.sidebar !== true);
const ROW =
  "group/row relative flex h-8 w-full items-center gap-2.5 overflow-hidden rounded-lg px-3 text-left text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring";
const QUIET = "cursor-pointer text-muted-foreground hover:bg-accent hover:text-foreground";

/** Names a row only once the sidebar folds its label away. */
function Tip({
  collapsed,
  label,
  hotkey,
  children,
}: {
  collapsed: boolean;
  label: string;
  hotkey?: string | undefined;
  children: ReactElement;
}) {
  return (
    <Tooltip disabled={!collapsed}>
      <TooltipTrigger render={children} />
      <TooltipPopup side="right" sideOffset={10}>
        <span className="flex items-center gap-2">
          {label}
          {hotkey !== undefined && <Kbd className="uppercase">{hotkey}</Kbd>}
        </span>
      </TooltipPopup>
    </Tooltip>
  );
}

function RowBody({
  icon: Icon,
  label,
  hotkey,
  collapsed,
}: {
  icon: LucideIcon;
  label: string;
  hotkey?: string | undefined;
  collapsed: boolean;
}) {
  return (
    <>
      <Icon className="relative size-4 shrink-0" />
      <span
        className={cn(
          "relative min-w-0 flex-1 truncate font-medium transition-opacity duration-200",
          collapsed && "opacity-0",
        )}
      >
        {label}
      </span>
      {hotkey !== undefined && (
        <Kbd
          className={cn(
            "relative uppercase opacity-0 transition-opacity group-hover/row:opacity-100",
            collapsed && "invisible",
          )}
        >
          {hotkey}
        </Kbd>
      )}
    </>
  );
}

function PageLink({
  destination,
  here,
  collapsed,
}: {
  destination: Destination;
  here: Destination | undefined;
  collapsed: boolean;
}) {
  const { id: book } = useBook();
  usePlaces();
  const active = here?.id === destination.id;
  return (
    <Tip collapsed={collapsed} label={destination.label} hotkey={destination.hotkey}>
      <Link
        {...destinationPlace(book, destination)}
        aria-label={destination.label}
        aria-current={active ? "page" : undefined}
        draggable={false}
        className={cn(ROW, active ? "text-foreground" : QUIET)}
      >
        {active && (
          <m.span
            layoutId="sidebar-pill"
            transition={SPRING}
            className="absolute inset-0 rounded-lg bg-background shadow-xs/5 ring-1 ring-border dark:bg-accent dark:ring-0"
          />
        )}
        <RowBody
          icon={destination.icon}
          label={destination.label}
          hotkey={destination.hotkey}
          collapsed={collapsed}
        />
      </Link>
    </Tip>
  );
}

function BookRow({ collapsed }: { collapsed: boolean }) {
  const { book } = useBook();
  return (
    <BookSwitcher
      trigger={
        <button
          type="button"
          aria-label={`Book: ${book.settings.name}`}
          className="flex h-8 w-full cursor-pointer items-center gap-1.5 overflow-hidden rounded-lg ps-2 pe-3 text-left text-sm outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring data-popup-open:bg-accent"
        />
      }
    >
      <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-background ring-1 ring-border dark:bg-accent dark:ring-0">
        <AppMark />
      </span>
      <span
        className={cn(
          "min-w-0 flex-1 truncate font-medium transition-opacity duration-200",
          collapsed && "opacity-0",
        )}
      >
        {book.settings.name}
      </span>
      <ChevronsUpDownIcon
        className={cn("size-3.5 shrink-0 text-muted-foreground", collapsed && "opacity-0")}
      />
    </BookSwitcher>
  );
}

/** A destination's own list over the sidebar, and the way back to the page it was opened from. */
function SidebarLayer({
  onBack,
  onSlot,
}: {
  onBack: () => void;
  onSlot: (slot: HTMLElement | null) => void;
}) {
  return (
    <>
      <div className="px-2 pt-0.5 pb-2">
        <Button variant="ghost" className="w-full justify-start" onClick={onBack}>
          <ChevronLeftIcon />
          Back to app
        </Button>
      </div>
      <div ref={onSlot} className="flex min-h-0 flex-1 flex-col" />
    </>
  );
}

/**
 * Book and pages at the window's left, folding down to a rail of icons. On a
 * destination with a sidebar of its own, that list takes its place.
 */
export function AppSidebar({
  collapsed,
  layered,
  onLayerSlot,
}: {
  collapsed: boolean;
  layered: boolean;
  onLayerSlot: (slot: HTMLElement | null) => void;
}) {
  const path = useRouterState({ select: (state) => state.location.pathname });
  const href = useRouterState({ select: (state) => state.location.href });
  const here = destinationOf(path);
  const router = useRouter();
  const returnTo = useRef("/");
  useEffect(() => {
    if (!layered) returnTo.current = href;
  }, [layered, href]);
  if (layered)
    return (
      <aside aria-label="Sidebar" className="flex w-64 shrink-0 flex-col overflow-hidden">
        <SidebarLayer onBack={() => router.history.push(returnTo.current)} onSlot={onLayerSlot} />
      </aside>
    );
  return (
    <aside
      aria-label="Sidebar"
      className={cn(
        "flex shrink-0 flex-col overflow-hidden whitespace-nowrap transition-[width] duration-200 ease-fey",
        collapsed ? "w-14" : "w-64",
      )}
    >
      <div className="px-2 pt-0.5 pb-2">
        <BookRow collapsed={collapsed} />
      </div>
      <LayoutGroup id="sidebar">
        <nav aria-label="Pages" className="flex min-h-0 flex-1 flex-col">
          <ScrollArea scrollFade className="min-h-0 flex-1">
            <div className="flex flex-col gap-0.5 px-2">
              {PAGES.map((destination) => (
                <PageLink
                  key={destination.id}
                  destination={destination}
                  here={here}
                  collapsed={collapsed}
                />
              ))}
              <Tip collapsed={collapsed} label={`${STEWARD.label}: coming soon`}>
                <button
                  type="button"
                  aria-label={STEWARD.label}
                  aria-disabled
                  className={cn(ROW, "cursor-default text-muted-foreground/40")}
                >
                  <RowBody icon={STEWARD.icon} label={STEWARD.label} collapsed={collapsed} />
                </button>
              </Tip>
            </div>
          </ScrollArea>
        </nav>
      </LayoutGroup>
    </aside>
  );
}
