import { Link, useRouterState } from "@tanstack/react-router";
import { SearchIcon, type LucideIcon } from "lucide-react";
import { useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Input } from "@reeve/ui/components/input";
import { ScrollArea } from "@reeve/ui/components/scroll-area";
import { cn } from "@reeve/ui/lib/utils";
import { useSidebarLayerSlot } from "@/components/page-slots";
import { destinationOf } from "@/lib/nav";

/** A page's title, the line under it and an object resting on the rule below them. */
export function SectionTitle({
  title,
  subtitle,
  object,
}: {
  title: ReactNode;
  subtitle: ReactNode;
  object?: ReactNode;
}) {
  return (
    <div className="relative overflow-hidden border-b px-(--page-gutter) pt-7 pb-5 max-md:pt-4 max-md:pb-4">
      <div className={object === undefined ? undefined : "pe-56 max-md:pe-24"}>
        <div className="text-[22px] font-semibold tracking-tight">{title}</div>
        <div className="mt-0.5 text-[15px] text-muted-foreground max-md:text-[13px] md:truncate">
          {subtitle}
        </div>
      </div>
      {object !== undefined && (
        <span className="absolute inset-y-0 right-0 w-52 max-md:w-24">{object}</span>
      )}
    </div>
  );
}

export interface LayerItem {
  readonly to: string;
  readonly label: string;
  readonly active: boolean;
  readonly icon?: LucideIcon | undefined;
  readonly title?: string;
  /** More words the filter matches. */
  readonly keywords?: string | undefined;
}

export interface LayerGroup {
  readonly label?: string;
  readonly items: ReadonlyArray<LayerItem>;
}

const matches = (item: LayerItem, query: string) =>
  `${item.label} ${item.keywords ?? ""}`.toLowerCase().includes(query);

function LayerLink({ item }: { item: LayerItem }) {
  return (
    <Link
      to={item.to}
      {...(item.title === undefined ? {} : { title: item.title })}
      aria-current={item.active ? "page" : undefined}
      className={cn(
        "flex h-8 items-center gap-2.5 rounded-lg px-3 text-sm outline-none transition-colors duration-150 ease-fey focus-visible:ring-2 focus-visible:ring-ring [&>svg]:size-4 [&>svg]:shrink-0",
        item.active
          ? "bg-background font-medium text-foreground shadow-xs/5 ring-1 ring-border dark:bg-accent dark:ring-0"
          : "text-muted-foreground hover:bg-accent hover:text-foreground",
      )}
    >
      {item.icon !== undefined && <item.icon />}
      <span className="min-w-0 truncate">{item.label}</span>
    </Link>
  );
}

/** A destination's own list, filtered by the box above it, in the sidebar's place. A phone has neither. */
export function SidebarLayerList({
  title,
  navLabel,
  groups,
}: {
  title: string;
  navLabel: string;
  groups: ReadonlyArray<LayerGroup>;
}) {
  const slot = useSidebarLayerSlot();
  const [filter, setFilter] = useState("");
  if (slot === null) return null;
  const query = filter.trim().toLowerCase();
  const shown = groups
    .map((group) => ({ ...group, items: group.items.filter((item) => matches(item, query)) }))
    .filter((group) => group.items.length > 0);
  return createPortal(
    <>
      <div className="relative px-2 pb-2">
        <SearchIcon className="pointer-events-none absolute top-2 left-5 z-10 size-4 text-muted-foreground" />
        <Input
          type="search"
          aria-label={`Filter ${title}`}
          placeholder="Search"
          className="[&_input]:ps-8"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
        />
      </div>
      <ScrollArea scrollFade className="min-h-0 flex-1">
        <nav aria-label={navLabel} className="grid grid-cols-[minmax(0,1fr)] gap-4 px-2 pt-2 pb-4">
          <h2 className="flex h-5 items-center px-3 text-[13px] font-medium">{title}</h2>
          {shown.map((group) => (
            <section key={group.label ?? ""} className="grid grid-cols-[minmax(0,1fr)] gap-1">
              {group.label !== undefined && (
                <h3 className="flex h-5 items-center px-3 text-[13px] text-muted-foreground">
                  {group.label}
                </h3>
              )}
              <ul className="grid grid-cols-[minmax(0,1fr)] gap-0.5">
                {group.items.map((item) => (
                  <li key={item.to}>
                    <LayerLink item={item} />
                  </li>
                ))}
              </ul>
            </section>
          ))}
          {shown.length === 0 && (
            <p className="px-3 text-[13px] text-muted-foreground">Nothing matches.</p>
          )}
        </nav>
      </ScrollArea>
    </>,
    slot,
  );
}

/** The pages beside this one, from the registry, for a destination that lists them in the sidebar. */
export function SectionSidebar() {
  const path = useRouterState({ select: (state) => state.location.pathname });
  const destination = destinationOf(path);
  return (
    <SidebarLayerList
      title={destination?.label ?? ""}
      navLabel="Section"
      groups={[
        {
          items: (destination?.tabs ?? []).map((tab) => ({
            to: tab.to,
            label: tab.label,
            icon: tab.icon,
            keywords: tab.keywords,
            active: tab.active(path),
          })),
        },
      ]}
    />
  );
}
