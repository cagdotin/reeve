/* oxlint-disable jsx-a11y/prefer-tag-over-role -- the resize handle is a focusable separator, which an hr cannot be. */
import { useBlocker } from "@tanstack/react-router";
import { useActor } from "@xstate/react";
import { XIcon } from "lucide-react";
import {
  createContext,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  AlertDialog,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "@reeve/ui/components/alert-dialog";
import { Button } from "@reeve/ui/components/button";
import { ScrollArea } from "@reeve/ui/components/scroll-area";
import { useIsMobile } from "@reeve/ui/hooks/use-media-query";
import { cn } from "@reeve/ui/lib/utils";
import { PageAlert, PageAlertSlot } from "@/components/page-alert";
import { overlayOpen, useHotkeys } from "@/lib/hotkeys";
import { splitPanelWidth } from "@/lib/prefs";
import { paneSaveMachine } from "@/machines/pane-save";

const MIN = 320;
const MAX = 640;
const DEFAULT = 400;
const HANDLE = 8;
/** The narrowest page worth keeping beside a docked pane; with less room the pane covers the page. */
export const PAGE_MIN = 600;

/** Docked beside the page, over it in a window too narrow for both, or over the whole screen on a phone. */
export type PaneMode = "docked" | "overlay" | "screen";

const paneMode = (mobile: boolean, room: number): PaneMode =>
  mobile ? "screen" : room >= MIN ? "docked" : "overlay";

/** What an editor in the pane would lose: whether it has changes, and how to save them. */
interface Guard {
  readonly dirty: boolean;
  readonly save: () => Promise<unknown>;
}

/** The task the pane shows: one per `SplitPanel`, whose content may change under it, as from row to row. */
interface Task {
  /** Has changes that were neither saved nor discarded since its editor last changed hands. */
  readonly unsaved: () => boolean;
  /** A save is in flight, so nothing may close the pane or change what it shows. */
  readonly saving: () => boolean;
  readonly track: (guard: Guard | null) => void;
  readonly settle: () => void;
  readonly close: () => void;
  readonly commit: (save?: () => Promise<unknown>) => Promise<boolean>;
  readonly reset: () => void;
}

interface Host {
  readonly slot: HTMLElement | null;
  readonly show: (task: Task) => () => void;
  readonly leave: (then: () => void) => void;
}

const HostContext = createContext<Host>({
  slot: null,
  show: () => () => {},
  leave: (then) => then(),
});
const TaskContext = createContext<Task | null>(null);
const FooterContext = createContext<HTMLElement | null>(null);
const SavingContext = createContext(false);

const savedWidth = () => {
  const saved = Number(splitPanelWidth.get());
  return Number.isFinite(saved) && saved >= MIN && saved <= MAX ? saved : DEFAULT;
};

const FOCUSABLE =
  "a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])";

/** Keeps Tab inside the pane while it covers the page, whose content is inert meanwhile. */
const containTab = (pane: HTMLElement) => (event: globalThis.KeyboardEvent) => {
  if (event.key !== "Tab") return;
  const items = [...pane.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (each) => each.offsetParent !== null,
  );
  const first = items[0];
  const last = items.at(-1);
  if (first === undefined || last === undefined) return event.preventDefault();
  const active = document.activeElement;
  if (
    event.shiftKey ? active === first || !items.includes(active as HTMLElement) : active === last
  ) {
    event.preventDefault();
    (event.shiftKey ? last : first).focus();
  }
};

/** Asks before an editor's changes would be lost: save them, discard them, or stay. */
function useLeaveGuard() {
  const current = useRef<Task | null>(null);
  const [open, setOpen] = useState(false);
  const pending = useRef<{ answer: Promise<boolean>; resolve: (leave: boolean) => void } | null>(
    null,
  );
  const [asking, setAsking] = useState(false);
  const [saving, setSaving] = useState(false);

  // A second way out while the question is open waits for the same answer.
  const confirmLeave = useCallback((): boolean | Promise<boolean> => {
    if (current.current?.saving() === true) return false;
    if (current.current?.unsaved() !== true) return true;
    if (pending.current === null) {
      let resolve: (leave: boolean) => void = () => {};
      const answer = new Promise<boolean>((done) => {
        resolve = done;
      });
      pending.current = { answer, resolve };
      setAsking(true);
    }
    return pending.current.answer;
  }, []);

  const leave = useCallback(
    (then: () => void) => {
      const ok = confirmLeave();
      if (typeof ok === "boolean") {
        if (ok) then();
      } else void ok.then((yes) => yes && then());
    },
    [confirmLeave],
  );

  useBlocker({
    shouldBlockFn: () => {
      const ok = confirmLeave();
      return typeof ok === "boolean" ? !ok : ok.then((yes) => !yes);
    },
    enableBeforeUnload: () =>
      current.current?.saving() === true || current.current?.unsaved() === true,
  });

  const answer = (leaving: boolean) => {
    const task = current.current;
    if (leaving && task !== null) {
      task.settle();
      task.close();
    }
    pending.current?.resolve(leaving);
    pending.current = null;
    setAsking(false);
  };
  const saveAndLeave = async () => {
    setSaving(true);
    try {
      answer((await current.current?.commit()) ?? true);
    } finally {
      setSaving(false);
    }
  };

  const dialog = (
    <AlertDialog open={asking} onOpenChange={(open) => !open && !saving && answer(false)}>
      <AlertDialogPopup>
        <AlertDialogHeader>
          <AlertDialogTitle>Save your changes?</AlertDialogTitle>
          <AlertDialogDescription>
            This editor has changes that are not saved yet.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <Button variant="ghost" disabled={saving} onClick={() => answer(false)}>
            Keep editing
          </Button>
          <Button variant="outline" disabled={saving} onClick={() => answer(true)}>
            Discard changes
          </Button>
          <Button loading={saving} onClick={() => void saveAndLeave()}>
            Save and continue
          </Button>
        </AlertDialogFooter>
      </AlertDialogPopup>
    </AlertDialog>
  );
  const show = useCallback((task: Task) => {
    current.current = task;
    setOpen(true);
    return () => {
      if (current.current !== task) return;
      current.current = null;
      setOpen(false);
    };
  }, []);
  const leaveTask = () => {
    const task = current.current;
    if (task !== null) leave(task.close);
  };
  return { open, show, leave, leaveTask, dialog };
}

/**
 * The frame's right-hand pane, after devl's Split Shell (https://devl.dev/screens/split-shell): docked
 * beside the page while the page keeps `PAGE_MIN` beside it, with a handle to drag or nudge with the
 * arrow keys; over the page, which goes inert, in a narrower window; over the whole screen on a phone.
 * A page fills it by rendering `SplitPanel`, and every way out of it asks before an editor's changes are lost.
 */
export function SplitPanelHost({ children }: { children: ReactNode }) {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const [width, setWidth] = useState(savedWidth);
  const [hostWidth, setHostWidth] = useState(() => window.innerWidth);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ x: number; w: number } | null>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const openers = useRef<Array<HTMLElement>>([]);
  const mobile = useIsMobile();
  const { open, show, leave, leaveTask, dialog } = useLeaveGuard();

  const room = Math.min(MAX, hostWidth - HANDLE - PAGE_MIN);
  const mode = paneMode(mobile, room);
  const shown = Math.min(width, room);

  useLayoutEffect(() => {
    const element = hostRef.current;
    if (element === null) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setHostWidth(entry.contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const host = useMemo(() => ({ slot, show, leave }), [slot, show, leave]);

  useEffect(() => {
    if (slot === null) return;
    // The last few, since a popup's own focus comes and goes after the row that opened the pane.
    const remember = (event: FocusEvent) => {
      const target = event.target;
      if (target instanceof HTMLElement && !slot.contains(target))
        openers.current = [...openers.current.slice(-7), target];
    };
    document.addEventListener("focusin", remember);
    return () => document.removeEventListener("focusin", remember);
  }, [slot]);

  useEffect(() => {
    if (slot === null) return;
    if (open) {
      if (!slot.contains(document.activeElement))
        slot.querySelector<HTMLElement>("[data-slot=pane-title]")?.focus({ preventScroll: true });
      return;
    }
    const back = openers.current.findLast((each) => each.isConnected && !slot.contains(each));
    if (
      back !== undefined &&
      (document.activeElement === document.body || slot.contains(document.activeElement))
    )
      back.focus({ preventScroll: true });
  }, [open, slot]);

  const resize = (next: number) => {
    const clamped = Math.min(Math.max(next, MIN), room);
    setWidth(clamped);
    splitPanelWidth.set(String(clamped));
  };
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { x: event.clientX, w: shown };
    setDragging(true);
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current) resize(drag.current.w + drag.current.x - event.clientX);
  };
  const onPointerUp = () => {
    drag.current = null;
    setDragging(false);
  };
  const onHandleKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const delta = event.shiftKey ? 64 : 16;
    const next = {
      ArrowLeft: shown + delta,
      ArrowRight: shown - delta,
      Home: MAX,
      End: MIN,
      Enter: DEFAULT,
    }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    resize(next);
  };
  const covering = open && mode !== "docked";
  useEffect(() => {
    if (slot === null || !covering) return;
    const onKeyDown = containTab(slot);
    slot.addEventListener("keydown", onKeyDown);
    return () => slot.removeEventListener("keydown", onKeyDown);
  }, [slot, covering]);
  const pane = (
    <section
      aria-label="Panel"
      data-mode={mode}
      ref={setSlot}
      className="relative flex h-full min-w-0 flex-1 flex-col overflow-hidden bg-background md:rounded-2xl md:border md:shadow-xs/5"
    />
  );

  return (
    <HostContext.Provider value={host}>
      <div
        ref={hostRef}
        className={cn(
          "relative flex min-h-0 min-w-0 flex-1 md:pe-2",
          dragging && "cursor-col-resize select-none",
        )}
      >
        <div data-slot="pane-page" className="flex min-h-0 min-w-0 flex-1" inert={covering}>
          {children}
        </div>
        {/* One element in every mode: a new one would remount the pane's content and lose its edits. */}
        <div
          className={cn(
            {
              docked: "flex shrink-0",
              overlay:
                "absolute inset-y-2 right-2 z-40 flex w-[min(28rem,calc(100%-1rem))] [&_section]:shadow-lg/10",
              screen: "fixed inset-0 z-50 flex bg-background pt-[env(safe-area-inset-top)]",
            }[mode],
            !open && (mode === "docked" ? "hidden" : "pointer-events-none invisible"),
          )}
          style={mode === "docked" ? { width: shown + HANDLE } : undefined}
        >
          {mode === "docked" && (
            <div
              role="separator"
              tabIndex={open ? 0 : -1}
              aria-label="Resize panel"
              aria-orientation="vertical"
              aria-valuemin={MIN}
              aria-valuemax={Math.round(room)}
              aria-valuenow={Math.round(shown)}
              className="group/handle relative flex w-2 shrink-0 cursor-col-resize touch-none items-center justify-center outline-none before:absolute before:inset-y-0 before:-inset-x-1"
              onDoubleClick={() => resize(DEFAULT)}
              onKeyDown={onHandleKey}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
            >
              <span
                className={cn(
                  "h-8 w-1 rounded-full bg-muted-foreground/24 transition-[height,background-color] group-hover/handle:bg-muted-foreground/48 group-focus-visible/handle:bg-ring",
                  dragging && "h-14 bg-info",
                )}
              />
            </div>
          )}
          <div
            className={cn(
              "flex min-w-0 flex-1",
              mode === "docked" && "animate-in duration-200 fade-in-0 slide-in-from-right-4",
            )}
          >
            {pane}
          </div>
        </div>
        {mode === "overlay" && (
          <div
            aria-hidden
            className={cn(
              "absolute inset-0 z-30 bg-black/24 transition-opacity duration-200",
              open ? "opacity-100" : "pointer-events-none opacity-0",
            )}
            onClick={leaveTask}
          />
        )}
      </div>
      {dialog}
    </HostContext.Provider>
  );
}

