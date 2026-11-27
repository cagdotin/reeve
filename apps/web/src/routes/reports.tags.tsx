import type { Tag } from "@reeve/contract/catalog";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { PlusIcon, SearchIcon, SparklesIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";
import { TableEmpty } from "@/components/insights/table";
import { ReportSelector } from "@/components/reports/report-selector";
import { Page, QueryBody } from "@/components/page";
import { Badge } from "@reeve/ui/components/badge";
import { Button } from "@reeve/ui/components/button";
import { Checkbox } from "@reeve/ui/components/checkbox";
import {
  Dialog,
  DialogClose,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "@reeve/ui/components/dialog";
import { Input } from "@reeve/ui/components/input";
import { Switch } from "@reeve/ui/components/switch";
import { CHART_SERIES } from "@/components/reports/chart-colors";
import { cn } from "@reeve/ui/lib/utils";
import { bookQuery, useBookMutation } from "@/lib/api";
import { useBook } from "@/lib/book";

export const Route = createFileRoute("/reports/tags")({
  component: TagsPage,
});

/** Tag colours to pick from, as Actual's swatches. */
const SWATCHES = [...CHART_SERIES.light, "#66635d"];

function TagChip({ tag }: { tag: Pick<Tag, "tag" | "color"> }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md border px-1.5 py-0.5 text-xs font-medium">
      <span
        aria-hidden
        className="size-2 rounded-full"
        style={{ backgroundColor: tag.color ?? "var(--muted-foreground)" }}
      />
      #{tag.tag}
    </span>
  );
}

function TagsPage() {
  const { id: book } = useBook();
  const tags = useQuery(bookQuery(book, "list_tags", {}));
  const discover = useBookMutation(book, "discover_tags");
  const remove = useBookMutation(book, "delete_tags");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [editing, setEditing] = useState<Tag | "new" | null>(null);

  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };

  return (
    <Page
      title="Tags"
      context={<ReportSelector name="Tags" />}
      actions={
        <>
          <Button
            variant="ghost"
            disabled={tags.data === undefined}
            loading={discover.isPending}
            onClick={() => discover.mutate({})}
          >
            <SparklesIcon />
            Find tags in notes
          </Button>
          <Button
            variant="ghost"
            disabled={tags.data === undefined}
            onClick={() => setEditing("new")}
          >
            <PlusIcon />
            New tag
          </Button>
        </>
      }
    >
      <div className="flex h-11 items-center gap-2 border-b px-3">
        <SearchIcon className="size-4 text-muted-foreground" />
        <Input
          type="search"
          placeholder="Filter tags"
          aria-label="Filter tags"
          className="max-w-64"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        {selected.size > 0 && (
          <Button
            variant="destructive-outline"
            className="ms-auto"
            onClick={() =>
              remove.mutate({ ids: [...selected] }, { onSuccess: () => setSelected(new Set()) })
            }
          >
            <Trash2Icon />
            Delete {selected.size}
          </Button>
        )}
      </div>
      <div className="sticky top-(--sticky-top) z-20 flex h-8 items-center gap-3 border-b bg-background px-3 text-xs text-muted-foreground">
        <span className="w-5" />
        <span className="w-48">Tag</span>
        <span className="min-w-0 flex-1">Description</span>
        <span className="w-24 text-right">Transactions</span>
      </div>
      <QueryBody query={tags}>
        {(data) => {
          const shown = data.filter((tag) =>
            `${tag.tag} ${tag.description ?? ""}`
              .toLowerCase()
              .includes(query.trim().toLowerCase()),
          );
          return shown.length === 0 ? (
            <TableEmpty>
              Tags are #words in transaction notes. Find the ones your notes use, or add one.
            </TableEmpty>
          ) : (
            shown.map((tag) => (
              <div
                key={tag.id}
                className={cn(
                  "flex h-10 items-center gap-3 border-b px-3 text-[13px] hover:bg-row-hover",
                  tag.hidden && "opacity-60",
                )}
              >
                <Checkbox
                  aria-label={`Select #${tag.tag}`}
                  checked={selected.has(tag.id)}
                  onCheckedChange={() => toggle(tag.id)}
                />
                <button
                  type="button"
                  className="flex w-48 cursor-pointer items-center gap-2 text-left"
                  onClick={() => setEditing(tag)}
                >
                  <TagChip tag={tag} />
                  {tag.hidden && <Badge variant="outline">Hidden</Badge>}
                </button>
                <span className="min-w-0 flex-1 truncate text-muted-foreground">
                  {tag.description}
                </span>
                <span className="w-24 text-right tabular-nums">{tag.count}</span>
              </div>
            ))
          );
        }}
      </QueryBody>
      <TagDialog tag={editing} onClose={() => setEditing(null)} />
    </Page>
  );
}

