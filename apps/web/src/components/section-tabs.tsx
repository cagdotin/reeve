import { Link, useRouterState } from "@tanstack/react-router";
import { useEffect } from "react";
import { useIsMobile } from "@reeve/ui/hooks/use-media-query";
import { LiquidSegments } from "@/components/liquid-segments";
import { scopedLink, useAccountScope } from "@/lib/account-scope";
import { useBook } from "@/lib/book";
import { rememberPlace, tabPlace, usePlaces } from "@/lib/home-session";
import type { Destination } from "@/lib/nav";

/**
 * The pages beside this one, in the window's header, or stuck to the top of a phone's page. A key per
 * destination gives each its own pill, which never slides over from another destination's tabs.
 */
export function SectionTabs({ destination }: { destination: Destination }) {
  const location = useRouterState({ select: (state) => state.location });
  const { id: book } = useBook();
  const scope = useAccountScope();
  const mobile = useIsMobile();
  usePlaces();
  const tabs = destination.tabs.map((tab) => ({ ...tab, key: tab.to }));
  const active = tabs.findIndex((tab) => tab.active(location.pathname));
  const here = destination.tabs[active];
  useEffect(() => {
    if (here?.resumes === true)
      rememberPlace(book, here, { to: location.pathname, search: location.search });
  }, [book, here, location.pathname, location.search]);
  if (destination.sidebar === true && !mobile) return null;
  return (
    <nav
      aria-label="Section"
      data-slot="section-tabs"
      className="min-w-0 overflow-x-auto [scrollbar-width:none] app-no-drag max-md:sticky max-md:top-0 max-md:z-30 max-md:border-b max-md:bg-background max-md:px-4 max-md:py-1.5"
    >
      <LiquidSegments
        key={destination.id}
        items={tabs}
        active={active}
        renderItem={(tab, index, props) => (
          <Link
            key={tab.key}
            {...(destination.scoped === true ? scopedLink(tab.to, scope) : tabPlace(book, tab))}
            activeOptions={{ exact: true }}
            aria-current={index === active ? "page" : undefined}
            draggable={false}
            {...props}
          />
        )}
      />
    </nav>
  );
}
