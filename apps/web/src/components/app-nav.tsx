import { useNavigate } from "@tanstack/react-router";
import { useCallback, useState, type ReactNode } from "react";
import { useIsMobile } from "@reeve/ui/hooks/use-media-query";
import { AppFooter } from "@/components/app-footer";
import { AppSidebar } from "@/components/app-sidebar";
import { PageBar } from "@/components/mobile/page-bar";
import { ShortcutsDialog } from "@/components/shortcuts";
import { ShortcutsContext, useCommands } from "@/lib/commands";
import { useHotkeys } from "@/lib/hotkeys";
import { useBook } from "@/lib/book";
import { destinationPlace, tabPlace } from "@/lib/home-session";
import { DESTINATIONS } from "@/lib/nav";

/** The sidebar at the window's left, a bar along its foot on a phone, and the keys that go with them. */
export function AppNav({
  collapsed,
  layered,
  onToggleCollapsed,
  onLayerSlot,
  children,
}: {
  collapsed: boolean;
  layered: boolean;
  onToggleCollapsed: () => void;
  onLayerSlot: (slot: HTMLElement | null) => void;
  children: ReactNode;
}) {
  const navigate = useNavigate();
  const { id: book } = useBook();
  const setCommands = useCommands();
  const mobile = useIsMobile();
  const [shortcuts, setShortcuts] = useState(false);
  const showShortcuts = useCallback(() => setShortcuts(true), []);

  useHotkeys({
    ...Object.fromEntries(
      DESTINATIONS.flatMap((destination) => [
        [destination.hotkey, () => void navigate(destinationPlace(book, destination))],
        ...destination.tabs.flatMap((tab) =>
          tab.hotkey === undefined
            ? []
            : [[tab.hotkey, () => void navigate(tabPlace(book, tab))] as const],
        ),
      ]),
    ),
    "?": showShortcuts,
    "/": () => setCommands(true),
    "mod+b": () => {
      if (mobile || layered) return false;
      onToggleCollapsed();
      return undefined;
    },
  });

  return (
    <ShortcutsContext.Provider value={showShortcuts}>
      <div className="flex min-h-0 flex-1 max-md:flex-col">
        {!mobile && (
          <AppSidebar collapsed={collapsed} layered={layered} onLayerSlot={onLayerSlot} />
        )}
        {children}
        {mobile && <PageBar />}
      </div>
      {!mobile && <AppFooter />}
      <ShortcutsDialog open={shortcuts} onOpenChange={setShortcuts} />
    </ShortcutsContext.Provider>
  );
}
