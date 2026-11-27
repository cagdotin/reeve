import type { CategoryGroup } from "@reeve/contract";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type Announcements,
  type CollisionDetection,
  type DragMoveEvent,
  type DragStartEvent,
  type KeyboardCoordinateGetter,
  type Modifier,
} from "@dnd-kit/core";
import { categorySubtree } from "@reeve/contract/rules";
import { cn } from "@reeve/ui/lib/utils";
import { GripVerticalIcon } from "lucide-react";
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { resolveDrop, type Dragged, type Drop, type Target } from "@/components/categories/drop";
import { useBookMutation } from "@/lib/api";
import { useBook } from "@/lib/book";

interface DragState {
  /** The ids being dragged: a group, or a category and its subcategories. */
  readonly dragging: ReadonlySet<string>;
  readonly drop: Drop | null;
}

const DragContext = createContext<DragState>({ dragging: new Set(), drop: null });

export const useDragState = () => useContext(DragContext);

/** Picks the row under the dragged row's middle, so pointer and keyboard drags behave alike. */
const rowAtCenter: CollisionDetection = ({
  collisionRect,
  droppableContainers,
  droppableRects,
}) => {
  const y = collisionRect.top + collisionRect.height / 2;
  const hit = droppableContainers.find(({ id }) => {
    const rect = droppableRects.get(id);
    return rect !== undefined && rect.top <= y && y < rect.bottom;
  });
  return hit ? [{ id: hit.id, data: { droppableContainer: hit, value: 0 } }] : [];
};

/** Arrow keys move a third of a row at a time, so every drop zone can be reached. */
const byThirds: KeyboardCoordinateGetter = (event, { currentCoordinates }) => {
  const step = event.code === "ArrowDown" ? 12 : event.code === "ArrowUp" ? -12 : 0;
  if (step === 0) return undefined;
  event.preventDefault();
  return { ...currentCoordinates, y: currentCoordinates.y + step };
};

/** Where the name cell a drag started from sits; it stays put while the months scroll sideways. */
const nameCellLeft = ({ target }: Event) => {
  const handle = target instanceof Element ? target.closest("button") : null;
  return handle?.offsetParent?.getBoundingClientRect().left ?? 0;
};

const sameDrop = (a: Drop | null, b: Drop | null) => JSON.stringify(a) === JSON.stringify(b);