function TagDialog({ tag, onClose }: { tag: Tag | "new" | null; onClose: () => void }) {
  const { id: book } = useBook();
  const create = useBookMutation(book, "create_tag");
  const update = useBookMutation(book, "update_tag");
  const current = tag === "new" || tag === null ? null : tag;
  const [name, setName] = useState("");
  const [color, setColor] = useState<string | null>(null);
  const [description, setDescription] = useState("");
  const [hidden, setHidden] = useState(false);
  const [opened, setOpened] = useState<Tag | "new" | null>(null);
  if (tag !== opened) {
    setOpened(tag);
    setName(current?.tag ?? "");
    setColor(current?.color ?? null);
    setDescription(current?.description ?? "");
    setHidden(current?.hidden ?? false);
  }
  const clean = name.trim().replace(/^#/, "");
  return (
    <Dialog open={tag !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogPopup className="max-w-md">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (clean === "") return;
            const fields = {
              color,
              description: description.trim() === "" ? null : description.trim(),
            };
            if (current)
              update.mutate(
                {
                  id: current.id,
                  ...(clean !== current.tag ? { tag: clean } : {}),
                  ...fields,
                  hidden,
                },
                { onSuccess: onClose },
              );
            else create.mutate({ tag: clean, ...fields }, { onSuccess: onClose });
          }}
        >
          <DialogHeader>
            <DialogTitle>{current ? "Edit tag" : "New tag"}</DialogTitle>
          </DialogHeader>
          <DialogPanel className="grid gap-4">
            <label className="grid gap-1.5 text-sm">
              Name
              <Input
                autoFocus
                aria-label="Name"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
              {current && clean !== current.tag && clean !== "" && (
                <span className="text-xs text-muted-foreground">
                  Notes that use #{current.tag} will say #{clean}.
                </span>
              )}
            </label>
            <div className="grid gap-1.5 text-sm">
              Color
              <div className="flex flex-wrap items-center gap-1.5">
                {SWATCHES.map((swatch) => (
                  <button
                    key={swatch}
                    type="button"
                    aria-label={`Color ${swatch}`}
                    aria-pressed={color === swatch}
                    className={cn(
                      "size-6 cursor-pointer rounded-full ring-offset-2 ring-offset-background",
                      color === swatch && "ring-2 ring-ring",
                    )}
                    style={{ backgroundColor: swatch }}
                    onClick={() => setColor(swatch)}
                  />
                ))}
                <input
                  type="color"
                  aria-label="Custom color"
                  className="size-6 cursor-pointer rounded-full border-0 bg-transparent p-0"
                  value={color ?? "#66635d"}
                  onChange={(event) => setColor(event.target.value)}
                />
                <Button type="button" variant="ghost" onClick={() => setColor(null)}>
                  No color
                </Button>
              </div>
            </div>
            <div className="grid gap-1.5 text-sm">
              Description
              <Input
                aria-label="Description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </div>
            {current && (
              <div className="flex items-center gap-2 text-sm">
                <Switch
                  aria-label="Hide from tag pickers"
                  checked={hidden}
                  onCheckedChange={setHidden}
                />
                Hide from tag pickers
              </div>
            )}
            <div className="text-xs text-muted-foreground">
              Preview <TagChip tag={{ tag: clean || "tag", color }} />
            </div>
          </DialogPanel>
          <DialogFooter>
            <DialogClose render={<Button variant="ghost" />}>Cancel</DialogClose>
            <Button type="submit" disabled={clean === ""}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}