/** Runs `then` once the pane's unsaved changes are saved or discarded, or right away when it has none. */
export const usePaneLeave = () => useContext(HostContext).leave;

/**
 * Opens the frame's panel with a title and this content while it is rendered. The cross, Escape and the
 * page behind an overlay close it, through the pane's guard. What goes wrong inside it, a `PageAlert`
 * included, shows in a strip under its title rather than on the page behind it.
 */
export function SplitPanel({
  title,
  actions,
  onClose,
  children,
}: {
  title: ReactNode;
  actions?: ReactNode;
  onClose: () => void;
  children: ReactNode;
}) {
  const { slot, show, leave } = useContext(HostContext);
  const [snapshot, send, actor] = useActor(paneSaveMachine);
  const feedback = snapshot.context.error;
  const saving = snapshot.matches("saving");
  const [alerts, setAlerts] = useState<HTMLElement | null>(null);
  const [footer, setFooter] = useState<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  useLayoutEffect(() => {
    onCloseRef.current = onClose;
  });
  const guard = useRef<Guard | null>(null);
  const settled = useRef(false);
  const [task] = useState<Task>(() => ({
    unsaved: () => guard.current?.dirty === true && !settled.current,
    saving: () => actor.getSnapshot().matches("saving"),
    track: (next) => {
      guard.current = next;
    },
    settle: () => {
      settled.current = true;
    },
    close: () => onCloseRef.current(),
    reset: () => {
      settled.current = false;
      send({ type: "reset" });
    },
    commit: (save = guard.current?.save) =>
      save === undefined
        ? Promise.resolve(true)
        : new Promise<boolean>((resolve) =>
            send({
              type: "submit",
              save,
              settled: (saved) => {
                if (saved) settled.current = true;
                resolve(saved);
              },
            }),
          ),
  }));
  useLayoutEffect(() => show(task), [show, task]);
  const close = () => leave(task.close);
  useHotkeys({ escape: close });

  const closeRef = useRef(close);
  useLayoutEffect(() => {
    closeRef.current = close;
  });
  useEffect(() => {
    if (slot === null) return;
    // Escape from a field in the pane closes it too, unless a popup of the field's is open. The key
    // stops here, or the guard's dialog, open by the time it bubbles on, would take it as its own.
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || overlayOpen()) return;
      event.preventDefault();
      event.stopPropagation();
      closeRef.current();
    };
    slot.addEventListener("keydown", onKeyDown);
    return () => slot.removeEventListener("keydown", onKeyDown);
  }, [slot]);

  if (slot === null) return null;
  return createPortal(
    <TaskContext.Provider value={task}>
      <FooterContext.Provider value={footer}>
        <SavingContext.Provider value={saving}>
          <div className="flex min-h-0 flex-1 flex-col" aria-busy={saving || undefined}>
            <header className="flex h-12 shrink-0 items-center gap-2 border-b ps-4 pe-2">
              <h2
                data-slot="pane-title"
                tabIndex={-1}
                className="min-w-0 flex-1 truncate text-sm font-medium outline-none"
              >
                {title}
              </h2>
              {actions}
              <Button
                variant="ghost"
                size="icon"
                aria-label="Close panel"
                disabled={saving}
                onClick={close}
              >
                <XIcon />
              </Button>
            </header>
            <div
              ref={setAlerts}
              data-slot="pane-alerts"
              className="flex shrink-0 flex-col empty:hidden"
            />
            <PageAlertSlot slot={alerts}>
              {feedback !== null && <PageAlert variant="error" title={feedback} />}
              <ScrollArea className="min-h-0 flex-1">
                <fieldset disabled={saving} className="contents">
                  <div className="p-4">{children}</div>
                </fieldset>
              </ScrollArea>
              <fieldset
                ref={setFooter}
                disabled={saving}
                data-slot="pane-footer"
                className="shrink-0 border-t px-4 py-3 empty:hidden"
              />
            </PageAlertSlot>
          </div>
        </SavingContext.Provider>
      </FooterContext.Provider>
    </TaskContext.Provider>,
    slot,
  );
}

/**
 * Puts an editor in the pane under its guard. `save` writes the changes and rejects with what went
 * wrong; `submit` runs it (or another save, such as one that also applies) and calls `done` once it
 * lands, keeping the editor open with the error otherwise. `cancel` closes it without asking, since
 * a Cancel button is itself the choice to discard.
 */
export function usePaneTask({
  dirty,
  save,
  done,
}: {
  dirty: boolean;
  save: () => Promise<unknown>;
  done: () => void;
}) {
  const task = useContext(TaskContext);
  const saving = useContext(SavingContext);
  useLayoutEffect(() => {
    task?.track({ dirty, save });
  });
  useLayoutEffect(() => {
    if (task === null) return;
    task.reset();
    return () => task.track(null);
  }, [task]);
  if (task === null) throw new Error("usePaneTask runs inside a SplitPanel");
  return {
    saving,
    submit: (other?: () => Promise<unknown>) => void task.commit(other).then((ok) => ok && done()),
    cancel: () => {
      task.settle();
      task.close();
    },
  };
}

/** What stays put under the pane's content as it scrolls, such as an editor's buttons. */
export function PaneFooter({ children }: { children: ReactNode }) {
  const footer = useContext(FooterContext);
  return footer === null ? null : createPortal(children, footer);
}