/** Drag and drop for the budget's groups and categories; rows join with `useDragRow`. */
export function CategoryDnd({
  groups,
  maxDepth,
  renderDragged,
  children,
}: {
  groups: ReadonlyArray<CategoryGroup>;
  maxDepth: number;
  /** The row's own name cell, drawn see-through under the mouse. */
  renderDragged: (dragged: Dragged) => ReactNode;
  children: ReactNode;
}) {
  const { id: book } = useBook();
  const moveGroup = useBookMutation(book, "move_category_group");
  const moveCategory = useBookMutation(book, "move_category");
  const [dragged, setDragged] = useState<Dragged | null>(null);
  const [drop, setDrop] = useState<Drop | null>(null);
  const [cellLeft, setCellLeft] = useState(0);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: byThirds }),
  );

  const categories = groups.flatMap((group) => group.categories);
  const nameOf = (item: Dragged | Target) =>
    (item.kind === "group" ? groups : categories).find((each) => each.id === item.id)?.name ?? "";
  const state = useMemo<DragState>(() => {
    if (dragged === null) return { dragging: new Set(), drop };
    if (dragged.kind === "group") return { dragging: new Set([dragged.id]), drop };
    const home = groups.find((group) => group.categories.some((c) => c.id === dragged.id));
    return { dragging: categorySubtree(home?.categories ?? [], dragged.id), drop };
  }, [dragged, drop, groups]);

  const onDragStart = ({ active, activatorEvent }: DragStartEvent) => {
    setCellLeft(nameCellLeft(activatorEvent));
    setDragged(active.data.current as Dragged);
  };
  const fromNameCell: Modifier = ({ transform, activeNodeRect }) => ({
    ...transform,
    x: transform.x + cellLeft - (activeNodeRect?.left ?? 0),
  });
  const onDragMove = ({ active, over }: DragMoveEvent) => {
    const rect = active.rect.current.translated;
    const target = over?.data.current as Target | undefined;
    const next =
      rect && over && target
        ? resolveDrop(
            groups,
            active.data.current as Dragged,
            target,
            (rect.top + rect.height / 2 - over.rect.top) / over.rect.height,
            maxDepth,
          )
        : null;
    setDrop((current) => (sameDrop(current, next) ? current : next));
  };
  const reset = () => {
    setDragged(null);
    setDrop(null);
  };
  const onDragEnd = () => {
    if (drop?.kind === "group") moveGroup.mutate({ id: drop.id, before: drop.before });
    if (drop?.kind === "category")
      moveCategory.mutate({
        id: drop.id,
        groupId: drop.groupId,
        parent: drop.parent,
        before: drop.before,
      });
    reset();
  };

  const announcements: Announcements = {
    onDragStart: ({ active }) => `Picked up ${nameOf(active.data.current as Dragged)}.`,
    onDragOver: ({ over }) =>
      over ? `Over ${nameOf(over.data.current as Target)}.` : "Not over a row.",
    onDragEnd: ({ active }) =>
      drop
        ? `Moved ${nameOf(active.data.current as Dragged)}.`
        : `${nameOf(active.data.current as Dragged)} stays where it was.`,
    onDragCancel: ({ active }) => `Cancelled moving ${nameOf(active.data.current as Dragged)}.`,
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={rowAtCenter}
      accessibility={{
        announcements,
        screenReaderInstructions: {
          draggable:
            "Press space or enter to pick up. Use the arrow keys to move: the top of a row places it before, the middle nests it inside, the bottom places it after. Press space or enter to drop, escape to cancel.",
        },
      }}
      onDragStart={onDragStart}
      onDragMove={onDragMove}
      onDragEnd={onDragEnd}
      onDragCancel={reset}
    >
      <DragContext.Provider value={state}>{children}</DragContext.Provider>
      {/* Stays in the grid's stacking context: above the sticky names, under the drop line. */}
      <DragOverlay dropAnimation={null} modifiers={[fromNameCell]} zIndex={15}>
        {dragged && (
          <div
            data-slot="drag-label"
            className="relative w-fit cursor-grabbing opacity-85 after:pointer-events-none after:absolute after:inset-0 after:z-20 after:border after:border-muted-foreground"
          >
            <div inert>{renderDragged(dragged)}</div>
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}

/** Makes a row draggable by its handle and a place to drop on. */
export function useDragRow(dragged: Dragged, target: Target) {
  const drag = useDraggable({ id: `${dragged.kind}:${dragged.id}`, data: dragged });
  const drop = useDroppable({ id: `${target.kind}:${target.id}`, data: target });
  return {
    ref: (node: HTMLElement | null) => {
      drag.setNodeRef(node);
      drop.setNodeRef(node);
    },
    handle: { ref: drag.setActivatorNodeRef, ...drag.attributes, ...drag.listeners },
  };
}

const GRIP =
  "absolute top-1/2 left-1 z-10 flex h-6 w-4 -translate-y-1/2 items-center justify-center rounded text-muted-foreground/70";

/** A row's handle; without `handle` it is only the grip, for the cell being dragged. */
export function DragHandle({
  label,
  handle,
}: {
  label: string;
  handle: ReturnType<typeof useDragRow>["handle"] | undefined;
}) {
  if (handle === undefined)
    return (
      <span className={GRIP}>
        <GripVerticalIcon className="size-3.5 shrink-0" />
      </span>
    );
  const { ref, ...props } = handle;
  return (
    <button
      type="button"
      ref={ref}
      {...props}
      aria-label={`Move ${label}`}
      className={cn(
        GRIP,
        "cursor-grab touch-none opacity-0 outline-none group-hover/row:opacity-100 max-md:opacity-100 hover:bg-accent hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing",
      )}
    >
      <GripVerticalIcon className="size-3.5 shrink-0" />
    </button>
  );
}

/** The drop's line or highlight on `row` (`<kind>:<id>` or `section:<group id>`); `lineStart` in rem by level. */
export function DropMark({
  row,
  lineStart = () => 0,
}: {
  row: string;
  lineStart?: (level: number) => number;
}) {
  const { drop } = useDragState();
  if (drop?.mark.row !== row) return null;
  const { edge, level } = drop.mark;
  if (edge === "inside")
    return (
      <div className="pointer-events-none absolute inset-0 z-20 bg-primary/8 ring-2 ring-primary ring-inset" />
    );
  return (
    <div
      data-slot="drop-line"
      className={cn(
        "pointer-events-none absolute right-0 z-20 h-0.5 bg-primary",
        edge === "before" ? "-top-px" : "-bottom-px",
      )}
      style={{ left: `${lineStart(level)}rem` }}
    />
  );
}
