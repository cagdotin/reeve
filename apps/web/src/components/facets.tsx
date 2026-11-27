import { Button, buttonVariants } from "@reeve/ui/components/button";
import { Checkbox } from "@reeve/ui/components/checkbox";
import { Popover, PopoverPopup, PopoverTrigger } from "@reeve/ui/components/popover";
import { ScrollArea } from "@reeve/ui/components/scroll-area";
import { cn } from "@reeve/ui/lib/utils";
import { ChevronDownIcon, ListFilterIcon, SearchIcon, XIcon } from "lucide-react";
import { AnimatePresence, m } from "motion/react";
import { type KeyboardEvent, type RefObject, useId, useRef, useState } from "react";
import { indentStyle } from "@/lib/categories";
import { chosen, facetCount, type FacetGroup, type FacetValue } from "@/lib/facets";

const spring = { type: "spring" as const, stiffness: 420, damping: 34 };

const POPUP =
  "max-h-(--available-height) w-72 *:data-[slot=popover-viewport]:max-h-(--available-height) *:data-[slot=popover-viewport]:overflow-y-auto *:data-[slot=popover-viewport]:p-0";

const labelsOf = (group: FacetGroup, values: ReadonlyArray<string>) =>
  values.map((each) => group.options.find((option) => option.value === each)?.label ?? each);

const summary = (labels: ReadonlyArray<string>) =>
  labels.length > 2 ? `${labels.length} selected` : labels.join(", ");

/**
 * A Filter button that opens checkbox groups, with the chosen filters as chips beside it, after
 * https://devl.dev/components/facets. It reads and changes only its groups' keys of `value`.
 */
export function Facets({
  groups,
  value,
  onValueChange,
}: {
  groups: ReadonlyArray<FacetGroup>;
  value: FacetValue;
  onValueChange: (value: FacetValue) => void;
}) {
  const search = useRef<HTMLInputElement>(null);
  const total = groups.reduce((sum, group) => sum + (value[group.id]?.length ?? 0), 0);
  const set = (group: string, values: ReadonlyArray<string>) => {
    const { [group]: _, ...rest } = value;
    onValueChange(values.length === 0 ? rest : { ...rest, [group]: values });
  };
  const chips = groups.flatMap((group) => {
    const values = chosen(value, group.id);
    return values === undefined ? [] : [{ group, labels: labelsOf(group, values) }];
  });

  return (
    <>
      <Popover>
        <PopoverTrigger render={<Button variant={total > 0 ? "outline" : "ghost"} />}>
          <ListFilterIcon />
          Filter
          {total > 0 && (
            <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] text-primary-foreground tabular-nums">
              {total}
            </span>
          )}
        </PopoverTrigger>
        <PopoverPopup align="start" className={POPUP} initialFocus={search}>
          <FacetPanel groups={groups} value={value} onToggle={set} search={search} />
        </PopoverPopup>
      </Popover>
      <AnimatePresence initial={false} mode="popLayout">
        {chips.map(({ group, labels }) => (
          <m.span
            key={group.id}
            layout
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            transition={spring}
            title={labels.join(", ")}
            className="inline-flex h-8 max-w-72 items-center gap-1 rounded-lg border border-input bg-popover ps-2.5 pe-1 text-sm shadow-xs/5 not-dark:bg-clip-padding dark:bg-input/32"
          >
            <span className="shrink-0 text-muted-foreground">{group.label}:</span>
            <span className="truncate font-medium">{summary(labels)}</span>
            <button
              type="button"
              aria-label={`Remove the ${group.label} filter`}
              className="flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => set(group.id, [])}
            >
              <XIcon className="size-3.5" />
            </button>
          </m.span>
        ))}
        {chips.length > 1 && (
          <m.button
            key="clear"
            type="button"
            layout
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={spring}
            className={cn(
              buttonVariants({ variant: "ghost" }),
              "text-muted-foreground hover:text-foreground",
            )}
            onClick={() =>
              onValueChange(
                Object.fromEntries(
                  Object.entries(value).filter(
                    ([key]) => !groups.some((group) => group.id === key),
                  ),
                ),
              )
            }
          >
            Clear all
          </m.button>
        )}
      </AnimatePresence>
    </>
  );
}

/** A dropdown of one group's options to check, its trigger naming what is checked. */
export function FacetSelect({
  group,
  value,
  onValueChange,
}: {
  group: FacetGroup;
  value: ReadonlyArray<string>;
  onValueChange: (value: ReadonlyArray<string>) => void;
}) {
  const search = useRef<HTMLInputElement>(null);
  const labels = labelsOf(group, value);
  return (
    <Popover>
      <PopoverTrigger
        title={labels.join(", ") || undefined}
        render={<Button variant={value.length > 0 ? "outline" : "ghost"} />}
      >
        <span className={cn(value.length > 0 && "text-muted-foreground")}>{group.label}</span>
        {value.length > 0 && <span className="max-w-48 truncate">{summary(labels)}</span>}
        <ChevronDownIcon className="text-muted-foreground" />
      </PopoverTrigger>
      <PopoverPopup align="start" className={POPUP} initialFocus={search}>
        <FacetPanel
          groups={[group]}
          value={{ [group.id]: value }}
          onToggle={(_, values) => onValueChange(values)}
          search={search}
        />
        {value.length > 0 && (
          <div className="border-t p-1.5">
            <Button variant="ghost" className="w-full" onClick={() => onValueChange([])}>
              Clear {group.label.toLowerCase()}
            </Button>
          </div>
        )}
      </PopoverPopup>
    </Popover>
  );
}

