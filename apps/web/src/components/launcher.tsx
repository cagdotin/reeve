/* oxlint-disable jsx-a11y/prefer-tag-over-role, jsx-a11y/click-events-have-key-events -- a combobox over a listbox of custom rows: no HTML tag has these roles, and the input owns the keys. */
import { DialogPrimitive as Dialog } from "@reeve/ui/components/dialog";
import { ChevronRightIcon, CornerDownLeftIcon, HistoryIcon, SearchIcon } from "lucide-react";
import { AnimatePresence, m, useReducedMotion } from "motion/react";
import {
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Kbd, KbdGroup } from "@reeve/ui/components/kbd";
import { ScrollArea } from "@reeve/ui/components/scroll-area";
import { cn } from "@reeve/ui/lib/utils";
import { launcherRecent } from "@/lib/prefs";

export type LauncherAction = {
  id: string;
  label: string;
  icon: ReactNode;
  group?: string;
  shortcut?: string[];
  keywords?: string;
} & ({ onSelect: () => void; page?: never } | { page: string; onSelect?: never });

export interface LauncherPage {
  title: string;
  placeholder: string;
  actions: LauncherAction[];
}

interface LauncherProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  actions: LauncherAction[];
  pages: Record<string, LauncherPage>;
  placeholder: string;
}

interface Section {
  title: string;
  items: LauncherAction[];
}

const RECENT = "Recent";
const RECENT_LIMIT = 3;
const LIST_HEIGHT = 296;
const SPRING = { type: "spring", stiffness: 420, damping: 36 } as const;
const GLIDE = { type: "spring", stiffness: 600, damping: 40 } as const;

const readRecent = () => (launcherRecent.get() ?? "").split("\n").filter(Boolean);

const score = (action: LauncherAction, query: string) => {
  const label = action.label.toLowerCase();
  if (label.startsWith(query)) return 3;
  if (label.split(/\s+/).some((word) => word.startsWith(query))) return 2;
  if (label.includes(query) || action.keywords?.toLowerCase().includes(query)) return 1;
  return 0;
};

const search = (source: LauncherAction[], query: string) =>
  source
    .map((action) => ({ action, score: score(action, query) }))
    .filter((hit) => hit.score > 0)
    .toSorted((a, b) => b.score - a.score)
    .map((hit) => hit.action);

const searchable = (actions: LauncherAction[], pages: Record<string, LauncherPage>) => [
  ...actions.filter((action) => action.page === undefined),
  ...Object.values(pages).flatMap((page) =>
    page.actions.map((action) => ({ ...action, group: page.title })),
  ),
];

const sectionsOf = (
  actions: LauncherAction[],
  pages: Record<string, LauncherPage>,
  page: string | null,
  query: string,
  recent: string[],
): Section[] => {
  const opened = page === null ? undefined : pages[page];
  if (query !== "") {
    const hits = search(opened?.actions ?? searchable(actions, pages), query);
    return hits.length > 0 ? [{ title: opened?.title ?? "Results", items: hits }] : [];
  }
  if (opened !== undefined) return [{ title: opened.title, items: opened.actions }];
  const everything = searchable(actions, pages);
  const recents = recent.flatMap((id) => everything.find((action) => action.id === id) ?? []);
  const groups = Map.groupBy(actions, (action) => action.group ?? "Actions");
  return [
    ...(recents.length > 0 ? [{ title: RECENT, items: recents }] : []),
    ...[...groups].map(([title, items]) => ({ title, items })),
  ];
};

