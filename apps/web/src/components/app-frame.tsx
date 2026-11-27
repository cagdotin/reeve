import { useRouter, useRouterState } from "@tanstack/react-router";
import { ArrowLeftIcon, PanelLeftIcon, SearchIcon } from "lucide-react";
import { useMemo, useRef, useState, type ReactNode } from "react";
import { Button } from "@reeve/ui/components/button";
import { ScrollArea } from "@reeve/ui/components/scroll-area";
import { Kbd } from "@reeve/ui/components/kbd";
import { cn } from "@reeve/ui/lib/utils";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@reeve/ui/components/tooltip";
import { useIsMobile } from "@reeve/ui/hooks/use-media-query";
import { useCommands } from "@/lib/commands";
import { destinationOf, leadOf, type PageLead } from "@/lib/nav";
import { sidebarCollapsed } from "@/lib/prefs";
import { useScrollMemory } from "@/lib/scroll-memory";
import { AccountScopeMenu } from "@/components/account-scope-menu";
import { HistoryButtons } from "@/components/history-buttons";
import { AppNav } from "@/components/app-nav";
import { PageAlertSlot } from "@/components/page-alert";
import { SlotsContext } from "@/components/page-slots";
import { SectionTabs } from "@/components/section-tabs";
import { SplitPanelHost } from "@/components/split-panel";
import { SyncAlert } from "@/components/sync-indicator";

/**
 * The bar's left part keeps to the sidebar's width, less the sidebar's gutter, so the history buttons end
 * where its rows do. Folded, it holds just its controls: a 24px toggle, 24px of search, two 4px gaps and 50px of history.
 */
const TITLE_BAR_OPEN = "w-62";
const TITLE_BAR_FOLDED = "w-[114px] windowed-mac:w-[190px]";

const startsCollapsed = () => {
  const saved = sidebarCollapsed.get();
  return saved === null ? window.innerWidth < 1024 : saved === "1";
};

function SidebarToggle({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const label = collapsed ? "Expand sidebar" : "Collapse sidebar";
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={label}
            aria-expanded={!collapsed}
            className="app-no-drag"
            onClick={onToggle}
          />
        }
      >
        <PanelLeftIcon />
      </TooltipTrigger>
      <TooltipPopup>
        <span className="flex items-center gap-2">
          {label}
          <Kbd>⌘B</Kbd>
        </span>
      </TooltipPopup>
    </Tooltip>
  );
}

function SearchButton() {
  const setCommands = useCommands();
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Search and commands"
            className="app-no-drag"
            onClick={() => setCommands(true)}
          />
        }
      >
        <SearchIcon />
      </TooltipTrigger>
      <TooltipPopup>
        <span className="flex items-center gap-2">
          Search
          <Kbd>⌘K</Kbd>
        </span>
      </TooltipPopup>
    </Tooltip>
  );
}

/**
 * The window: a bar across its top that drags it and holds the sidebar's toggle, search and history, the page's
 * tabs or title and what it shows of its tab, and at its end the page's actions and, last, the account scope, a bar across
 * its foot with the connection, and between them the sidebar beside a rounded inset with one scrolling page. A phone has neither bar: a bar of pages runs
 * along its foot and the header's contents open the page, the tabs stuck to its top; whatever else sticks
 * sits under them at `--sticky-top`. The account scope and the tabs belong to the frame and not to a page, so that
 * a menu stays open and the pill keeps sliding when the page under them arrives or changes.
 */