/** Moves focus between a panel's rows with the arrow keys, Home and End. */
const moveFocus = (panel: HTMLElement | null, event: KeyboardEvent) => {
  if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
  const rows = [...(panel?.querySelectorAll<HTMLElement>("[data-facet-row]") ?? [])];
  const index = rows.indexOf(document.activeElement as HTMLElement);
  if (index === -1 && event.key !== "ArrowDown") return;
  event.preventDefault();
  const next =
    event.key === "Home"
      ? 0
      : event.key === "End"
        ? rows.length - 1
        : event.key === "ArrowDown"
          ? Math.min(index + 1, rows.length - 1)
          : Math.max(index - 1, 0);
  rows[next]?.focus();
};

/** A search box over checkbox groups; a single group shows its options without a header. */
function FacetPanel({
  groups,
  value,
  onToggle,
  search,
}: {
  groups: ReadonlyArray<FacetGroup>;
  value: FacetValue;
  onToggle: (group: string, values: ReadonlyArray<string>) => void;
  search: RefObject<HTMLInputElement | null>;
}) {
  const [open, setOpen] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(
      groups.map((group, index) => [
        group.id,
        chosen(value, group.id) !== undefined || (index === 0 && facetCount(value) === 0),
      ]),
    ),
  );
  const [query, setQuery] = useState("");
  const baseId = useId();
  const panel = useRef<HTMLFieldSetElement>(null);
  const flat = groups.length === 1;

  const q = query.trim().toLowerCase();
  const visible = groups
    .map((group) => ({
      ...group,
      options: q
        ? group.options.filter((option) => option.label.toLowerCase().includes(q))
        : group.options,
    }))
    .filter((group) => group.options.length > 0);

  return (
    // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- the arrow keys move between the panel's rows, whichever one has focus.
    <fieldset
      aria-label="Filters"
      className="flex flex-col"
      ref={panel}
      onKeyDown={(event) => moveFocus(panel.current, event)}
    >
      <label className="flex shrink-0 items-center gap-2 border-b px-3">
        <SearchIcon className="size-4 shrink-0 text-muted-foreground" />
        <input
          ref={search}
          data-facet-row
          aria-label={flat ? `Search ${groups[0]!.label.toLowerCase()}` : "Search filters"}
          placeholder={flat ? `Search ${groups[0]!.label.toLowerCase()}…` : "Search filters…"}
          className="h-9 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/72"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      <ScrollArea className="max-h-80">
        <div className="p-1.5">
          {visible.length === 0 && (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">
              Nothing matches “{query}”.
            </p>
          )}
          {visible.map((group) => {
            const expanded = flat || q !== "" || open[group.id] === true;
            const values = new Set(value[group.id] ?? []);
            const panelId = `${baseId}-${group.id}`;
            const options = (
              <Options
                group={group}
                checked={values}
                searching={q !== ""}
                onToggle={(option, on) => {
                  const next = new Set(values);
                  if (on) next.add(option);
                  else next.delete(option);
                  onToggle(group.id, [...next]);
                }}
              />
            );
            if (flat) return <div key={group.id}>{options}</div>;
            return (
              <div key={group.id} className="not-first:mt-0.5">
                <button
                  type="button"
                  data-facet-row
                  aria-controls={panelId}
                  aria-expanded={expanded}
                  className="flex h-8 w-full cursor-pointer items-center gap-2 rounded-md px-2 text-start text-sm font-medium outline-none hover:bg-accent focus-visible:bg-accent"
                  onClick={() => setOpen({ ...open, [group.id]: !expanded })}
                >
                  <m.span
                    animate={{ rotate: expanded ? 0 : -90 }}
                    transition={spring}
                    className="flex text-muted-foreground"
                  >
                    <ChevronDownIcon className="size-4" />
                  </m.span>
                  <span className="flex-1">{group.label}</span>
                  {values.size > 0 && (
                    <span className="rounded-full bg-accent px-1.5 text-[11px] text-muted-foreground tabular-nums">
                      {values.size}
                    </span>
                  )}
                </button>
                {expanded && (
                  <m.fieldset
                    id={panelId}
                    aria-label={group.label}
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={spring}
                    className="ps-6 pb-1"
                  >
                    {options}
                  </m.fieldset>
                )}
              </div>
            );
          })}
        </div>
      </ScrollArea>
    </fieldset>
  );
}

function Options({
  group,
  checked,
  searching,
  onToggle,
}: {
  group: FacetGroup;
  checked: ReadonlySet<string>;
  searching: boolean;
  onToggle: (option: string, on: boolean) => void;
}) {
  return (
    <div className="grid gap-px">
      {group.options.map((option) => {
        const on = checked.has(option.value);
        return (
          <label
            key={option.value}
            className="flex h-7 cursor-pointer items-center gap-2.5 rounded-md px-2 text-[13px] hover:bg-accent has-focus-visible:bg-accent"
          >
            <Checkbox
              data-facet-row
              checked={on}
              onCheckedChange={(next) => onToggle(option.value, next)}
            />
            <span
              className={cn("min-w-0 flex-1 truncate", on && "font-medium")}
              style={searching ? undefined : indentStyle(option.depth)}
            >
              {option.label}
              {searching && option.hint !== undefined && (
                <span className="ms-1.5 text-xs text-muted-foreground">{option.hint}</span>
              )}
            </span>
            {option.count !== undefined && (
              <span className="text-xs text-muted-foreground tabular-nums">{option.count}</span>
            )}
          </label>
        );
      })}
    </div>
  );
}