/** Adapted from https://devl.dev/components/launcher: it opens over the page. */
export function Launcher({ open, onOpenChange, ...panel }: LauncherProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/32 transition-opacity duration-200 data-ending-style:opacity-0 data-starting-style:opacity-0" />
        <Dialog.Viewport className="fixed inset-0 z-50 flex flex-col items-center px-4 py-[max(--spacing(4),4vh)] sm:py-[10vh]">
          <Dialog.Popup
            aria-label="Search and commands"
            className="w-full min-w-0 max-w-xl overflow-hidden rounded-2xl border bg-popover text-popover-foreground shadow-lg/5 outline-none transition-[scale,opacity] duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] origin-top data-ending-style:scale-98 data-ending-style:opacity-0 data-starting-style:scale-98 data-starting-style:opacity-0 motion-reduce:transition-none"
          >
            <LauncherPanel {...panel} onClose={() => onOpenChange(false)} />
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function LauncherPanel({
  actions,
  pages,
  placeholder,
  onClose,
}: Omit<LauncherProps, "open" | "onOpenChange"> & { onClose: () => void }) {
  const [page, setPage] = useState<string | null>(null);
  const [direction, setDirection] = useState(1);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [recent, setRecent] = useState(readRecent);
  const [highlightTop, setHighlightTop] = useState<number | null>(null);
  const [listHeight, setListHeight] = useState(LIST_HEIGHT);
  const baseId = useId();
  const reduce = useReducedMotion();
  const inputRef = useRef<HTMLInputElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLDivElement>(null);
  const followActive = useRef(false);

  const trimmed = query.trim().toLowerCase();
  const sections = useMemo(
    () => sectionsOf(actions, pages, page, trimmed, recent),
    [actions, pages, page, trimmed, recent],
  );
  const flat = sections.flatMap((section) =>
    section.items.map((item) => ({ item, section: section.title })),
  );
  const activeIndex = Math.min(active, flat.length - 1);
  const current = flat[activeIndex];
  const optionId = (section: string, id: string) =>
    `${baseId}-${section}-${id}`.replace(/[^a-zA-Z0-9_-]/g, "");
  const opened = page === null ? undefined : pages[page];

  const moveTo = (index: number) => {
    followActive.current = true;
    setActive(index);
  };

  const goTo = (next: string | null) => {
    setDirection(next === null ? -1 : 1);
    setPage(next);
    setQuery("");
    moveTo(0);
    inputRef.current?.focus();
  };

  const run = (action: LauncherAction) => {
    if (action.page !== undefined) {
      goTo(action.page);
      return;
    }
    const next = [action.id, ...recent.filter((id) => id !== action.id)].slice(0, RECENT_LIMIT);
    setRecent(next);
    launcherRecent.set(next.join("\n"));
    onClose();
    action.onSelect();
  };

  const onInputKey = (event: KeyboardEvent<HTMLInputElement>) => {
    const count = flat.length;
    if (event.key === "ArrowDown" && count > 0) {
      event.preventDefault();
      moveTo((activeIndex + 1) % count);
    } else if (event.key === "ArrowUp" && count > 0) {
      event.preventDefault();
      moveTo((activeIndex - 1 + count) % count);
    } else if (event.key === "Enter" && current !== undefined) {
      event.preventDefault();
      run(current.item);
    } else if (event.key === "Escape" && page !== null) {
      // Base UI's dialog closes on an Escape that reaches the document.
      event.stopPropagation();
      goTo(null);
    } else if (event.key === "Backspace" && query === "" && page !== null) {
      event.preventDefault();
      goTo(null);
    }
  };

  useLayoutEffect(() => {
    const content = contentRef.current;
    if (content === null) return;
    const observer = new ResizeObserver(() =>
      setListHeight(Math.min(content.offsetHeight, LIST_HEIGHT)),
    );
    observer.observe(content);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    setHighlightTop(activeRef.current?.offsetTop ?? null);
  }, [current?.item.id, current?.section, sections]);

  useEffect(() => {
    if (!followActive.current) return;
    followActive.current = false;
    activeRef.current?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, sections]);

  const spring = reduce ? { duration: 0 } : SPRING;

  return (
    <>
      <div className="flex items-center gap-2 border-b px-3">
        <SearchIcon className="size-4 shrink-0 text-muted-foreground" />
        {opened !== undefined && (
          <button
            type="button"
            title="Back (Backspace)"
            onClick={() => goTo(null)}
            className="flex shrink-0 cursor-pointer items-center gap-1 rounded-md bg-accent px-1.5 py-0.5 font-medium text-xs outline-none hover:bg-accent/80 focus-visible:ring-2 focus-visible:ring-ring"
          >
            {opened.title}
            <ChevronRightIcon className="size-3 text-muted-foreground" />
          </button>
        )}
        <input
          ref={inputRef}
          role="combobox"
          aria-label="Search"
          aria-autocomplete="list"
          aria-expanded
          aria-controls={`${baseId}-list`}
          aria-activedescendant={
            current === undefined ? undefined : optionId(current.section, current.item.id)
          }
          value={query}
          placeholder={opened?.placeholder ?? placeholder}
          onChange={(event) => {
            setQuery(event.target.value);
            moveTo(0);
          }}
          onKeyDown={onInputKey}
          className="h-11 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/72 max-md:text-base"
        />
        <Kbd className="max-md:hidden">esc</Kbd>
      </div>

      <div
        style={{ height: listHeight }}
        className="overflow-hidden transition-[height] duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none"
      >
        <ScrollArea scrollFade overscrollContain>
          <div ref={contentRef}>
            <AnimatePresence custom={direction} initial={false} mode="popLayout">
              <m.div
                key={page ?? "root"}
                id={`${baseId}-list`}
                role="listbox"
                aria-label={opened?.title ?? "Results"}
                custom={direction}
                initial={{ x: 24 * direction, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                exit={{ x: -24 * direction, opacity: 0, transition: { duration: 0.12 } }}
                transition={spring}
                className="relative p-1.5"
              >
                {highlightTop !== null && current !== undefined && (
                  <m.span
                    aria-hidden
                    initial={false}
                    animate={{ y: highlightTop }}
                    transition={reduce ? { duration: 0 } : GLIDE}
                    className="absolute inset-x-1.5 top-0 h-9 rounded-lg bg-accent max-md:h-11"
                  />
                )}
                {sections.length === 0 && (
                  <p className="px-3 py-8 text-center text-muted-foreground text-sm">
                    Nothing for “{query.trim()}”.
                  </p>
                )}
                {sections.map((section) => (
                  <div
                    key={section.title}
                    role="group"
                    aria-label={section.title}
                    className="not-first-of-type:mt-1.5"
                  >
                    <div className="flex items-center gap-1.5 px-2 py-1.5 font-medium text-muted-foreground text-xs">
                      {section.title === RECENT && <HistoryIcon className="size-3" />}
                      {section.title}
                    </div>
                    {section.items.map((item) => {
                      const index = flat.findIndex(
                        (each) => each.item.id === item.id && each.section === section.title,
                      );
                      const isActive = index === activeIndex;
                      return (
                        <div
                          key={item.id}
                          ref={isActive ? activeRef : undefined}
                          id={optionId(section.title, item.id)}
                          role="option"
                          tabIndex={-1}
                          aria-selected={isActive}
                          onClick={() => run(item)}
                          onMouseMove={() => {
                            if (!isActive) setActive(index);
                          }}
                          className={cn(
                            "flex h-9 scroll-my-8 cursor-pointer select-none items-center gap-2.5 rounded-lg px-2 text-sm max-md:h-11 [&_svg:not([class*='size-'])]:size-4",
                            isActive ? "text-foreground" : "text-foreground/80",
                          )}
                        >
                          <span className="relative flex shrink-0 text-muted-foreground">
                            {item.icon}
                          </span>
                          <span className="relative min-w-0 flex-1 truncate">{item.label}</span>
                          {trimmed !== "" && page === null && item.group !== undefined && (
                            <span className="relative shrink-0 text-muted-foreground text-xs">
                              {item.group}
                            </span>
                          )}
                          {item.page !== undefined ? (
                            <ChevronRightIcon className="relative size-4 text-muted-foreground" />
                          ) : (
                            item.shortcut !== undefined && (
                              <KbdGroup className="relative max-md:hidden">
                                {item.shortcut.map((key) => (
                                  <Kbd key={key} className="bg-background uppercase">
                                    {key}
                                  </Kbd>
                                ))}
                              </KbdGroup>
                            )
                          )}
                        </div>
                      );
                    })}
                  </div>
                ))}
              </m.div>
            </AnimatePresence>
          </div>
        </ScrollArea>
      </div>

      <div className="flex items-center gap-3 border-t px-3 py-2 text-muted-foreground text-xs max-md:hidden">
        <span className="flex items-center gap-1">
          <Kbd>↑</Kbd>
          <Kbd>↓</Kbd>
          navigate
        </span>
        <span className="flex items-center gap-1">
          <Kbd>
            <CornerDownLeftIcon />
          </Kbd>
          {current?.item.page === undefined ? "run" : "open"}
        </span>
        <span className="ms-auto flex items-center gap-1">
          <Kbd>{page === null ? "esc" : "⌫"}</Kbd>
          {page === null ? "close" : "back"}
        </span>
      </div>
    </>
  );
}
