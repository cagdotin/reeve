import { Link } from "@tanstack/react-router";
import { CircleHelpIcon } from "lucide-react";
import { Button } from "@reeve/ui/components/button";
import { Kbd } from "@reeve/ui/components/kbd";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@reeve/ui/components/tooltip";
import { SyncStatus } from "@/components/sync-indicator";
import { useBook } from "@/lib/book";
import { useShowShortcuts } from "@/lib/commands";
import { destinationPlace } from "@/lib/home-session";
import { DESTINATIONS } from "@/lib/nav";

const UTILITIES = DESTINATIONS.filter(
  (destination) => destination.sidebar === true && destination.id !== "settings",
);

export function AppFooter() {
  const { id: book } = useBook();
  const showShortcuts = useShowShortcuts();
  return (
    <footer className="flex h-9 shrink-0 items-center justify-between px-2 select-none">
      <nav aria-label="Utilities" className="flex items-center gap-1">
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label="Shortcuts"
                onClick={showShortcuts}
              />
            }
          >
            <CircleHelpIcon />
          </TooltipTrigger>
          <TooltipPopup side="top" align="start">
            <span className="flex items-center gap-2">
              Shortcuts <Kbd>?</Kbd>
            </span>
          </TooltipPopup>
        </Tooltip>
        {UTILITIES.map((destination) => (
          <Tooltip key={destination.id}>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={destination.label}
                  render={<Link {...destinationPlace(book, destination)} />}
                />
              }
            >
              <destination.icon />
            </TooltipTrigger>
            <TooltipPopup side="top" align="start">
              <span className="flex items-center gap-2">
                {destination.label}
                <Kbd className="uppercase">{destination.hotkey}</Kbd>
              </span>
            </TooltipPopup>
          </Tooltip>
        ))}
      </nav>
      <SyncStatus />
    </footer>
  );
}