export function AppFrame({ children }: { children: ReactNode }) {
  const [title, setTitle] = useState<HTMLElement | null>(null);
  const [actions, setActions] = useState<HTMLElement | null>(null);
  const [context, setContext] = useState<HTMLElement | null>(null);
  const [layer, setLayer] = useState<HTMLElement | null>(null);
  const [alerts, setAlerts] = useState<HTMLElement | null>(null);
  const [foldedByChoice, setFoldedByChoice] = useState(startsCollapsed);
  const mobile = useIsMobile();
  const path = useRouterState({ select: (state) => state.location.pathname });
  const page = useRef<HTMLDivElement>(null);
  const slots = useMemo(
    () => ({ title, actions, context, layer }),
    [title, actions, context, layer],
  );
  const destination = destinationOf(path);
  const lead = leadOf(path);
  const scoped = destination?.scoped === true;
  const layered = destination?.sidebar === true;
  const collapsed = foldedByChoice && !layered;
  const toggle = () => {
    sidebarCollapsed.set(collapsed ? "0" : "1");
    setFoldedByChoice(!collapsed);
  };

  const dashboard = useRouterState({ select: (state) => state.location.search.dashboard });
  useScrollMemory(page, path.startsWith("/accounts/") ? "/accounts" : `${path}?${dashboard}`);

  return (
    <div className="relative flex h-svh flex-col overflow-hidden bg-sidebar max-md:bg-background max-md:pt-[env(safe-area-inset-top)]">
      {!mobile && (
        <header
          data-slot="title-bar"
          className="flex h-10 shrink-0 items-center select-none app-drag"
        >
          <div
            className={cn(
              "flex items-center gap-1 pl-2 transition-[width] duration-200 ease-fey windowed-mac:pl-21",
              collapsed ? TITLE_BAR_FOLDED : TITLE_BAR_OPEN,
            )}
          >
            {!layered && <SidebarToggle collapsed={collapsed} onToggle={toggle} />}
            <SearchButton />
            <HistoryButtons className="ms-auto" />
          </div>
          <div className="ms-2 flex h-full min-w-0 flex-1 items-center gap-1">
            <Lead lead={lead} onTitleSlot={setTitle} />
            <div
              ref={setContext}
              data-slot="bar-context"
              className="ms-1 flex min-w-0 items-center app-no-drag empty:hidden"
            />
          </div>
          <div
            data-slot="bar-actions"
            className="ms-2 flex shrink-0 items-center gap-1.5 pe-2 app-no-drag [&_svg]:size-3.5!"
          >
            <div ref={setActions} className="contents" />
            {scoped && <AccountScopeMenu />}
          </div>
        </header>
      )}
      <AppNav
        collapsed={collapsed}
        layered={layered}
        onToggleCollapsed={toggle}
        onLayerSlot={setLayer}
      >
        <SplitPanelHost>
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background md:rounded-2xl md:border md:shadow-xs/5">
              <div
                ref={setAlerts}
                data-slot="page-alerts"
                className="flex shrink-0 flex-col empty:hidden"
              />
              <ScrollArea
                className="min-h-0 flex-1"
                contentClassName="min-h-full"
                viewportRef={page}
              >
                <div
                  data-slot="page"
                  className="flex min-h-full w-full flex-col [--page-gutter:--spacing(8)] has-data-[slot=section-tabs]:[--sticky-top:2.8125rem] [--sticky-top:0px] max-md:[--page-gutter:--spacing(4)]"
                >
                  {mobile && (
                    <>
                      <Lead lead={lead} onTitleSlot={setTitle} />
                      <div className="flex flex-wrap items-center gap-1.5 px-(--page-gutter) has-[>:not(:empty)]:pt-3">
                        <div ref={setContext} className="contents" />
                        <div ref={setActions} className="contents" />
                        {scoped && <AccountScopeMenu />}
                      </div>
                    </>
                  )}
                  <PageAlertSlot slot={alerts}>
                    <SyncAlert />
                    <SlotsContext.Provider value={slots}>{children}</SlotsContext.Provider>
                  </PageAlertSlot>
                </div>
              </ScrollArea>
            </div>
          </div>
        </SplitPanelHost>
      </AppNav>
    </div>
  );
}

function BackButton({ to }: { to: string }) {
  const router = useRouter();
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label="Back"
      onClick={() => void router.navigate({ to })}
    >
      <ArrowLeftIcon />
    </Button>
  );
}

/**
 * No wrapper around the two: a phone's tabs stick only as children of the page, since a wrapper would scroll
 * away with them. The slot takes the page's title, which shows only beside the arrow.
 */
function Lead({
  lead,
  onTitleSlot,
}: {
  lead: PageLead;
  onTitleSlot: (slot: HTMLElement | null) => void;
}) {
  return (
    <>
      <div
        className={
          lead.kind === "back"
            ? "flex min-w-0 items-center gap-1 app-no-drag max-md:px-2 max-md:pt-2"
            : "sr-only"
        }
      >
        {lead.kind === "back" && <BackButton to={lead.to} />}
        <div ref={onTitleSlot} className="contents" />
      </div>
      {lead.kind === "tabs" && <SectionTabs destination={lead.destination} />}
    </>
  );
}
